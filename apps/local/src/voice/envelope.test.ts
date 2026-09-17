import { describe, expect, it } from "vitest";
import { rmsEnvelope } from "./envelope";

describe("voice web: envelope fixtures", () => {
  it("measures silence, DC, alternating polarity, and a full sine period", () => {
    expect(rmsEnvelope([])).toBe(0);
    expect(rmsEnvelope(new Float32Array(240))).toBe(0);
    expect(rmsEnvelope([0.5, 0.5, 0.5])).toBe(0.5);
    expect(rmsEnvelope([-0.5, 0.5, -0.5, 0.5])).toBe(0.5);
    const sine = Float32Array.from({ length: 240 }, (_, index) =>
      Math.sin((2 * Math.PI * index) / 240),
    );
    expect(rmsEnvelope(sine)).toBeCloseTo(Math.SQRT1_2, 7);
  });

  it("normalizes by sample count, bounds peaks, and refuses invalid PCM", () => {
    expect(rmsEnvelope([1, 0, 0, 0])).toBe(0.5);
    expect(rmsEnvelope([2, -2])).toBe(1);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => rmsEnvelope([value])).toThrow("PCM samples must be finite");
    }
  });
});
