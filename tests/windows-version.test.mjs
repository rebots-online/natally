// WP.3 tests — ARCHITECTURE §20.4 boundary fixtures + monotonicity.
// Run: node --test tests/windows-version.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { msiVersion, msixVersion, assertInLimits, readOrdinal, writeOrdinal } from "../scripts/windows-version.mjs";

function tmpOrdinal(n) {
  const dir = mkdtempSync(join(tmpdir(), "winver-"));
  const path = join(dir, "windows-release-ordinal");
  writeOrdinal(n, path);
  return path;
}

test("boundary fixtures map exactly per §20.4", () => {
  const cases = [
    [0, "1.0.0", "1.0.0.0"],
    [1, "1.0.1", "1.0.1.0"],
    [65535, "1.0.65535", "1.0.65535.0"],
    [65536, "1.1.0", "1.1.0.0"],
    [2 ** 24, "2.0.0", "1.256.0.0"],
    [2 ** 24 + 1, "2.0.1", "1.256.1.0"],
    [254 * 2 ** 24 + 255 * 65536 + 65535, "255.255.65535", "1.65279.65535.0"],
  ];
  for (const [n, msi, msix] of cases) {
    assert.equal(msiVersion(n), msi, `msi(${n})`);
    assert.equal(msixVersion(n), msix, `msix(${n})`);
    assert.doesNotThrow(() => assertInLimits(n), `limits(${n})`);
  }
});

test("overflow at 255*2^24 errors, never truncates", () => {
  assert.throws(() => assertInLimits(255 * 2 ** 24), /overflows MSI ProductVersion/);
  assert.throws(() => msiVersion(255 * 2 ** 24), /overflows MSI ProductVersion/);
  assert.throws(() => msixVersion(255 * 2 ** 24), /overflows MSI ProductVersion/);
});

test("msi and msix strings are monotonically non-decreasing in n", () => {
  const probes = [];
  for (let n = 0; n <= 300; n++) probes.push(n);
  for (const n of [65534, 65535, 65536, 65537, 2 ** 24 - 1, 2 ** 24, 2 ** 24 + 1, 2 ** 25, 2 ** 25 + 65535, 254 * 2 ** 24 + 255 * 65536 + 65535]) {
    probes.push(n);
  }
  probes.sort((a, b) => a - b);
  const cmp = (a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  };
  for (let i = 1; i < probes.length; i++) {
    const lo = probes[i - 1];
    const hi = probes[i];
    assert.ok(cmp(msiVersion(lo), msiVersion(hi)) <= 0, `msi monotonic at ${lo} -> ${hi}`);
    assert.ok(cmp(msixVersion(lo), msixVersion(hi)) <= 0, `msix monotonic at ${lo} -> ${hi}`);
  }
});

test("ordinal persists and round-trips (one integer, # comments)", () => {
  const path = tmpOrdinal(42);
  assert.equal(readOrdinal(path), 42);
  writeOrdinal(43, path);
  assert.equal(readOrdinal(path), 43);
  writeFileSync(path, "# comment line\n7\n# trailing\n");
  assert.equal(readOrdinal(path), 7);
  writeFileSync(path, "1\n2\n");
  assert.throws(() => readOrdinal(path), /exactly one integer/);
  writeFileSync(path, "-3\n");
  assert.throws(() => readOrdinal(path), /non-negative integer/);
});
