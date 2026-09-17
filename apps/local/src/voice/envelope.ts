/** Shared with native voice: sqrt(mean(sample²)), bounded to the bus's [0, 1]. */
export function rmsEnvelope(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) throw new TypeError("PCM samples must be finite");
    squares += sample * sample;
  }
  return Math.min(1, Math.sqrt(squares / samples.length));
}
