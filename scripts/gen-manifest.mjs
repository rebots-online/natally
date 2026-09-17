#!/usr/bin/env node
// MS.1 — validates the committed public-HF catalogue. Every asset must carry an
// absolute https://huggingface.co URL, a 64-char sha256, and a positive byte count.
// Run with --check to validate only; run without flags to re-emit (sorted, stable).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cataloguePath = join(root, "apps/local/src/mirror/catalogue.json");
const check = process.argv.includes("--check");

const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
const errors = [];

if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(catalogue.version ?? "")) {
  errors.push(`version "${catalogue.version}" must match YYYY-MM-DD.N`);
}

const kinds = new Set(["llm", "embedder", "voice", "voices"]);
const seenIds = new Set();
const seenUrls = new Set();

for (const asset of catalogue.assets ?? []) {
  const label = asset.id ?? "<no-id>";
  if (!asset.id || !/^[a-z0-9][a-z0-9._-]*$/.test(asset.id)) {
    errors.push(`${label}: id must be a safe identifier`);
  }
  if (seenIds.has(asset.id)) errors.push(`${label}: duplicate id`);
  seenIds.add(asset.id);

  if (!kinds.has(asset.kind)) errors.push(`${label}: kind "${asset.kind}" not in ${[...kinds]}`);

  if (!asset.file || !asset.file.startsWith("https://huggingface.co/")) {
    errors.push(`${label}: file must be an absolute https://huggingface.co URL`);
  }
  if (seenUrls.has(asset.file)) errors.push(`${label}: duplicate URL`);
  seenUrls.add(asset.file);

  if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
    errors.push(`${label}: sha256 must be 64 lowercase hex chars`);
  }
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
    errors.push(`${label}: bytes must be a positive safe integer`);
  }
}

const trialEligible = (catalogue.assets ?? []).filter((a) => a.trialEligible === true);
if (trialEligible.length !== 1) {
  errors.push(`exactly one asset must be trialEligible (found ${trialEligible.length})`);
}

if (errors.length > 0) {
  console.error(`gen-manifest: ${errors.length} error(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

if (!check) {
  catalogue.assets.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
}

console.log(
  `gen-manifest: ${catalogue.assets.length} assets valid${check ? " (check mode)" : " (re-emitted)"}`,
);
console.log(`  trial model: ${trialEligible[0]?.id}`);
console.log(
  `  total bytes: ${(catalogue.assets.reduce((sum, a) => sum + a.bytes, 0) / 1048576).toFixed(1)} MB`,
);
