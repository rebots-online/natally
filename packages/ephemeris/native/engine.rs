//! Native implementation of the same seam as src/sweph/engine.ts.
//! FFI signatures: VENDORED/sweph-wasm/swisseph/swephexp.h.
use crate::{HostError, NativeEphemerisEngine};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    ffi::{CStr, CString},
    fs,
    os::raw::{c_char, c_double, c_int},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

include!(concat!(env!("OUT_DIR"), "/tables.rs"));

extern "C" {
    fn swe_set_ephe_path(path: *const c_char);
    fn swe_close();
    fn swe_calc_ut(
        ut: c_double,
        body: c_int,
        flags: c_int,
        out: *mut c_double,
        error: *mut c_char,
    ) -> c_int;
    fn swe_houses_ex(
        ut: c_double,
        flags: c_int,
        lat: c_double,
        lon: c_double,
        system: c_int,
        cusps: *mut c_double,
        angles: *mut c_double,
    ) -> c_int;
}

const FLAGS: i32 = 2 | 256;
const BODIES: &[&str] = &[
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
    "chiron",
    "north-node",
    "south-node",
];
const ASPECTS: &[(&str, f64, f64)] = &[
    ("conjunction", 0., 8.),
    ("opposition", 180., 8.),
    ("trine", 120., 7.),
    ("square", 90., 7.),
    ("sextile", 60., 4.),
    ("quincunx", 150., 3.),
    ("semisextile", 30., 2.),
];
// Swiss Ephemeris has process-global state. A second engine must never race the
// active host, even if an embedding application accidentally constructs one.
static OWNED: AtomicBool = AtomicBool::new(false);

fn error(message: impl Into<String>) -> HostError {
    HostError::new("EphemerisError", message)
}
fn angle(value: f64) -> f64 {
    value.rem_euclid(360.)
}
fn signed_angle(value: f64) -> f64 {
    angle(value + 180.) - 180.
}
fn date(ut: f64) -> Result<(), HostError> {
    if !ut.is_finite() || !(2378496.5..2597641.5).contains(&ut) {
        return Err(error(
            "bundled ephemeris tables cover Gregorian 1800–2400 only",
        ));
    }
    Ok(())
}
fn body_id(body: &str) -> Result<i32, HostError> {
    match body {
        "chiron" => Ok(15),
        "north-node" | "south-node" => Ok(11),
        _ => BODIES[..10]
            .iter()
            .position(|b| *b == body)
            .map(|i| i as i32)
            .ok_or_else(|| error("unknown body")),
    }
}
fn system(value: &str) -> Result<i32, HostError> {
    if value.len() != 1 || !"PKORCAVWTXBU".contains(value) {
        return Err(error("unknown house system"));
    }
    Ok(i32::from(value.as_bytes()[0]))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Place {
    lat: f64,
    lon: f64,
}
impl Place {
    fn valid(&self) -> bool {
        self.lat.is_finite()
            && self.lon.is_finite()
            && (-90.0..=90.0).contains(&self.lat)
            && (-180.0..=180.0).contains(&self.lon)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    body: String,
    lon: f64,
    lat: f64,
    speed: f64,
}
impl Position {
    fn valid(&self) -> bool {
        body_id(&self.body).is_ok()
            && (0.0..360.0).contains(&self.lon)
            && (-90.0..=90.0).contains(&self.lat)
            && self.speed.is_finite()
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Inputs {
    ut: Vec<f64>,
    place: Place,
    system: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cusps {
    cusps: [f64; 12],
    asc: f64,
    mc: f64,
    armc: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Aspect {
    a: String,
    b: String,
    #[serde(rename = "type")]
    kind: String,
    orb: f64,
    applying: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Facts {
    id: String,
    inputs: Inputs,
    positions: Vec<Position>,
    cusps: Option<Cusps>,
    aspects: Vec<Aspect>,
}
fn facts(value: Value) -> Result<Facts, HostError> {
    let f: Facts = serde_json::from_value(value).map_err(|e| error(e.to_string()))?;
    if f.id.is_empty()
        || f.inputs.ut.is_empty()
        || f.inputs.ut.iter().any(|u| !u.is_finite())
        || !f.inputs.place.valid()
        || system(&f.inputs.system).is_err()
        || f.positions.iter().any(|p| !p.valid())
    {
        return Err(error("invalid chart facts"));
    }
    if let Some(c) = &f.cusps {
        if c.cusps
            .iter()
            .chain([&c.asc, &c.mc, &c.armc])
            .any(|v| !(0.0..360.0).contains(v))
        {
            return Err(error("invalid chart cusps"));
        }
    }
    for a in &f.aspects {
        let _ = a.applying;
        if body_id(&a.a).is_err()
            || body_id(&a.b).is_err()
            || !ASPECTS.iter().any(|(name, _, _)| *name == a.kind)
            || !(0.0..=180.0).contains(&a.orb)
        {
            return Err(error("invalid chart aspect"));
        }
    }
    Ok(f)
}

pub struct SwephEngine {
    tables: PathBuf,
    ready: bool,
    thread_bound: std::marker::PhantomData<std::rc::Rc<()>>,
}
impl SwephEngine {
    /// tables is selected by the native application, never by an IPC-supplied path.
    pub fn new(tables: PathBuf) -> Result<Self, HostError> {
        OWNED
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| error("native ephemeris already has an owning host"))?;
        Ok(Self {
            tables,
            ready: false,
            thread_bound: std::marker::PhantomData,
        })
    }
    fn ready(&self) -> Result<(), HostError> {
        if self.ready {
            Ok(())
        } else {
            Err(error("native ephemeris not initialized"))
        }
    }
}
impl Drop for SwephEngine {
    fn drop(&mut self) {
        // The owning NativeHost drops this engine on its calculation thread.
        unsafe { swe_close() };
        OWNED.store(false, Ordering::Release);
    }
}
impl NativeEphemerisEngine for SwephEngine {
    fn init(&mut self, _cfg: Map<String, Value>) -> Result<(), HostError> {
        self.ready = false;
        if std::env::var_os("SE_EPHE_PATH").is_some_and(|value| !value.is_empty()) {
            return Err(error(
                "SE_EPHE_PATH would override the verified local table directory",
            ));
        }
        for (name, bytes, hash) in TABLES {
            let data =
                fs::read(self.tables.join(name)).map_err(|e| error(format!("{name}: {e}")))?;
            if data.len() as u64 != *bytes || format!("{:x}", Sha256::digest(&data)) != *hash {
                return Err(error(format!("{name}: local table integrity mismatch")));
            }
        }
        let path = self
            .tables
            .canonicalize()
            .map_err(|e| error(e.to_string()))?;
        let text = path
            .to_str()
            .ok_or_else(|| error("table path must be UTF-8"))?;
        if text.len() >= 240 {
            return Err(error("table path exceeds Swiss Ephemeris path capacity"));
        }
        let path = CString::new(text).map_err(|e| error(e.to_string()))?;
        // swe_set_ephe_path copies this NUL-terminated path into its owned state.
        unsafe { swe_set_ephe_path(path.as_ptr()) };
        self.ready = true;
        Ok(())
    }
    fn position(&mut self, body: String, ut: f64) -> Result<Value, HostError> {
        self.ready()?;
        date(ut)?;
        let id = body_id(&body)?;
        let mut result = [0.0; 6];
        let mut message = [0 as c_char; 256];
        // Both writable arrays match swephexp.h capacities; no buffer escapes this call.
        let flags =
            unsafe { swe_calc_ut(ut, id, FLAGS, result.as_mut_ptr(), message.as_mut_ptr()) };
        if flags < 0 || flags & FLAGS != FLAGS {
            let message = unsafe { CStr::from_ptr(message.as_ptr()) }.to_string_lossy();
            return Err(error(format!(
                "swe_calc_ut {body}: {message} (flags {flags})"
            )));
        }
        let opposite = body == "south-node";
        let lon = angle(result[0] + if opposite { 180. } else { 0. });
        let lat = result[1] * if opposite { -1. } else { 1. };
        if !lon.is_finite() || !(-90.0..=90.0).contains(&lat) || !result[3].is_finite() {
            return Err(error("invalid native position result"));
        }
        Ok(json!({"lon":lon,"lat":lat,"speed":result[3]}))
    }
    fn cusps(&mut self, ut: f64, place: Value, code: String) -> Result<Value, HostError> {
        self.ready()?;
        date(ut)?;
        let place: Place = serde_json::from_value(place).map_err(|e| error(e.to_string()))?;
        if !place.valid() {
            return Err(error("invalid geographic place"));
        }
        let code = system(&code)?;
        let mut cusps = [0.0; 13];
        let mut angles = [0.0; 10];
        let status = unsafe {
            swe_houses_ex(
                ut,
                0,
                place.lat,
                place.lon,
                code,
                cusps.as_mut_ptr(),
                angles.as_mut_ptr(),
            )
        };
        if status < 0
            || cusps[1..]
                .iter()
                .chain(angles[..3].iter())
                .any(|v| !v.is_finite())
        {
            return Err(error("house system unavailable at this date/place"));
        }
        Ok(
            json!({"cusps":cusps[1..].iter().map(|v| angle(*v)).collect::<Vec<_>>(),
            "asc":angle(angles[0]), "mc":angle(angles[1]), "armc":angle(angles[2])}),
        )
    }
    fn aspects(&mut self, a: Value, b: Value, orbs: Value) -> Result<Value, HostError> {
        let a = facts(a)?;
        let b = facts(b)?;
        let orbs = orbs
            .as_object()
            .ok_or_else(|| error("orb table must be an object"))?;
        if orbs
            .keys()
            .any(|key| !ASPECTS.iter().any(|(name, _, _)| *name == key))
        {
            return Err(error("unknown aspect in orb table"));
        }
        let mut limits = Vec::new();
        for (name, nominal, default) in ASPECTS {
            let limit = match orbs.get(*name) {
                Some(v) => v.as_f64().ok_or_else(|| error("orb must be numeric"))?,
                None => *default,
            };
            if !(0.0..=180.0).contains(&limit) {
                return Err(error("orb outside 0–180 degrees"));
            }
            limits.push((*name, *nominal, limit));
        }
        let mut result = Vec::new();
        for left in a.positions {
            for right in &b.positions {
                let delta = signed_angle(right.lon - left.lon);
                for (name, nominal, limit) in &limits {
                    let offset = delta.abs() - nominal;
                    if offset.abs() <= *limit {
                        let direction = if delta == 0. { 0. } else { delta.signum() };
                        result.push(
                            json!({"a":left.body,"b":right.body,"type":name,"orb":offset.abs(),
                        "applying":offset * direction * (right.speed - left.speed) < 0.}),
                        );
                    }
                }
            }
        }
        Ok(Value::Array(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NativeHost;

    #[tokio::test]
    async fn native_source_calculations_and_serial_host() {
        let tables = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../VENDORED/sweph-wasm/dist/ephe");
        let mut engine = SwephEngine::new(tables.clone()).unwrap();
        assert!(SwephEngine::new(tables.clone()).is_err());
        assert!(engine.position("sun".into(), 2451545.).is_err());
        engine.init(Map::new()).unwrap();
        for body in BODIES {
            let p = engine.position((*body).into(), 2451545.).unwrap();
            assert!((0.0..360.0).contains(&p["lon"].as_f64().unwrap()));
        }
        let north = engine.position("north-node".into(), 2451545.).unwrap();
        let south = engine.position("south-node".into(), 2451545.).unwrap();
        assert!(
            (angle(south["lon"].as_f64().unwrap() - north["lon"].as_f64().unwrap()) - 180.).abs()
                < 1e-10
        );
        assert_eq!(north["speed"], south["speed"]);
        for code in "PKORCAVWTXBU".chars() {
            let houses = engine
                .cusps(2451545., json!({"lat":55.6,"lon":13.}), code.to_string())
                .unwrap();
            assert_eq!(houses["cusps"].as_array().unwrap().len(), 12);
        }
        assert!(engine.position("sun".into(), 2000000.).is_err());
        assert!(engine.position("unknown".into(), 2451545.).is_err());
        assert!(engine
            .cusps(2451545., json!({"lat":91.,"lon":13.}), "P".into())
            .is_err());
        assert!(engine
            .cusps(2451545., json!({"lat":55.6,"lon":13.}), "G".into())
            .is_err());
        let chart = json!({"id":"same-inputs","inputs":{"ut":[2451545.],"place":{"lat":0.,"lon":0.},"system":"P"},
            "positions":[{"body":"sun","lon":10.,"lat":0.,"speed":1.}],"aspects":[]});
        let aspects = engine
            .aspects(chart.clone(), chart.clone(), json!({}))
            .unwrap();
        assert_eq!(aspects.as_array().unwrap().len(), 1);
        assert_eq!(aspects[0]["applying"], false);
        assert!(engine
            .aspects(chart.clone(), chart, json!({"trine":-1}))
            .is_err());
        drop(engine);
        let mut missing = SwephEngine::new(tables.join("absent")).unwrap();
        assert!(missing.init(Map::new()).is_err());
        drop(missing);

        let host = NativeHost::spawn(move || SwephEngine::new(tables)).unwrap();
        assert!(
            !host
                .request_json(json!({"id":0,"op":"position","params":{"body":"sun","ut":2451545.}}))
                .await
                .ok
        );
        assert!(
            host.request_json(json!({"id":1,"op":"init","params":{}}))
                .await
                .ok
        );
        for id in 2..34 {
            let result = host.request_json(json!({"id":id,"op":"position","params":{"body":"moon","ut":2451545.+f64::from(id)}})).await;
            assert!(result.ok, "{:?}", result.error);
            assert!(result.result.unwrap()["speed"]
                .as_f64()
                .unwrap()
                .is_finite());
        }
        let invalid = host.request_json(json!({"id":"bad","op":"bogus"})).await;
        assert!(!invalid.ok);
        assert_eq!(invalid.error.unwrap().name, "ProtocolError");
    }
}
