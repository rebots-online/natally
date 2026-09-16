#!/usr/bin/env node
// natally — bundle-budget assert (§12, TR-8; task I.4). Pure node, no dependencies.
//
// Gate: the built web INITIAL JS the browser loads for `/` must be ≤ 300 KB
// gzipped. "Initial JS" is precisely:
//
//   dist/web/index.html
// + every JS chunk reached from index.html's direct
//   <script type="module" src=...> entry (or entries) through STATIC imports
//   only — transitive `import "./x.js"` / `... from "./x.js"` edges.
//
// Everything reachable ONLY through a dynamic `import("...")` (today the lazy
// `import("./ui/router")` and, behind it, all screens) is NOT initial JS —
// that exclusion is the architecture's lazy law (§4/§12), so those chunks are
// reported as INFO, never summed.
//
// Measurement, in order of preference (documented per run):
//   1. vite manifest (dist/web/.vite/manifest.json) when emitted: walk the
//      entry chunk's `imports` (static) recursively, ignore `dynamicImports`.
//   2. Fallback (this repo's default — vite manifest is not enabled): parse
//      index.html for module entry scripts, then scan each built chunk's
//      source for static-import edges. CSS `<link>`s and `modulepreload`
//      hrefs are read for the report; CSS is never summed (the mandate is
//      initial JS; index.html itself IS summed per the I.4 note).
//
// Each counted file is gzipped with zlib.gzipSync and the gz sizes are
// summed. Exit 0 with `budget: <N> KB gz ≤ 300 KB gz — OK`; exit 1 with the
// offending files listed otherwise. A missing web build fails closed (run
// `pnpm --dir apps/local exec vite build --outDir dist/web --base ./`
// first). Standalone runnable from any working directory (same convention as
// scripts/license-lint.mjs).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET_BYTES = 300 * 1024;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const webDir = path.join(repoRoot, 'apps', 'local', 'dist', 'web');
const manifestPath = path.join(webDir, '.vite', 'manifest.json');
const indexHtmlPath = path.join(webDir, 'index.html');

function fail(message) {
  console.error(`assert-budget: FAIL — ${message}`);
  process.exit(1);
}
function kb(bytes) {
  return (bytes / 1024).toFixed(1);
}
function resolveFrom(baseFile, specifier) {
  // Specifiers inside built chunks are relative ('./x.js' or '../x.js');
  // bare specifiers cannot occur in a bundled vite graph.
  return path.normalize(path.join(path.dirname(baseFile), specifier));
}

// ---------------------------------------------------------------------------
// Graph acquisition
// ---------------------------------------------------------------------------

if (!existsSync(indexHtmlPath)) {
  fail(`no web build at ${path.relative(repoRoot, webDir)} — run ` +
    '`pnpm --dir apps/local exec vite build --outDir dist/web --base ./` first');
}
const indexHtml = readFileSync(indexHtmlPath, 'utf8');

// initial: ordered set of counted JS files; dynamic: lazy chunks (INFO only).
const initial = new Set();
const dynamicOnly = new Set();
const css = new Set(); // report-only, never summed
let method;

function walkStaticJs(fromFile, source, seen) {
  if (seen.has(fromFile)) return;
  seen.add(fromFile);
  initial.add(fromFile);
  // Side-effect imports:  import"./x.js"   (the `(` exclusion keeps dynamic
  // `import("./x.js")` out; the lookbehind keeps `ximport"..."`-like text out).
  for (const m of source.matchAll(/(?<![.\w$])import\s*(?!\()(["'])([^"']+)\1/g)) {
    const resolved = resolveFrom(fromFile, m[2]);
    if (resolved.endsWith('.js')) enqueue(resolved, seen);
    else dynamicOnly.add(resolved); // non-JS eager edge (asset URL) — report only
  }
  // Named/default/namespace imports and re-exports: ... from"./x.js".
  // Dynamic imports never use `from`, so this form is static by construction.
  for (const m of source.matchAll(/\bfrom\s*(["'])([^"']+)\1/g)) {
    const resolved = resolveFrom(fromFile, m[2]);
    if (resolved.endsWith('.js')) enqueue(resolved, seen);
  }
}
function enqueue(file, seen) {
  if (initial.has(file)) return;
  if (!existsSync(file)) fail(`chunk graph references missing file ${path.relative(webDir, file)}`);
  walkStaticJs(file, readFileSync(file, 'utf8'), seen);
}

// index.html is itself part of the `/` initial load (it carries the module
// script + preload hints), so it is summed in both modes.
initial.add(indexHtmlPath);

if (existsSync(manifestPath)) {
  // Mode 1: vite manifest — authoritative static/dynamic split.
  method = 'vite manifest (.vite/manifest.json): entry `imports` walked, `dynamicImports` excluded';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = Object.entries(manifest).filter(([, v]) => v.isEntry);
  if (entries.length === 0) fail('vite manifest has no isEntry chunk');
  const seen = new Set();
  const visit = (key) => {
    const meta = manifest[key];
    if (!meta) fail(`vite manifest references unknown key "${key}"`);
    const file = path.join(webDir, meta.file);
    if (seen.has(file)) return;
    seen.add(file);
    initial.add(file);
    for (const dep of meta.imports ?? []) visit(dep);
    for (const dep of meta.dynamicImports ?? []) {
      const dmeta = manifest[dep];
      if (dmeta) dynamicOnly.add(path.join(webDir, dmeta.file));
    }
    for (const c of meta.css ?? []) css.add(path.join(webDir, c));
  };
  for (const [key] of entries) visit(key);
} else {
  // Mode 2: parse index.html + walk the chunk graph ourselves.
  method = 'index.html entry parse + built-chunk static-import walk (vite manifest not emitted)';
  const scriptRe = /<script[^>]*type="module"[^>]*src=("([^"]+)"|'([^']+)')[^>]*><\/script>/g;
  const entries = [...indexHtml.matchAll(scriptRe)].map((m) => m[2] ?? m[3]);
  if (entries.length === 0) {
    fail('dist/web/index.html has no <script type="module" src=...> entry');
  }
  const seen = new Set();
  for (const src of entries) {
    const entryFile = resolveFrom(indexHtmlPath, src);
    if (!existsSync(entryFile)) fail(`index.html references missing entry ${path.relative(webDir, entryFile)}`);
    walkStaticJs(entryFile, readFileSync(entryFile, 'utf8'), seen);
  }
  // Defensive union: vite emits modulepreload links exactly for the entry's
  // static closure; anything it names that the walk missed is still initial.
  for (const m of indexHtml.matchAll(/<link[^>]*rel="modulepreload"[^>]*href=("([^"]+)"|'([^']+)')/g)) {
    const href = m[2] ?? m[3];
    const resolved = resolveFrom(indexHtmlPath, href);
    if (resolved.endsWith('.js') && !initial.has(resolved)) {
      if (!existsSync(resolved)) fail(`index.html modulepreload references missing ${path.relative(webDir, resolved)}`);
      walkStaticJs(resolved, readFileSync(resolved, 'utf8'), new Set());
    }
  }
  for (const m of indexHtml.matchAll(/<link[^>]*rel="stylesheet"[^>]*href=("([^"]+)"|'([^']+)')/g)) {
    css.add(resolveFrom(indexHtmlPath, m[2] ?? m[3]));
  }
}

// Lazy chunks the initial graph dynamically imports (INFO; the lazy law).
for (const file of initial) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(/(?<![.\w$])import\s*\(\s*(["'])([^"']+)\1/g)) {
    dynamicOnly.add(resolveFrom(file, m[2]));
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const counted = [...initial].sort();
const rows = counted.map((file) => {
  const raw = readFileSync(file);
  const gz = gzipSync(raw).length;
  return { rel: path.relative(webDir, file), raw: raw.length, gz };
});
const totalGz = rows.reduce((sum, r) => sum + r.gz, 0);

console.log('assert-budget: bundle-budget gate (§12/TR-8) — built web initial JS ≤ 300 KB gz');
console.log(`assert-budget: web dir: ${path.relative(repoRoot, webDir)}`);
console.log(`assert-budget: method: ${method}`);
console.log('assert-budget: counted (initial JS, gzipped):');
for (const r of rows) console.log(`  ${r.rel.padEnd(40)} raw ${String(r.raw).padStart(8)} B   gz ${kb(r.gz).padStart(7)} KB`);
console.log('assert-budget: NOT counted (lazy law / non-JS, report-only):');
for (const f of [...dynamicOnly].sort()) console.log(`  lazy  ${path.relative(webDir, f)}`);
for (const f of [...css].sort()) console.log(`  css   ${path.relative(webDir, f)}`);

const verdictLine = `budget: ${kb(totalGz)} KB gz ≤ ${BUDGET_BYTES / 1024} KB gz`;
if (totalGz <= BUDGET_BYTES) {
  console.log(`assert-budget: total initial JS ${totalGz} B gz (${kb(totalGz)} KB) of ${BUDGET_BYTES} B budget`);
  console.log(`${verdictLine} — OK`);
  process.exit(0);
}
console.error(`assert-budget: total initial JS ${totalGz} B gz (${kb(totalGz)} KB) EXCEEDS ${BUDGET_BYTES} B budget`);
console.error('assert-budget: offending files (counted initial JS):');
for (const r of rows) console.error(`  ${r.rel}  gz ${kb(r.gz)} KB`);
console.error(`${verdictLine} — FAIL`);
process.exit(1);
