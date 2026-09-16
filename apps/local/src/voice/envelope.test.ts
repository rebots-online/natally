// natally — V.2 envelope fixtures (TR-5): deterministic sine, silence, mixed
// amplitudes, partial windows, peak normalization. The Accept line's first
// clause is this suite's name; the second clause is printed by
// scripts/grep-no-speechsynthesis.sh on success (the token itself must never
// appear in apps/**/src — this file included).
import { describe, expect, it } from "vitest";
import { WINDOW_MS, rmsEnvelope, windowSizeFor } from "./envelope";

/** Deterministic sine: amplitude × sin(2π·i/period), i = 0..samples-1. */
function sine(samples: number, period: number, amplitude = 1): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * i) / period);
  }
  return out;
}

describe("voice web: envelope fixtures pass", () => {
  it("window size is round(sampleRate × WINDOW_MS / 1000), min 1", () => {
    expect(WINDOW_MS).toBe(20);
    expect(windowSizeFor(1000)).toBe(20);
    expect(windowSizeFor(24000)).toBe(480);
    expect(windowSizeFor(44100)).toBe(882);
    expect(windowSizeFor(30)).toBe(1);
    expect(() => windowSizeFor(0)).toThrow(/sampleRate/);
    expect(() => rmsEnvelope(new Float32Array(4), -5)).toThrow(/sampleRate/);
  });

  it("silence is all zeros (empty window ⇒ 0.0), never NaN", () => {
    const silence = new Float32Array(200); // 10 windows @ 1 kHz
    const envelope = rmsEnvelope(silence, 1000);
    expect(envelope).toHaveLength(10);
    for (const value of envelope) {
      expect(value).toBe(0);
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("empty input yields no windows", () => {
    expect(rmsEnvelope(new Float32Array(0), 1000)).toEqual([]);
    expect(rmsEnvelope([], 1000)).toEqual([]);
  });

  it("a full-period-per-window sine peak-normalizes every window to 1", () => {
    // 50 Hz @ 1 kHz: period 20 samples == one 20 ms window, so every window
    // measures the same RMS and normalizes to the peak.
    const envelope = rmsEnvelope(sine(200, 20), 1000);
    expect(envelope).toHaveLength(10);
    for (const value of envelope) {
      expect(value).toBeCloseTo(1, 9);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("mixed amplitudes normalize linearly (0.5-amplitude half ⇒ 0.5)", () => {
    const pcm = new Float32Array(200);
    pcm.set(sine(100, 20, 1), 0);
    pcm.set(sine(100, 20, 0.5), 100);
    const envelope = rmsEnvelope(pcm, 1000);
    expect(envelope).toHaveLength(10);
    for (let i = 0; i < 5; i += 1) {
      expect(envelope[i]).toBeCloseTo(1, 9);
    }
    for (let i = 5; i < 10; i += 1) {
      expect(envelope[i]).toBeCloseTo(0.5, 9);
    }
  });

  it("a trailing partial window is measured over the samples it holds", () => {
    const envelope = rmsEnvelope(sine(205, 20), 1000); // 10 full + 5 samples
    expect(envelope).toHaveLength(11);
    for (const value of envelope) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // The 5-sample tail still holds energy ⇒ not silent, and in [0, 1].
    expect(envelope[10]).toBeGreaterThan(0);
  });

  it("peak normalization pins the loudest window to 1 and zeroes silent ones", () => {
    // @ 100 Hz the window is 2 samples: [0.6, -0.6] then four zeros.
    const pcm = Float32Array.of(0.6, -0.6, 0, 0, 0, 0);
    expect(rmsEnvelope(pcm, 100)).toEqual([1, 0, 0]);
  });

  it("every value stays within [0, 1] on a varied clip", () => {
    const pcm = new Float32Array(240);
    pcm.set(sine(80, 20, 1), 0);
    pcm.set(sine(80, 40, 0.25), 80);
    pcm.set(sine(80, 10, 0.75), 160);
    for (const value of rmsEnvelope(pcm, 1000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
