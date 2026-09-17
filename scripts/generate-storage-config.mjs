// SS.1 — Build-time storage-scope config generator (architecture §19.1).
// Reads VITE_STORAGE_SCOPE from the environment (fallback: shared-content-v1),
// validates it, and writes config/asset-storage.generated.json — the ONE file
// consumed by both the Vite/TS build and the Rust build (include_str!).
// The scope is a PUBLIC frozen constant: never a secret, never an entitlement,
// never a Settings switch. Convention: generation runs under release.lock when
// a parent release orchestrator holds it; scripts/ has no flock helper, so this
// script does not acquire one itself (see scripts/build-web.sh lock grammar).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "config/asset-storage.generated.json");
const SOURCE = "scripts/generate-storage-config.mjs";
const SCOPE_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const DEFAULT_SCOPE = "shared-content-v1";

const scope = process.env.VITE_STORAGE_SCOPE ?? DEFAULT_SCOPE;

if (!SCOPE_RE.test(scope)) {
  console.error(
    `error: invalid VITE_STORAGE_SCOPE ${JSON.stringify(scope)} — must match ${SCOPE_RE.source}`,
  );
  process.exit(1);
}

const config = {
  scope,
  generatedAt: new Date().toISOString(),
  source: SOURCE,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`wrote ${outPath} (scope: ${scope})`);
