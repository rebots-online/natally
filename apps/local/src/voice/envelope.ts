// natally — THE shared RMS envelope math (TR-5). Pure functions, zero imports.
//
// Both legs implement these exact rules; they must agree to ±1e-3 on identical
// samples (DOCS/TEST_RUBRIC.md TR-5, verified at I.4 / release review):
//   1. Windows are WINDOW_MS (20 ms) long: windowSize = round(sampleRate * 20 / 1000).
//   2. One RMS value per window, accumulated in fixed left-to-right sample order
//      (the accumulation order is part of the contract — it is what makes the
//      two legs bit-comparable).
//   3. A trailing partial window (fewer than windowSize samples) is measured
//      over the samples it actually holds; no PCM is dropped.
//   4. An empty window yields 0.0 — which in practice means an all-silent
//      window is exactly 0.0 (sqrt(0/n)); empty input yields no windows ([]).
//   5. Raw window RMS values are peak-normalized to 0–1 by the maximum window
//      RMS across the whole clip. An all-silent clip normalizes to all zeros —
//      never NaN, never a division by zero.
//   6. Every output value is within [0, 1].
//
// The companion bus shape these values feed is `@natally/lore/types`'
// EnvelopeEvent: `{ type: "envelope", rms }`.

/** Window length in milliseconds (normative: 20 ms per TR-5). */
export const WINDOW_MS = 20;

/**
 * Window size in samples for a sample rate. Always ≥ 1 so that degenerate
 * sample rates (< 50 Hz) still produce well-defined windows.
 */
export function windowSizeFor(sampleRate: number): number {
  if (!(sampleRate > 0)) {
    throw new Error(`rmsEnvelope: sampleRate must be > 0, got ${String(sampleRate)}`);
  }
  return Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
}

/**
 * Per-20 ms-window RMS envelope, peak-normalized to [0, 1] (rules above).
 * Deterministic: same samples + same sample rate ⇒ same output, on both legs.
 */
export function rmsEnvelope(
  pcm: readonly number[] | Float32Array,
  sampleRate: number,
): number[] {
  const windowSize = windowSizeFor(sampleRate);
  const raw: number[] = [];
  let sumSquares = 0;
  let count = 0;
  for (const value of pcm) {
    sumSquares += value * value;
    count += 1;
    if (count === windowSize) {
      raw.push(Math.sqrt(sumSquares / windowSize));
      sumSquares = 0;
      count = 0;
    }
  }
  if (count > 0) {
    // Trailing partial window: measured over what it holds (rule 3).
    raw.push(Math.sqrt(sumSquares / count));
  }
  if (raw.length === 0) {
    return []; // empty input ⇒ no windows (rule 4)
  }
  let peak = 0;
  for (const value of raw) {
    if (value > peak) peak = value;
  }
  if (peak === 0) {
    return raw.map(() => 0); // all-silent clip ⇒ all zeros, no division (rule 5)
  }
  return raw.map((value) => Math.min(1, value / peak));
}
