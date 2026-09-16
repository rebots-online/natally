//! natally — voice subsystem, Kokoro ONNX leg (task V.1, ARCHITECTURE §10).
//!
//! Compiled ONLY under the cargo feature `voice-kokoro` (declared and
//! documented in `super`/mod.rs). Per the V.1 architect ruling, the `ort`
//! dependency and the feature declaration land with I.2's registry wiring —
//! this file has therefore NOT been compiled by V.1 (no crate in the tree by
//! ruling; `cargo check` without features never reaches this module). It is
//! written against the `ort` 2.0-rc API surface; exact item paths / input
//! tensor names are pinned when I.2 wires the dependency (same
//! compile-deferred status as C.1's `inference/llama.rs`).
//!
//! # Mirror contract (§13)
//!
//! The model and voices come from the frozen `RobinsAIWorld/natally-models`
//! mirror (sha256-verified by M.1 before commit — this module owns loading,
//! exactly once, mirroring C.1's lazy-load law):
//!
//! - kind `"voice"` — the Kokoro ONNX artifact (mirror Kokoro, §10);
//! - kind `"voices"` — the voices table, a flat little-endian f32 matrix with
//!   an 8-byte header `[voice_count: u32 LE][dim: u32 LE]`, one style vector
//!   per row. Row → canonical voice name (af_heart, af_bella, …) is pinned
//!   with the mirror fixture at I.2; until then rows are addressable by their
//!   positional id `v{index}`.
//!
//! # Honest seam (INC-19)
//!
//! Kokoro consumes IPA phonemes, not raw text. The text→IPA phonemizer is
//! pinned together with the crate at I.2 (V.1 ruling); until then
//! [`phonemize`] answers with the honest-absence error, so the session code
//! below is complete but synthesis is not yet runnable. The model-dependent
//! test is `#[ignore]`d and needs real mirror files via env vars.

use std::collections::HashMap;
use std::path::Path;

use super::{SentenceSynth, VoiceError};

/// Kokoro's native output rate (§10 pipeline feeds playback directly).
pub const KOKORO_SAMPLE_RATE: u32 = 24_000;

/// Default mirror voice until Settings exposes a picker (voice is engine
/// state — one voice per engine instance; switch via `set_voice`).
pub const DEFAULT_VOICE: &str = "af_heart";

/// A named voice from the mirror voices table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceId(pub String);

impl Default for VoiceId {
    fn default() -> Self {
        Self(DEFAULT_VOICE.to_owned())
    }
}

/// Helper: little-endian u32 from the head of `bytes` (no unwrap/expect).
fn le_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 4 {
        return None;
    }
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// The mirror voices table (module header layout). Row names pinned at I.2
/// with the fixture; positional ids `v{index}` work from day one.
#[derive(Debug, Clone)]
pub struct VoicesTable {
    rows: HashMap<String, Vec<f32>>,
    dim: usize,
}

impl VoicesTable {
    pub fn load(path: &Path) -> Result<Self, VoiceError> {
        let bytes =
            std::fs::read(path).map_err(|e| VoiceError::Invalid(format!("voices asset: {e}")))?;
        let Some(count) = le_u32(&bytes) else {
            return Err(VoiceError::Invalid("voices header truncated".into()));
        };
        let Some(dim) = le_u32(&bytes.get(4..).unwrap_or(&[])) else {
            return Err(VoiceError::Invalid("voices header truncated".into()));
        };
        if count == 0 || dim == 0 {
            return Err(VoiceError::Invalid(
                "voices header declares an empty table".into(),
            ));
        }
        let (count, dim) = (count as usize, dim as usize);
        let row_bytes = dim
            .checked_mul(4)
            .and_then(|row| row.checked_mul(count))
            .ok_or_else(|| VoiceError::Invalid("voices table size overflows".into()))?;
        let expected = 8usize
            .checked_add(row_bytes)
            .ok_or_else(|| VoiceError::Invalid("voices table size overflows".into()))?;
        if bytes.len() < expected {
            return Err(VoiceError::Invalid(format!(
                "voices asset truncated: need {expected} bytes, have {}",
                bytes.len()
            )));
        }
        let mut rows = HashMap::with_capacity(count);
        for (index, row_bytes) in bytes[8..expected].chunks_exact(dim * 4).enumerate() {
            let row: Vec<f32> = row_bytes
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            rows.insert(format!("v{index}"), row);
        }
        Ok(Self { rows, dim })
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn row(&self, name: &str) -> Result<&[f32], VoiceError> {
        self.rows
            .get(name)
            .map(Vec::as_slice)
            .ok_or_else(|| VoiceError::Invalid(format!("unknown voice '{name}'")))
    }
}

/// Honest seam (module header): the native text→IPA phonemizer is pinned
/// together with the `ort` dependency at I.2's registry wiring.
fn phonemize(_text: &str) -> Result<String, VoiceError> {
    Err(VoiceError::Synthesis(
        "the native phonemizer (Kokoro text→IPA) is pinned with the `ort` dependency at \
         I.2's registry wiring (V.1 architect ruling) — synthesis is compile-checked \
         but not runnable until then"
            .into(),
    ))
}

/// onnxruntime session over the mirror Kokoro artifact + its voices table.
/// Loads lazily/exactly-once per process in the session layer (`audio.rs`
/// wiring, I.2/I.3); this type owns one resident session.
pub struct KokoroEngine {
    session: ort::session::Session<'static>,
    voices: VoicesTable,
    voice: VoiceId,
    speed: f32,
}

impl KokoroEngine {
    /// Loads the mirror ONNX + voices table (§13 paths, already
    /// sha256-verified by M.1). Intra-op threads modest: synthesis runs per
    /// sentence, the UI thread must never stall (§4 topology).
    pub fn load(model_path: &Path, voices_path: &Path) -> Result<Self, VoiceError> {
        let voices = VoicesTable::load(voices_path)?;
        let session = ort::session::Session::builder()
            .map_err(|e| VoiceError::Synthesis(format!("ort session builder: {e}")))?
            .with_intra_threads(2)
            .map_err(|e| VoiceError::Synthesis(format!("ort threads: {e}")))?
            .commit_from_file(model_path)
            .map_err(|e| {
                VoiceError::Synthesis(format!(
                    "failed to load kokoro model {}: {e}",
                    model_path.display()
                ))
            })?;
        Ok(Self {
            session,
            voices,
            voice: VoiceId::default(),
            speed: 1.0,
        })
    }

    pub fn set_voice(&mut self, voice: VoiceId) {
        self.voice = voice;
    }

    pub fn voice(&self) -> &VoiceId {
        &self.voice
    }

    pub fn sample_rate(&self) -> u32 {
        KOKORO_SAMPLE_RATE
    }

    /// One sentence → f32 PCM (mono, nominal −1..1) at [`KOKORO_SAMPLE_RATE`].
    /// Input tensor names/_shapes are pinned when I.2 wires the crate; the
    /// flow is fixed: phonemize → style row → session run → "audio" output.
    pub fn synth_once(&mut self, text: &str) -> Result<Vec<f32>, VoiceError> {
        if text.trim().is_empty() {
            return Err(VoiceError::Invalid(
                "cannot synthesize an empty sentence".into(),
            ));
        }
        let phonemes = phonemize(text)?;
        let style = self.voices.row(&self.voice.0)?;
        let speed = self.speed;
        let outputs = self
            .session
            .run(ort::inputs![
                "phonemes" => ort::value::Value::from_string(phonemes)
                    .map_err(|e| VoiceError::Synthesis(format!("phonemes input: {e}")))?,
                "style" => style,
                "speed" => speed,
            ])
            .map_err(|e| VoiceError::Synthesis(format!("kokoro session run: {e}")))?;
        let audio = outputs["audio"]
            .try_extract_tensor::<f32>()
            .map_err(|e| VoiceError::Synthesis(format!("kokoro audio output: {e}")))?;
        Ok(audio.iter().copied().collect())
    }
}

impl SentenceSynth for KokoroEngine {
    fn synth_sentence(&mut self, text: &str) -> Result<Vec<f32>, VoiceError> {
        self.synth_once(text)
    }
}

// ---------------------------------------------------------------------------
// Model-dependent test — real mirror files, #[ignore]d (task block: "skipped
// without it"). Compiled only under the feature, per the ruling.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod model_tests {
    use super::*;

    /// Real-file runner: set NATALLY_KOKORO_MODEL (mirror kokoro ONNX path)
    /// and NATALLY_KOKORO_VOICES (mirror voices table path), then run
    /// `cargo test --features voice-kokoro voice -- --ignored`.
    #[test]
    #[ignore = "model-dependent: needs real mirror ONNX + voices via env vars"]
    fn voice_kokoro_real_mirror_loads_and_synthesizes() {
        let model = std::env::var("NATALLY_KOKORO_MODEL")
            .expect("set NATALLY_KOKORO_MODEL to the mirror kokoro ONNX path");
        let voices = std::env::var("NATALLY_KOKORO_VOICES")
            .expect("set NATALLY_KOKORO_VOICES to the mirror voices table path");
        let mut engine =
            KokoroEngine::load(Path::new(&model), Path::new(&voices)).expect("mirror loads");
        assert_eq!(engine.sample_rate(), KOKORO_SAMPLE_RATE);
        let pcm = engine
            .synth_sentence("Natally reads the sky.")
            .expect("one sentence synthesizes");
        assert!(!pcm.is_empty(), "synthesis produced audio");
        assert!(pcm.iter().all(|s| s.is_finite()), "PCM is finite");
    }
}
