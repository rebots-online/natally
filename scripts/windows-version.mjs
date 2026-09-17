#!/usr/bin/env node
// WP.3 — Version ordinal mapping, ARCHITECTURE §20.4 (normative formulas, transcribed exactly).
// Ordinal persists in config/windows-release-ordinal; increments once per release.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORDINAL_PATH = join(root, "config", "windows-release-ordinal");

export function readOrdinal(path = ORDINAL_PATH) {
  if (!existsSync(path)) {
    throw new Error(`missing ${path}: expected a single integer ordinal`);
  }
  const ints = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0);
  if (ints.length !== 1) {
    throw new Error(`${path}: expected exactly one integer, found ${ints.length}`);
  }
  const n = Number(ints[0]);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${path}: ordinal must be a non-negative integer, got "${ints[0]}"`);
  }
  return n;
}

export function writeOrdinal(n, path = ORDINAL_PATH) {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`ordinal must be a non-negative integer, got ${n}`);
  }
  writeFileSync(path, `# Windows release ordinal n (ARCHITECTURE §20.4). One integer per line; # comments allowed.\n${n}\n`);
}

// §20.4, EXACTLY:
//   msi  = [1 + floor(n / 2^24), floor(n / 65536) % 256, n % 65536].join(".")
//   msix = [1, floor(n / 65536), n % 65536, 0].join(".")
export function msiVersion(n) {
  assertInLimits(n);
  return [1 + Math.floor(n / 2 ** 24), Math.floor(n / 65536) % 256, n % 65536].join(".");
}

export function msixVersion(n) {
  assertInLimits(n);
  return [1, Math.floor(n / 65536), n % 65536, 0].join(".");
}

// MSI ProductVersion limits: fields <= 255/255/65535. Never truncate or extra-modulo.
export function assertInLimits(n) {
  const major = 1 + Math.floor(n / 2 ** 24);
  if (major > 255) {
    throw new Error(
      `ordinal ${n} overflows MSI ProductVersion: field1 ${major} > 255 (max ordinal ${254 * 2 ** 24 + 255 * 65536 + 65535})`,
    );
  }
}

export function main(argv) {
  const cmd = argv[0];
  if (cmd === "--show") {
    const n = readOrdinal();
    console.log(`n=${n}`);
    console.log(`msi=${msiVersion(n)}`);
    console.log(`msix=${msixVersion(n)}`);
  } else if (cmd === "--bump") {
    // Note: no flock helper exists in scripts/ (release.lock is consumed by
    // update-version.sh's own logic, not a lock API), so this is a plain write.
    const n = readOrdinal();
    const next = n + 1;
    assertInLimits(next);
    writeOrdinal(next);
    console.log(`n=${n} -> ${next}`);
  } else if (cmd === "--check") {
    const n = readOrdinal();
    const major = 1 + Math.floor(n / 2 ** 24);
    if (major > 255) {
      throw new Error(`FAIL: ordinal ${n} exceeds MSI field limits (field1 ${major} > 255)`);
    }
    if (Math.floor(n / 65536) % 256 > 255 || n % 65536 > 65535) {
      throw new Error(`FAIL: ordinal ${n} exceeds MSI field limits`);
    }
    console.log("PASS");
  } else {
    throw new Error("Usage: node scripts/windows-version.mjs [--show | --bump | --check]");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
