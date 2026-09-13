#!/usr/bin/env bash
# R.4 / CC12: parent may invoke this after creating release.lock for a shared stamp.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node --input-type=module - "$@" <<'JS'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--dry-run")) {
  throw new Error("Usage: scripts/build-web.sh [--dry-run]");
}
const root = process.cwd();
const read = (path) => readFileSync(path, "utf8");
const json = (path) => {
  try { return JSON.parse(read(path)); }
  catch (cause) { throw new Error(`Cannot parse ${path}`, { cause }); }
};
// Parse as data, never source shell code, and never serialize the entire environment.
const env = parseEnv(read(".env"));
const required = (key) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} must be set in root .env`);
  return value;
};
const name = required("VITE_APP_NAME");
const identity = required("VITE_APP_ID");
const slug = required("VITE_APP_SLUG");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || !/^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)+$/.test(identity)) {
  throw new Error("App identity and slug must be safe package/artifact names");
}
function publicUrl(key) {
  const url = new URL(required(key));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be an HTTP(S) URL without credentials, query or fragment`);
  }
  url.pathname = url.pathname.replace(/\/?$/, "/");
  return url;
}
const appUrl = publicUrl("VITE_APP_URL");
const landingUrl = publicUrl("VITE_LANDING_URL");
const color = read("packages/design-tokens/tokens.css").match(/--color-midnight:\s*([^;]+);/)?.[1]?.trim();
if (!color) throw new Error("Design tokens lack --color-midnight");
const manifest = json("apps/local/public/manifest.webmanifest");
const current = read("version.txt").trim();
if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error("Invalid version.txt");
const locked = existsSync("release.lock");
let plannedVersion;
if (locked) {
  // Same data-only grammar as the canonical stamper. Never execute release.lock.
  const lock = read("release.lock");
  const integer = (key) => {
    const value = lock.match(new RegExp(`^${key}=["']?(\\d+)["']?\\s*$`, "m"))?.[1];
    if (value === undefined) throw new Error(`release.lock lacks ${key}`);
    return String(Number(value));
  };
  plannedVersion = `${integer("MAJOR")}.${integer("MINOR")}.${integer("BUILD_NUM").padStart(5, "0")}`;
} else {
  const [major, minor] = current.split(".");
  plannedVersion = `${major}.${Number(minor) + 1}.${String(Math.floor(Date.now() / 60000) % 100000).padStart(5, "0")}`;
}
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const artifactName = (version) => `${slug}-v${version}-web-${runId}`;
if (args[0] === "--dry-run") {
  console.log(`web: artifact name ${artifactName(plannedVersion)}.tar.gz`);
  console.log(`plan: bash scripts/update-version.sh (${locked ? "reuse release.lock stamp" : "one canonical stamp"}); bash scripts/update-version.sh --check`);
  console.log("plan: installed Vite -> apps/local/dist (emptyOutDir: false); bundle sw.js; derive PWA theme from tokens.css and branding from root .env");
  console.log(`plan: preserve existing outputs; stage dist/web and dist/${artifactName(plannedVersion)}; archive dist/${artifactName(plannedVersion)}.tar.gz`);
  console.log(`plan: app ${appUrl.href}; landing ${landingUrl.href}; public configuration allowlist only`);
  process.exit(0);
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (!existsSync("node_modules/.bin/vite")) throw new Error("Installed root Vite is required; no auto-install is performed");
run("bash", ["scripts/update-version.sh"]);
run("bash", ["scripts/update-version.sh", "--check"]);
const version = json("version.json").version;
if (version !== read("version.txt").trim()) throw new Error("Canonical version surfaces disagree");
const artifact = artifactName(version);
const out = resolve("apps/local/dist");
const staged = resolve("dist", artifact);
const web = resolve("dist/web");
// Explicit public keys also keep accidentally VITE-prefixed secrets out of the bundle.
const publicKeys = [
  "VITE_APP_NAME", "VITE_APP_ID", "VITE_APP_SLUG", "VITE_APP_URL", "VITE_LANDING_URL",
  "VITE_MODEL_MIRROR_BASE", "VITE_LICENSE_BRIDGE_URL", "VITE_LICENSE_PUBKEY",
  "VITE_REVENUECAT_WEB_SDK_KEY", "VITE_REVENUECAT_OFFERING_ID",
  "VITE_LEMONSQUEEZY_CHECKOUT_URL", "VITE_PAYPAL_CHECKOUT_URL", "VITE_POLAR_CHECKOUT_URL",
  "VITE_SQUARE_CHECKOUT_URL", "VITE_STRIPE_CHECKOUT_URL", "VITE_LORE_EMBED_DIM",
  "VITE_LORE_ENABLED", "VITE_TRIAL_DAYS", "VITE_TRIAL_MODE", "VITE_TRIAL_MODEL",
  "VITE_TRIAL_RATE_COOLDOWN_DAYS", "VITE_TRIAL_READINGS",
];
const define = Object.fromEntries(publicKeys.filter((key) => env[key] !== undefined)
  .map((key) => [`import.meta.env.${key}`, JSON.stringify(env[key])]));
// Audit retained output before copying anything into tracked dist/, then audit the build.
const privateValues = Object.entries(env).filter(([key, value]) =>
  !publicKeys.includes(key) && key !== "NATALLY_DEV_PORT" && value.length > 0).map(([, value]) => Buffer.from(value));
function audit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || /^\.env(?:\.|$)/.test(entry.name)) throw new Error("Web output contains an unsafe file; staging refused");
    if (entry.isDirectory()) audit(path);
    else if (entry.isFile()) {
      const bytes = readFileSync(path);
      if (privateValues.some((value) => bytes.includes(value))) throw new Error("Web output contains private configuration; staging refused");
    }
  }
}
if (existsSync(out)) audit(out);
mkdirSync("dist", { recursive: true });
// Snapshot intermediate output before Vite replaces index.html or other stable names.
if (existsSync(out)) cpSync(out, resolve("dist", `${artifact}-before-build`), { recursive: true, force: false, errorOnExist: true });
// Use the already-installed root Vite API to pass overrides without writing a config.
const { build } = await import("vite");
await build({ root: resolve("apps/local"), configFile: resolve("apps/local/vite.config.ts"),
  base: appUrl.pathname, envPrefix: [], define, build: { outDir: out, emptyOutDir: false } });
await build({ root, configFile: false, publicDir: false, envDir: false, envPrefix: [],
  define: { ...define, __NATALLY_SW_CACHE__: JSON.stringify(`${identity}-static-v${version}-${runId}`) },
  build: { outDir: out, emptyOutDir: false, target: "es2022", sourcemap: false,
    lib: { entry: resolve("apps/local/src/sw.ts"), formats: ["es"], fileName: () => "sw.js" } } });

const branded = { ...manifest, name, short_name: name, id: `${appUrl.pathname}${identity}`,
  start_url: appUrl.href, scope: appUrl.pathname, theme_color: color, background_color: color };
writeFileSync(join(out, "manifest.webmanifest"), `${JSON.stringify(branded, null, 2)}\n`);
// Keep URLs and lineage discoverable without copying .env or private configuration.
writeFileSync(join(out, "build-manifest.json"), `${JSON.stringify({ version, productName: name,
  packageName: identity, slug, appUrl: appUrl.href, landingUrl: landingUrl.href }, null, 2)}\n`);
const registration = `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register(${JSON.stringify(`${appUrl.pathname}sw.js`)}, { type: 'module', scope: ${JSON.stringify(appUrl.pathname)}, updateViaCache: 'none' }).catch(error => console.warn('Service worker registration failed', error)); }); }\n`;
const registrationFile = `assets/pwa-register-${createHash("sha256").update(registration).digest("hex").slice(0, 12)}.js`;
mkdirSync(join(out, "assets"), { recursive: true });
writeFileSync(join(out, registrationFile), registration);
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const indexPath = join(out, "index.html");
let html = read(indexPath);
if (!/<\/head>/i.test(html)) throw new Error("Built index.html lacks a head element");
html = html.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi, "");
html = html.replace(/<\/head>/i, `<link rel="manifest" href="${escape(`${appUrl.pathname}manifest.webmanifest`)}">\n<script type="module" src="${escape(`${appUrl.pathname}${registrationFile}`)}"></script>\n</head>`);
writeFileSync(indexPath, html);

audit(out);
cpSync(out, staged, { recursive: true, force: false, errorOnExist: true });
run("tar", ["-czf", resolve("dist", `${artifact}.tar.gz`), "-C", staged, "."]);
// Preserve the previous deployable tree under a unique, explicit predecessor name.
if (existsSync(web)) renameSync(web, resolve("dist", `${artifact}-previous-web`));
cpSync(staged, web, { recursive: true, force: false, errorOnExist: true });
console.log(`web: artifact name ${artifact}.tar.gz`);
console.log(`web: staged dist/web; archive dist/${artifact}.tar.gz`);
JS
