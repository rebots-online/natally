//! natally — voice subsystem, native leg (task V.1, ARCHITECTURE §4 pipeline,
//! §10 voice subsystem): companion turn → sentence chunks → Kokoro synth →
//! playback → RMS envelope → Stage speaking.
//!
//! # Registration (house protocol — same shape as `lore_commands.rs`/`inference`)
//!
//! `src/registry_generated.rs` is GENERATED and owned by task I.2. This module
//! never invokes `natally_plugin!`. I.2 joins it to the IPC surface by
//! declaring `pub mod voice;` at the crate root and listing
//! `voice::voice_set_mute, voice::voice_mute_state` in the macro.
//! `lib.rs` and `main.rs` are never touched.
//!
//! # The `voice-kokoro` feature (architect ruling, same as C.1)
//!
//! The `ort` (onnxruntime) and `cpal` crates are NOT in `Cargo.toml` (T0.3's
//! file, untouched here). The `voice-kokoro` feature declaration AND the
//! `dep:ort` / `dep:cpal` pins land with I.2's registry wiring. Until then:
//!
//! - `kokoro.rs` (ort session over the mirror model, §13) and `audio.rs`
//!   (cpal playback stream + envelope tap) are declared below behind
//!   `#[cfg(feature = "voice-kokoro")]` — absent from default builds, so
//!   every `ort`/`cpal` import is unreachable and `cargo check`/`cargo test`
//!   WITHOUT the feature stays clean. Their exact API surfaces are pinned
//!   when I.2 lands the dependency (same compile-deferred status as C.1's
//!   `inference/llama.rs`).
//! - The TESTABLE core lives HERE, un-gated and pure: sentence chunking,
//!   RMS envelope math, the synthesis queue (injected synth + sink), and the
//!   `envelope` `CompanionEvent` DTO. All fixtures run in the default build.
//! - The model-dependent test (real mirror ONNX via env-var paths) sits in
//!   `kokoro.rs` behind `#[ignore]`; it exists only under the feature, per
//!   the ruling ("synthesis path compile-checked only when I.2 lands the
//!   feature pin").
//!
//! # Verify-command vehicle
//!
//! Because I.2 owns the crate-root `pub mod voice;` declaration, this task
//! ships `src-tauri/tests/voice.rs` — an integration-test harness that
//! `#[path]`-includes THIS file so the V.1 Verify command
//! (`cargo test --manifest-path apps/local/src-tauri/Cargo.toml voice`)
//! compiles and runs the un-gated core + fixtures today. Once I.2 declares
//! the module at the crate root the harness is redundant and may be retired
//! to `~/outbox/` (never deleted, I-0). The `#[cfg(test)]` fixtures then run
//! from the lib target instead — same tests, same names.
//!
//! # Sentence chunking heuristic (documented per the task block)
//!
//! `chunk_sentences` splits on the sentence-ending punctuation `.` `!` `?`
//! `…` (U+2026) only. The semicolon is deliberately NOT a terminator — it is
//! a clause pause, not a sentence end; Kokoro phrases clauses fine. Rules:
//!
//! 1. **Abbreviations stay intact.** A `.` does not close a sentence when the
//!    word immediately before it (maximal alphanumeric run) is in the
//!    `ABBREVIATIONS` list (Mr, Mrs, Ms, Dr, Prof, Sr, Jr, St, Mt, Vs, Etc,
//!    …). The list is small, lowercase-matched, and documented here — it is a
//!    heuristic, not a grammar.
//! 2. **Initials and short tokens stay intact.** A `.` after a single
//!    alphanumeric character never closes ("J. R. R. Tolkien", "3.14",
//!    "a.m."/"p.m." via the initial rule on their single letters).
//! 3. **Dot runs.** A run of three or more ASCII dots acts as a typed
//!    ellipsis: it closes the sentence at the run's final dot, so "Wait..."
//!    ends its chunk. A two-dot run stays glued (sloppy punctuation, rare —
//!    kept inside its sentence rather than guessed at).
//! 4. **Closing quotes/brackets stay attached.** A terminator absorbs any
//!    immediately following closers (`"` `'` `)` `]` `}` `»` `”` `’`).
//! 5. **Never mid-word.** Cuts happen only after a terminator (plus absorbed
//!    closers), always at UTF-8 char boundaries.
//! 6. **Empty text ⇒ empty queue.** Whitespace-only text too; chunks are
//!    trimmed and empty pieces dropped.
//!
//! # RMS envelope law (documented per the task block)
//!
//! `rms_envelope` maps f32 PCM to one value per `window_ms` window (20 ms at
//! the Kokoro rate = 480 samples): the window's root-mean-square, normalized
//! against the **global peak** of the provided clip (`max |sample|`).
//! Peak-normalized, per the task's pick-and-document clause: a full-scale
//! sine therefore reads 1/√2 ≈ 0.7071 regardless of its amplitude, and the
//! values always land in 0–1 (clamped defensively to satisfy the
//! `EnvelopeEventSchema` contract, `rms: min 0 max 1`, in
//! `packages/lore/src/types.ts`). A silent window, an all-silent clip, or a
//! non-finite sample contribution yields 0.0. Empty input ⇒ empty envelope.
//!
//! # Mute seam (documented per the task block)
//!
//! `voice_set_mute` / `voice_mute_state` are the config-store command stubs:
//! they flip a process-wide flag that the playback tap (`audio.rs`, gated)
//! reads per callback. Actual **persistence** across launches goes through
//! the config store and lands with I.2's wiring — the call site is marked
//! `[I.2/config wiring]` in the command body. The `SynthesisQueue` keeps its
//! own injected `muted` flag (set by whoever owns the session) so mute
//! semantics are unit-testable without tauri or a device.
//!
//! # Wire contract
//!
//! Envelope events ride the §4 bus channel [`BUS_CHANNEL`] (`companion:event`)
//! as the `envelope` variant of the `CompanionEvent` union
//! (`@natally/lore/types`): `{ type: "envelope", rms }`. That constant must
//! stay identical to `inference::BUS_CHANNEL` — duplicated per-module until
//! I.2 centralizes wire constants, mirroring C.1. The bus republishes to
//! stage/transcript/voice; that wiring is I.3's, not this module's (§10: the
//! Stage binds Speaking to these real events, STATES.md law).

// The `voice-kokoro` feature is deliberately absent from Cargo.toml (T0.3's
// file) until I.2 lands the `dep:ort`/`dep:cpal` pins (V.1 architect ruling);
// its cfgs are therefore "unexpected" to rustc's check-cfg pass for now.
#![allow(unexpected_cfgs)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

/// §4 companion event bus channel; payload values are `CompanionEvent`s.
/// Must stay identical to `inference::BUS_CHANNEL` (see module header).
pub const BUS_CHANNEL: &str = "companion:event";

/// Envelope window length (§10). 20 ms windows at the Kokoro sample rate.
pub const ENVELOPE_WINDOW_MS: u32 = 20;

// ---------------------------------------------------------------------------
// Errors — thiserror pattern (block rule: no unwrap/expect in command paths).
// ---------------------------------------------------------------------------

/// Voice subsystem error. Commands surface `to_string()` on the wire
/// (house pattern: the Rust side reports, the TS shell holds the schema law).
#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    #[error("natally voice: {0}")]
    Invalid(String),
    #[error("natally voice: synthesis failed: {0}")]
    Synthesis(String),
    #[error("natally voice: audio backend: {0}")]
    Audio(String),
    #[error("natally voice: event bus: {0}")]
    Event(String),
}

// ---------------------------------------------------------------------------
// Sentence chunking (pure, tested).
// ---------------------------------------------------------------------------

/// Sentence-ending punctuation. The semicolon is deliberately excluded —
/// clause pause, not sentence end (module header, rule 0).
fn is_sentence_terminator(ch: char) -> bool {
    matches!(ch, '.' | '!' | '?' | '…')
}

/// Closers glued to a terminator stay attached to their sentence (rule 4).
fn is_closer(ch: char) -> bool {
    matches!(ch, '"' | '\'' | ')' | ']' | '}' | '»' | '”' | '’')
}

/// Lowercase-matched abbreviation list for rule 1. Small by design; a
/// documented heuristic (extend only with evidence, never per-string hacks).
const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "approx", "dept",
    "univ", "inc", "ltd", "co", "corp", "ave", "blvd", "fig", "no", "vol", "ed", "pp", "al",
];

/// The maximal alphanumeric run immediately before `chars[idx]` (rule 1/2
/// token). Empty when the preceding char is punctuation or whitespace. The
/// returned slice borrows from `text` only.
fn word_before<'a>(text: &'a str, chars: &[(usize, char)], idx: usize) -> &'a str {
    let dot_start = chars[idx].0;
    let mut start = dot_start;
    let mut k = idx;
    while k > 0 {
        let (pos, c) = chars[k - 1];
        if c.is_alphanumeric() {
            start = pos;
            k -= 1;
        } else {
            break;
        }
    }
    &text[start..dot_start]
}

/// Does the terminator at `chars[idx]` actually close a sentence? `!` `?`
/// `…` always close; `.` runs the abbreviation/initial rules (a longer dot
/// run is handled by the caller, which closes it at the run's final dot).
fn closes_sentence(text: &str, chars: &[(usize, char)], idx: usize) -> bool {
    let (_, ch) = chars[idx];
    match ch {
        '!' | '?' | '…' => true,
        '.' => {
            // Runs are the caller's concern (dot_run_len); inside a run only
            // the final dot is offered here, so adjacency means "short run".
            if idx > 0 && chars[idx - 1].1 == '.' {
                return false;
            }
            let word = word_before(text, chars, idx);
            match word.chars().count() {
                // Stray dot after punctuation/space: treat as a terminator.
                0 => true,
                // Rule 2: initials ("J."), decimals ("3.14"), a.m./p.m.
                1 => false,
                // Rule 1: known abbreviations stay intact.
                _ => {
                    let lowered = word.to_lowercase();
                    !ABBREVIATIONS.contains(&lowered.as_str())
                }
            }
        }
        _ => false,
    }
}

/// Length of the run of consecutive ASCII dots starting at `chars[idx]`
/// (which must be a dot).
fn dot_run_len(chars: &[(usize, char)], idx: usize) -> usize {
    let mut n = 0usize;
    while chars.get(idx + n).is_some_and(|&(_, c)| c == '.') {
        n += 1;
    }
    n
}

/// Splits `text` into sentence chunks per the documented heuristic (module
/// header). Empty/whitespace-only text yields an empty queue; chunks are
/// trimmed and non-empty. Pure and deterministic.
pub fn chunk_sentences(text: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut start = 0usize; // byte offset where the pending sentence begins
    let mut idx = 0usize;

    while idx < chars.len() {
        let (pos, ch) = chars[idx];

        // Rule 3: a 3+ dot run is a typed ellipsis — it closes at the run's
        // final dot. (A two-dot run falls through and stays glued.)
        if ch == '.' {
            let run = dot_run_len(&chars, idx);
            if run >= 3 {
                let last = idx + run - 1;
                let mut end = chars[last].0 + 1;
                let mut look = last + 1;
                while let Some(&(next_pos, next_ch)) = chars.get(look) {
                    if next_pos == end && is_closer(next_ch) {
                        end += next_ch.len_utf8();
                        look += 1;
                    } else {
                        break;
                    }
                }
                let piece = text[start..end].trim();
                if !piece.is_empty() {
                    chunks.push(piece.to_owned());
                }
                start = end;
                idx = look;
                continue;
            }
        }

        if is_sentence_terminator(ch) && closes_sentence(text, &chars, idx) {
            // Rule 4: absorb immediately following closers.
            let mut end = pos + ch.len_utf8();
            let mut look = idx + 1;
            while let Some(&(next_pos, next_ch)) = chars.get(look) {
                if next_pos == end && is_closer(next_ch) {
                    end += next_ch.len_utf8();
                    look += 1;
                } else {
                    break;
                }
            }
            let piece = text[start..end].trim();
            if !piece.is_empty() {
                chunks.push(piece.to_owned());
            }
            start = end;
            idx = look;
        } else {
            idx += 1;
        }
    }

    let tail = text[start..].trim();
    if !tail.is_empty() {
        chunks.push(tail.to_owned());
    }
    chunks
}

// ---------------------------------------------------------------------------
// RMS envelope (pure, tested).
// ---------------------------------------------------------------------------

/// One envelope value per `window_ms` window of `samples` at `sample_rate`:
/// peak-normalized RMS in 0–1 (module header law). Empty input ⇒ empty
/// envelope; the trailing partial window is still measured; silence ⇒ 0.0.
pub fn rms_envelope(samples: &[f32], sample_rate: u32, window_ms: u32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    let window_len = usize::max(1, (sample_rate as usize * window_ms as usize) / 1000);

    // Global peak of the clip (non-finite samples cannot raise the peak:
    // f32::max ignores NaN in favour of the finite operand).
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    if !(peak > 0.0) {
        // All-silent (or all-zero) clip: every window reads 0.0.
        return vec![0.0; samples.len().div_ceil(window_len)];
    }

    samples
        .chunks(window_len)
        .map(|window| {
            let sum_squares: f64 = window
                .iter()
                .map(|s| {
                    let s = f64::from(*s);
                    if s.is_finite() {
                        s * s
                    } else {
                        0.0
                    }
                })
                .sum();
            let rms = (sum_squares / window.len() as f64).sqrt();
            // peak > 0 is guaranteed by the early return above. The value is
            // carried as f32 (sample domain) and widened to f64 only at the
            // wire (`EnvelopeEventDto`).
            (rms / f64::from(peak)).clamp(0.0, 1.0) as f32
        })
        .collect()
}

/// Envelope window length in samples at `sample_rate` (min 1 so a
/// degenerate rate/window pair still makes progress).
pub fn window_len_samples(sample_rate: u32, window_ms: u32) -> usize {
    usize::max(1, (sample_rate as usize * window_ms as usize) / 1000)
}

// ---------------------------------------------------------------------------
// Envelope → CompanionEvent (`{ type: "envelope", rms }`, types.ts).
// ---------------------------------------------------------------------------

/// The `envelope` variant of the §4 `CompanionEvent` union
/// (`@natally/lore/types`: `EnvelopeEventSchema` — `rms: 0..=1`).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct EnvelopeEventDto {
    #[serde(rename = "type")]
    event_type: &'static str,
    rms: f64,
}

impl EnvelopeEventDto {
    pub const EVENT_TYPE: &'static str = "envelope";

    /// Builds the event, clamping `rms` into the schema's 0–1 range (NaN
    /// collapses to 0.0 — the wire must always validate).
    pub fn envelope(rms: f64) -> Self {
        Self {
            event_type: Self::EVENT_TYPE,
            rms: clamp01(rms),
        }
    }

    pub fn rms(&self) -> f64 {
        self.rms
    }
}

/// Clamps into [0, 1]; infinities clamp to the nearer bound, NaN collapses
/// to 0.0 (honest zero — the wire must never carry a NaN payload).
pub fn clamp01(rms: f64) -> f64 {
    if rms.is_nan() {
        0.0
    } else {
        rms.clamp(0.0, 1.0)
    }
}

/// Emits one envelope value on the §4 bus (`companion:event`). Called from
/// the gated playback tap (`audio.rs`) at real-time window boundaries; the
/// bus republishes to the Stage so Speaking binds to real playback (§10).
pub fn emit_envelope(app: &tauri::AppHandle, rms: f64) -> Result<(), VoiceError> {
    use tauri::Emitter;
    app.emit(BUS_CHANNEL, EnvelopeEventDto::envelope(rms))
        .map_err(|e| VoiceError::Event(format!("envelope emit: {e}")))
}

// ---------------------------------------------------------------------------
// Synthesis queue (pure, injected synth + sink — un-gated so queue order and
// mute semantics are unit-tested without ort, per the ruling).
// ---------------------------------------------------------------------------

/// One sentence of text → f32 PCM (mono, nominal −1..1). Implemented by the
/// gated Kokoro engine (`kokoro.rs`) and by test doubles.
pub trait SentenceSynth {
    fn synth_sentence(&mut self, text: &str) -> Result<Vec<f32>, VoiceError>;
}

/// Receives synthesized PCM in queue order. Implemented by the gated cpal
/// playback tap (`audio.rs`) and by test doubles.
pub trait PcmSink {
    fn play(&mut self, pcm: &[f32]) -> Result<(), VoiceError>;
    /// Called once after the queue has drained (flush side effects). Default
    /// no-op; the cpal sink lets its stream run dry naturally.
    fn finish(&mut self) -> Result<(), VoiceError> {
        Ok(())
    }
}

/// FIFO sentence-chunked synthesis queue (§4: companion turn → sentence
/// chunks → synth → playback). Owns the mute decision **before** synthesis:
/// a muted drain drops chunks without calling the synth or the sink, so a
/// muted queue produces zero synthesis work and zero envelope events.
///
/// Drain semantics (documented): chunks synthesize and play strictly in FIFO
/// order; a synthesis error stops the drain with `Err`, keeping the unspoken
/// remainder queued (call `clear()` to discard); already-played chunks stay
/// played.
pub struct SynthesisQueue<S: SentenceSynth, K: PcmSink> {
    synth: S,
    sink: K,
    pending: VecDeque<String>,
    muted: bool,
}

impl<S: SentenceSynth, K: PcmSink> SynthesisQueue<S, K> {
    pub fn new(synth: S, sink: K) -> Self {
        Self {
            synth,
            sink,
            pending: VecDeque::new(),
            muted: false,
        }
    }

    /// Chunks `text` into sentences (documented heuristic) and appends them
    /// to the pending queue in order.
    pub fn enqueue(&mut self, text: &str) {
        self.pending.extend(chunk_sentences(text));
    }

    /// Discards all pending chunks (muted drops already happened at drain).
    pub fn clear(&mut self) {
        self.pending.clear();
    }

    /// Mute is a hard stop applied at drain time — nothing downstream runs.
    pub fn set_muted(&mut self, muted: bool) {
        self.muted = muted;
    }

    pub fn is_muted(&self) -> bool {
        self.muted
    }

    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    /// Drains pending chunks in order. Returns the number of sentences
    /// synthesized AND played; `Err` stops at the first synthesis failure
    /// (unspoken remainder stays queued).
    pub fn drain(&mut self) -> Result<usize, VoiceError> {
        let mut spoken = 0usize;
        while let Some(sentence) = self.pending.pop_front() {
            if self.muted {
                continue; // drop silently: no synth call, no playback, no envelope
            }
            let pcm = self.synth.synth_sentence(&sentence)?;
            self.sink.play(&pcm)?;
            spoken += 1;
        }
        self.sink.finish()?;
        Ok(spoken)
    }

    /// Read-only access to the pending order (diagnostics/tests).
    pub fn pending_chunks(&self) -> impl Iterator<Item = &str> + '_ {
        self.pending.iter().map(String::as_str)
    }

    pub fn into_parts(self) -> (S, K) {
        (self.synth, self.sink)
    }
}

// ---------------------------------------------------------------------------
// Process-wide mute flag + config-store command stubs (module header seam).
// ---------------------------------------------------------------------------

static VOICE_MUTED: AtomicBool = AtomicBool::new(false);

/// Sets the process-wide voice mute flag. The command stub and the gated
/// playback tap both land here.
pub fn set_global_muted(muted: bool) {
    VOICE_MUTED.store(muted, Ordering::SeqCst);
}

/// Reads the process-wide voice mute flag (audio callback path).
pub fn global_muted() -> bool {
    VOICE_MUTED.load(Ordering::SeqCst)
}

/// Wire response of the mute commands (Settings › Voice toggle).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct MuteStateDto {
    pub muted: bool,
}

/// Mute command (config-store command stub seam): flips the process-wide
/// flag and reports the resulting state. `[I.2/config wiring]` — actual
/// persistence through the config store (surviving relaunch) is wired here
/// when I.2 lands; until then the flag is per-process, honestly.
#[tauri::command]
pub fn voice_set_mute(muted: bool) -> Result<MuteStateDto, String> {
    set_global_muted(muted);
    // [I.2/config wiring] persist via the config store, then reflect storage.
    Ok(MuteStateDto {
        muted: global_muted(),
    })
}

/// Reads the current mute state (Settings › Voice restore).
#[tauri::command]
pub fn voice_mute_state() -> Result<MuteStateDto, String> {
    Ok(MuteStateDto {
        muted: global_muted(),
    })
}

// ---------------------------------------------------------------------------
// Gated legs — compiled ONLY under the `voice-kokoro` feature (module header).
// ---------------------------------------------------------------------------

#[cfg(feature = "voice-kokoro")]
mod audio;
#[cfg(feature = "voice-kokoro")]
mod kokoro;

// ---------------------------------------------------------------------------
// Fixtures — chunking + RMS envelope over synthetic PCM, queue order + mute
// suppression. Run in the default build (no features) via the lib target
// once I.2 declares the module, and today via tests/voice.rs (module header).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic sine PCM: `freq` divides the window at `sr` into whole
    /// cycles (1000 Hz at 48 kHz = 20 cycles per 20 ms window), so every
    /// full window's RMS is amplitude/√2 with negligible float error.
    fn sine_pcm(len: usize, amplitude: f32, sample_rate: u32, freq: f64) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let phase = 2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(sample_rate);
                (f64::from(amplitude) * phase.sin()) as f32
            })
            .collect()
    }

    const SR: u32 = 48_000;
    const WINDOW: usize = 960; // 20 ms at 48 kHz
    const TOL: f64 = 1e-4;
    const FULL_SCALE_SINE: f64 = std::f64::consts::FRAC_1_SQRT_2;

    // -- Chunking fixtures ---------------------------------------------------

    #[test]
    fn voice_native_chunking_fixtures_pass() {
        // Multi-sentence, three terminators, trimmed.
        assert_eq!(
            chunk_sentences("Hello there. How are you? I missed you!"),
            vec!["Hello there.", "How are you?", "I missed you!"]
        );

        // Abbreviations stay intact (rule 1).
        assert_eq!(
            chunk_sentences("Mr. Smith waved. Then Dr. Jones left."),
            vec!["Mr. Smith waved.", "Then Dr. Jones left."]
        );

        // Initials and short tokens stay intact (rule 2): a.m./p.m. ride the
        // single-letter rule; decimals like 3.14 never split mid-number.
        assert_eq!(
            chunk_sentences("J. R. R. Tolkien wrote it. Yes."),
            vec!["J. R. R. Tolkien wrote it.", "Yes."]
        );
        assert_eq!(
            chunk_sentences("Meet at 3 p.m. sharp."),
            vec!["Meet at 3 p.m. sharp."]
        );
        assert_eq!(chunk_sentences("Pi is 3.14 ish."), vec!["Pi is 3.14 ish."]);

        // Dot runs stick together (rule 3): ASCII "..." stays one chunk.
        assert_eq!(
            chunk_sentences("Wait... are you sure?"),
            vec!["Wait...", "are you sure?"]
        );

        // The ellipsis character IS a terminator.
        assert_eq!(
            chunk_sentences("I thought so… Then left."),
            vec!["I thought so…", "Then left."]
        );

        // Semicolon is NOT a terminator (clause pause, module header).
        assert_eq!(
            chunk_sentences("First part; second part."),
            vec!["First part; second part."]
        );

        // Closing quotes stay attached (rule 4).
        assert_eq!(
            chunk_sentences("She said \"Stop.\" Then left."),
            vec!["She said \"Stop.\"", "Then left."]
        );

        // Never mid-word: every cut lands after a terminator; the whole text
        // is conserved (modulo whitespace at cuts).
        let joined: String = chunk_sentences("One. Two. Three.").join(" ");
        assert_eq!(joined, "One. Two. Three.");
    }

    #[test]
    fn voice_native_chunking_empty_text_pass() {
        assert!(chunk_sentences("").is_empty());
        assert!(chunk_sentences("   \n\t  ").is_empty());
    }

    // -- RMS envelope fixtures -----------------------------------------------

    #[test]
    fn voice_native_rms_envelope_fixtures_pass() {
        // Deterministic sine: amplitude 0.5 ⇒ peak-normalized window RMS of
        // 1/√2 in every full window (fixture law, module header).
        let sine = sine_pcm(WINDOW * 3, 0.5, SR, 1000.0);
        let envelope = rms_envelope(&sine, SR, ENVELOPE_WINDOW_MS);
        assert_eq!(envelope.len(), 3);
        for value in &envelope {
            assert!(
                (f64::from(*value) - FULL_SCALE_SINE).abs() < TOL,
                "expected ~{FULL_SCALE_SINE}, got {value}"
            );
        }

        // Peak-normalization invariance: half the amplitude reads the same
        // normalized envelope (the global peak scales out).
        let quiet = sine_pcm(WINDOW * 2, 0.25, SR, 1000.0);
        let quiet_envelope = rms_envelope(&quiet, SR, ENVELOPE_WINDOW_MS);
        assert_eq!(quiet_envelope.len(), 2);
        for value in &quiet_envelope {
            assert!((f64::from(*value) - FULL_SCALE_SINE).abs() < TOL);
        }

        // Silence ⇒ 0.0 everywhere (window law: empty/silent window reads 0).
        let silence = vec![0.0f32; WINDOW * 2];
        assert_eq!(
            rms_envelope(&silence, SR, ENVELOPE_WINDOW_MS),
            vec![0.0, 0.0]
        );

        // Mixed clip: a silent window reads 0.0, the sine windows read 1/√2.
        let mut mixed = vec![0.0f32; WINDOW];
        mixed.extend(sine_pcm(WINDOW * 2, 0.5, SR, 1000.0));
        let mixed_envelope = rms_envelope(&mixed, SR, ENVELOPE_WINDOW_MS);
        assert_eq!(mixed_envelope.len(), 3);
        assert_eq!(mixed_envelope[0], 0.0);
        assert!((f64::from(mixed_envelope[1]) - FULL_SCALE_SINE).abs() < TOL);
        assert!((f64::from(mixed_envelope[2]) - FULL_SCALE_SINE).abs() < TOL);

        // Trailing partial window (half a window = 5 whole sine cycles) is
        // still measured, with the same deterministic value.
        let mut partial = sine_pcm(WINDOW * 2, 0.5, SR, 1000.0);
        partial.extend(sine_pcm(WINDOW / 2, 0.5, SR, 1000.0));
        let partial_envelope = rms_envelope(&partial, SR, ENVELOPE_WINDOW_MS);
        assert_eq!(partial_envelope.len(), 3);
        assert!((f64::from(partial_envelope[2]) - FULL_SCALE_SINE).abs() < TOL);

        // Empty input ⇒ empty envelope; all values stay inside 0–1.
        assert!(rms_envelope(&[], SR, ENVELOPE_WINDOW_MS).is_empty());
        assert!(envelope.iter().all(|v| (0.0..=1.0).contains(v)));
    }

    // -- Queue order + mute suppression ---------------------------------------

    struct RecSynth {
        calls: Vec<String>,
        fail_on: Option<String>,
    }

    impl RecSynth {
        fn new() -> Self {
            Self {
                calls: Vec::new(),
                fail_on: None,
            }
        }
    }

    impl SentenceSynth for RecSynth {
        fn synth_sentence(&mut self, text: &str) -> Result<Vec<f32>, VoiceError> {
            self.calls.push(text.to_owned());
            if self.fail_on.as_deref() == Some(text) {
                return Err(VoiceError::Synthesis("injected failure".into()));
            }
            Ok(vec![0.25, -0.25])
        }
    }

    struct RecSink {
        played: Vec<f32>,
    }

    impl RecSink {
        fn new() -> Self {
            Self { played: Vec::new() }
        }
    }

    impl PcmSink for RecSink {
        fn play(&mut self, pcm: &[f32]) -> Result<(), VoiceError> {
            self.played.extend_from_slice(pcm);
            Ok(())
        }
    }

    #[test]
    fn voice_native_queue_order_and_mute_fixtures_pass() {
        // FIFO order: three sentences enqueue → synthesize → play in order.
        let mut queue = SynthesisQueue::new(RecSynth::new(), RecSink::new());
        queue.enqueue("One. Two. Three.");
        assert_eq!(queue.pending(), 3);
        assert_eq!(
            queue.pending_chunks().collect::<Vec<_>>(),
            vec!["One.", "Two.", "Three."]
        );
        let spoken = queue.drain().expect("drain succeeds");
        assert_eq!(spoken, 3);
        let (synth, sink) = queue.into_parts();
        assert_eq!(synth.calls, vec!["One.", "Two.", "Three."]);
        assert_eq!(sink.played, vec![0.25, -0.25, 0.25, -0.25, 0.25, -0.25]);

        // Mute suppression: a muted queue drops chunks with zero synthesis
        // work and zero playback; unmute resumes with the next enqueues.
        let mut queue = SynthesisQueue::new(RecSynth::new(), RecSink::new());
        queue.enqueue("Heard. Not heard.");
        queue.set_muted(true);
        assert!(queue.is_muted());
        assert_eq!(queue.drain().expect("muted drain succeeds"), 0);
        let (synth, sink) = queue.into_parts();
        assert!(synth.calls.is_empty(), "muted queue never synthesizes");
        assert!(sink.played.is_empty(), "muted queue never plays");

        let mut queue = SynthesisQueue::new(synth, sink);
        queue.set_muted(false);
        queue.enqueue("Back.");
        assert_eq!(queue.drain().expect("unmuted drain succeeds"), 1);
        assert_eq!(queue.into_parts().0.calls, vec!["Back."]);

        // Synthesis failure mid-queue: drain stops with Err, the spoken
        // prefix stays played, the unspoken remainder stays queued.
        let mut queue = SynthesisQueue::new(RecSynth::new(), RecSink::new());
        queue.enqueue("Alpha. Beta. Gamma.");
        queue.synth.fail_on = Some("Beta.".to_owned());
        let outcome = queue.drain();
        assert!(outcome.is_err(), "injected failure must surface");
        assert_eq!(queue.pending(), 1, "unspoken remainder stays queued");
        assert_eq!(
            queue.pending_chunks().collect::<Vec<_>>(),
            vec!["Gamma."]
        );
        queue.synth.fail_on = None;
        assert_eq!(queue.drain().expect("retry succeeds"), 1);

        // clear() discards the pending remainder.
        queue.enqueue("Dropped.");
        assert_eq!(queue.pending(), 1);
        queue.clear();
        assert_eq!(queue.pending(), 0);
        assert_eq!(queue.drain().expect("drain of empty queue"), 0);
    }

    // -- Envelope event contract ----------------------------------------------

    #[test]
    fn voice_native_envelope_event_matches_contract_pass() {
        // Exact TS shape: { "type": "envelope", "rms": <0..1> } per
        // EnvelopeEventSchema in packages/lore/src/types.ts.
        let event = EnvelopeEventDto::envelope(0.5);
        assert_eq!(
            serde_json::to_string(&event).expect("dto serializes"),
            r#"{"type":"envelope","rms":0.5}"#
        );

        // Schema clamps: rms must land in [0, 1]; NaN collapses to 0.
        assert_eq!(EnvelopeEventDto::envelope(1.5).rms(), 1.0);
        assert_eq!(EnvelopeEventDto::envelope(-0.2).rms(), 0.0);
        assert_eq!(EnvelopeEventDto::envelope(f64::NAN).rms(), 0.0);
        assert_eq!(EnvelopeEventDto::envelope(f64::INFINITY).rms(), 1.0);
        assert_eq!(EnvelopeEventDto::envelope(f64::NEG_INFINITY).rms(), 0.0);

        // The bus channel is the §4 companion bus.
        assert_eq!(BUS_CHANNEL, "companion:event");
    }
}
