use std::{env, error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let root =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("manifest dir")?).join("../../..");
    let vendor = root.join("VENDORED/sweph-wasm/swisseph");
    let sources = [
        "swedate.c",
        "swehouse.c",
        "swejpl.c",
        "swemmoon.c",
        "swemplan.c",
        "sweph.c",
        "swephlib.c",
        "swecl.c",
        "swehel.c",
    ];
    // Compile only the detached project source. No download, clone or upstream update.
    let mut build = cc::Build::new();
    build.include(&vendor).warnings(false);
    for name in sources {
        build.file(vendor.join(name));
    }
    for entry in fs::read_dir(&vendor)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "c" || e == "h") {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    build.compile("natally_sweph");
    if env::var("CARGO_CFG_TARGET_FAMILY")?
        .split(',')
        .any(|s| s == "unix")
    {
        println!("cargo:rustc-link-lib=m");
    }

    // Asset integrity comes from the same import manifest used for the owned snapshot.
    let manifest_path = root.join("VENDORED/ephemeris-manifest.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(manifest_path)?)?;
    let files = manifest["files"].as_array().ok_or("vendor files")?;
    let mut generated = String::from("pub const TABLES: &[(&str, u64, &str)] = &[\n");
    for name in ["sepl_18.se1", "semo_18.se1", "seas_18.se1"] {
        let path = format!("sweph-wasm/dist/ephe/{name}");
        let file = files
            .iter()
            .find(|f| f["path"].as_str() == Some(&path))
            .ok_or("missing table provenance")?;
        let bytes = file["bytes"].as_u64().ok_or("table length")?;
        let hash = file["sha256"].as_str().ok_or("table hash")?;
        generated.push_str(&format!("({name:?}, {bytes}, {hash:?}),\n"));
    }
    generated.push_str("];");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").ok_or("output dir")?).join("tables.rs"),
        generated,
    )?;
    Ok(())
}
