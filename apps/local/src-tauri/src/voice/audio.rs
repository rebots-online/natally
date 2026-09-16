//! natally — voice subsystem, cpal playback + envelope tap (task V.1,
//! ARCHITECTURE §10: "playback (Rust audio) → RMS envelope → Stage speaking").
//!
//! Compiled ONLY under the cargo feature `voice-kokoro` (declared and
//! documented in `super`/mod.rs). Per the V.1 architect ruling the `cpal`
//! dependency lands with I.2's registry wiring — this file has therefore NOT
//! been compiled by V.1 (no crate in the tree by ruling). It is written
//! against the `cpal` 0.15 API surface; exact item paths are pinned when I.2
//! wires the dependency (same compile-deferred status as C.1's
//! `inference/llama.rs`).
//!
//! # Design
//!
//! - The sink implements [`super::PcmSink`]: each played sentence arrives as
//!   whole PCM, so the envelope is precomputed over the complete clip with
//!   the pure `rms_envelope` (global-peak normalization — module header law
//!   in `super`) and then emitted at real-time window boundaries during
//!   playback, on the §4 `companion:event` bus, via `super::emit_envelope`.
//! - The cpal data callback runs on the audio thread and owns a
//!   `Arc<Mutex<PlaybackState>>` shared with the sink; the lock is taken with
//!   `try_lock` — on contention the callback emits silence rather than
//!   glitching the stream (documented policy).
//! - The `tauri::AppHandle` is `Send + Sync` (tauri 2), so emitting from the
//!   audio thread is sound; `app.emit` failures are swallowed at the callback
//!   (a dropped envelope frame must never kill playback — the Stage simply
//!   holds its last real state, STATES.md law).
//! - Mute double-guard: the queue already suppresses muted playback
//!   (`super::SynthesisQueue`), and the callback consults
//!   `super::global_muted()` per window so a mid-utterance `voice_set_mute`
//!   silences output immediately (the command seam in `super`).
//!
//! # Honest constraint
//!
//! The stream is requested at the Kokoro rate ([`super::kokoro::
//! KOKORO_SAMPLE_RATE`], 24 kHz). Devices that refuse it fail with an honest
//! [`super::VoiceError::Audio`]; a resampler pass is a later, explicitly
//! scoped addition — never a silent rate mismatch.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::kokoro::KOKORO_SAMPLE_RATE;
use super::{emit_envelope, global_muted, rms_envelope, window_len_samples, PcmSink, VoiceError};

/// Envelope window length in Kokoro-rate samples (20 ms @ 24 kHz = 480).
fn kokoro_window_len() -> usize {
    window_len_samples(KOKORO_SAMPLE_RATE, super::ENVELOPE_WINDOW_MS)
}

/// One synthesized sentence staged for playback with its precomputed
/// peak-normalized envelope (one value per [`kokoro_window_len`] samples).
struct StagedClip {
    pcm: Vec<f32>,
    envelope: Vec<f32>,
    /// Playback position within `pcm` (samples already handed to the device).
    position: usize,
    /// Index of the next envelope value to emit.
    envelope_index: usize,
}

/// State shared between the sink (enqueue) and the cpal data callback
/// (dequeue + emit). Locked from the audio thread with `try_lock`.
type PlaybackState = Mutex<VecDeque<StagedClip>>;

/// cpal-backed PCM sink. Dropping it detaches the stream (cpal semantics) —
/// the session layer owns the lifetime (I.2/I.3 wiring).
pub struct CpalPcmSink {
    state: Arc<PlaybackState>,
    stream: cpal::Stream,
}

impl CpalPcmSink {
    /// Opens the default output device at the Kokoro rate and starts the
    /// stream. Honest failure when the device is absent or rejects the rate
    /// (module header).
    pub fn open(app: tauri::AppHandle) -> Result<Self, VoiceError> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| VoiceError::Audio("no default output device".into()))?;
        let mut config: cpal::StreamConfig = device
            .default_output_config()
            .map_err(|e| VoiceError::Audio(format!("output config: {e}")))?
            .into();
        config.sample_rate = cpal::SampleRate(KOKORO_SAMPLE_RATE);

        let state: Arc<PlaybackState> = Arc::new(Mutex::new(VecDeque::new()));
        let cb_state = Arc::clone(&state);
        let cb_app = app;
        let stream = device
            .build_output_stream(
                &config,
                move |out: &mut [f32], _info| fill_output(&cb_state, &cb_app, out),
                move |err| {
                    // Device errors are terminal for the stream; the session
                    // layer (I.2/I.3) surfaces recovery. Never panic in a
                    // real-time callback.
                    let _ = err;
                },
                None,
            )
            .map_err(|e| VoiceError::Audio(format!("output stream: {e}")))?;
        stream
            .play()
            .map_err(|e| VoiceError::Audio(format!("stream start: {e}")))?;
        Ok(Self { state, stream })
    }
}

impl PcmSink for CpalPcmSink {
    /// Stages one sentence of PCM with its precomputed envelope. Muted input
    /// is dropped here too (belt-and-braces: the queue already suppresses).
    fn play(&mut self, pcm: &[f32]) -> Result<(), VoiceError> {
        if global_muted() || pcm.is_empty() {
            return Ok(());
        }
        let envelope = rms_envelope(pcm, KOKORO_SAMPLE_RATE, super::ENVELOPE_WINDOW_MS);
        let staged = StagedClip {
            pcm: pcm.to_vec(),
            envelope,
            position: 0,
            envelope_index: 0,
        };
        self.state
            .lock()
            .map_err(|_| VoiceError::Audio("playback state mutex poisoned".into()))?
            .push_back(staged);
        Ok(())
    }
}

/// cpal data callback: drains staged clips into the device buffer and emits
/// one envelope event per crossed 20 ms window boundary. Contended lock ⇒
/// silence for this callback (module header policy).
fn fill_output(state: &PlaybackState, app: &tauri::AppHandle, out: &mut [f32]) {
    out.fill(0.0);
    let Ok(mut queue) = state.lock() else {
        return;
    };
    let window_len = kokoro_window_len();
    let mut written = 0usize;

    while written < out.len() {
        let Some(clip) = queue.front_mut() else {
            break; // stream runs dry until the next sentence is staged
        };

        let take = (clip.pcm.len() - clip.position).min(out.len() - written);
        out[written..written + take]
            .copy_from_slice(&clip.pcm[clip.position..clip.position + take]);
        clip.position += take;
        written += take;

        // Emit every window boundary crossed inside this callback slice.
        while clip.position >= (clip.envelope_index + 1) * window_len {
            if let Some(value) = clip.envelope.get(clip.envelope_index) {
                if !global_muted() {
                    // A dropped envelope frame must never kill playback.
                    let _ = emit_envelope(app, f64::from(*value));
                }
            }
            clip.envelope_index += 1;
        }

        if clip.position == clip.pcm.len() {
            // Flush the trailing partial window so the Stage sees the tail.
            if clip.envelope_index < clip.envelope.len() && !global_muted() {
                let _ = emit_envelope(app, f64::from(clip.envelope[clip.envelope_index]));
            }
            queue.pop_front();
        }
    }
}
