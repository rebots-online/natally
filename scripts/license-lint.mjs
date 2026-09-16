#!/usr/bin/env node
// natally — license-lint (R.7). Pure node, no dependencies.
//
// Enforces the §6 AGPL posture (D14 ephemeris seam): while `sweph-wasm` is in
// the dependency tree the product is AGPL-3.0-or-later; the proprietary flip
// (D9) is legal only once no `sweph` usage remains. Both directions checked:
//
//   sweph-present + AGPL-3.0-or-later  -> OK   (incumbent state)
//   sweph-present + non-AGPL           -> FAIL (exit 1)
//   sweph-absent  + AGPL               -> OK
//   sweph-absent  + proprietary        -> OK   (D9 target state)
//
// Scan roots: apps/**/src/**, packages/**/src/**, services/**/src/** —
// including apps/*/src-tauri/src (the Rust tree). File types: .ts, .tsx, .rs.
// The pattern set is documented below and echoed in the output. Standalone
// runnable from any working directory (same convention as
// scripts/grep-no-speechsynthesis.sh).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGPL = 'AGPL-3.0-or-later';

// Documented pattern set (case-sensitive, matched per source line; echoed in
// the output so the verdict is auditable).
const PATTERNS = [
  {
    id: "from 'sweph-wasm'",
    re: /from\s+['"]sweph-wasm/,
    desc: 'JS/TS static import or re-export (prefix match, covers subpath imports)',
  },
  {
    id: "import('sweph-wasm')",
    re: /import\s*\(\s*['"]sweph-wasm/,
    desc: 'JS/TS dynamic import',
  },
  {
    id: "require('sweph-wasm')",
    re: /require\s*\(\s*['"]sweph-wasm/,
    desc: 'JS/TS CommonJS require',
  },
  {
    id: 'use sweph_wasm',
    re: /\buse\s+sweph_wasm\b/,
    desc: 'Rust use-module',
  },
  {
    id: 'sweph(_wasm)::',
    re: /\bsweph(?:_wasm)?::/,
    desc: 'Rust path usage',
  },
];

const EXTS = new Set(['.ts', '.tsx', '.rs']);
const PRUNE = new Set(['node_modules', '.git', 'dist', 'target', '.tmp']);
const TOP_DIRS = ['apps', 'packages', 'services'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Collect every directory named `src` under the top dirs (apps, packages,
// services) — this naturally covers apps/<app>/src and
// apps/<app>/src-tauri/src without hardcoding app names.
function* walkDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || PRUNE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    yield full;
    yield* walkDirs(full);
  }
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNE.has(entry.name)) yield* walkFiles(path.join(dir, entry.name));
    } else if (EXTS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

const srcRoots = [];
for (const top of TOP_DIRS) {
  const topPath = path.join(repoRoot, top);
  if (!existsSync(topPath)) continue;
  for (const d of walkDirs(topPath)) {
    if (path.basename(d) === 'src') srcRoots.push(d);
  }
}

const files = [];
for (const root of srcRoots) files.push(...walkFiles(root));
files.sort();

const hits = [];
for (const file of files) {
  const rel = path.relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) {
      if (p.re.test(lines[i])) hits.push({ file: rel, line: i + 1, pattern: p.id });
    }
  }
}

// Root package.json license field. Unreadable manifest fails closed.
let license = '(missing)';
const pkgPath = path.join(repoRoot, 'package.json');
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (typeof pkg.license === 'string' && pkg.license.trim() !== '') license = pkg.license.trim();
} catch (err) {
  console.error(`license-lint: cannot read/parse package.json: ${err.message}`);
  process.exit(1);
}
const isAgpl = license === AGPL;
const swephPresent = hits.length > 0;

console.log('license-lint: pattern set (case-sensitive, per line):');
for (const p of PATTERNS) console.log(`  - ${p.id.padEnd(22)} ${p.desc}`);
console.log(
  `license-lint: roots: ${TOP_DIRS.map((t) => `${t}/**/src`).join(', ')} (incl. apps/*/src-tauri/src); types: .ts .tsx .rs`,
);
console.log(
  `license-lint: scanned ${files.length} file(s) across ${srcRoots.length} src root(s)`,
);
if (swephPresent) {
  console.log(`license-lint: sweph hits: ${hits.length}`);
  for (const h of hits) console.log(`  ${h.file}:${h.line} [${h.pattern}]`);
} else {
  console.log('license-lint: sweph hits: 0');
}
console.log(`license-lint: package.json license = "${license}"`);

if (swephPresent && isAgpl) {
  console.log(`license-lint: state: sweph-present + ${AGPL} — incumbent sweph-wasm posture (§6/D14)`);
  console.log('license-lint: AGPL + sweph consistent (state OK)');
  process.exit(0);
}
if (swephPresent && !isAgpl) {
  console.error(
    `license-lint: FAIL — sweph usage present while package.json.license = "${license}" ≠ "${AGPL}" ` +
      '(both directions violated: sweph import requires AGPL; a proprietary claim requires sweph absence — §6/D14)',
  );
  console.error('license-lint: AGPL + sweph inconsistent (state FAIL)');
  process.exit(1);
}
if (!swephPresent && isAgpl) {
  console.log(`license-lint: state: sweph-absent + ${AGPL} — AGPL posture retained without sweph-wasm`);
  console.log('license-lint: AGPL + sweph consistent (state OK)');
  process.exit(0);
}
// !swephPresent && !isAgpl
console.log(`license-lint: state: sweph-absent + proprietary ("${license}") — D9 target state`);
console.log('license-lint: AGPL + sweph consistent (state OK)');
process.exit(0);
