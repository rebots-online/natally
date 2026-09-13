#!/usr/bin/env bash
# CC2/CC7/CC9, ARCHITECTURE §14–15, CHECKLIST R.6.
# One stamp across the workspace; fork identity is read from root .env.
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module - "$@" <<'JS'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "stamp";
if (!["stamp", "--check", "--post-build"].includes(mode) || process.argv.length > 3) {
  throw new Error("Usage: scripts/update-version.sh [--check | --post-build]");
}
const read = (path) => readFileSync(path, "utf8");
function json(path) {
  try { return JSON.parse(read(path)); }
  catch (cause) { throw new Error(`Cannot parse ${path}`, { cause }); }
}
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const native = "apps/local/src-tauri";
const lock = "release.lock";
const current = read("version.txt").trim();
const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) throw new Error("version.txt must contain MAJOR.MINOR.BUILD");
if (existsSync(".env")) process.loadEnvFile(".env");

function checkVersion() {
  const data = json("version.json");
  const failures = [];
  const compare = (label, actual, expected = current) => {
    if (actual !== expected) failures.push(`${label}: ${actual} != ${expected}`);
  };
  compare("version.json", data.version);
  compare("versionCode", data.versionCode, Number(match[1]) * 100000 + Number(match[2]));
  for (const path of ["package.json", "apps/local/package.json", `${native}/tauri.conf.json`]) {
    if (existsSync(path)) compare(path, json(path).version);
  }
  if (existsSync(`${native}/Cargo.toml`)) {
    compare("Cargo.toml", read(`${native}/Cargo.toml`).match(/^version\s*=\s*"([^"]+)"/m)?.[1]);
  }
  if (existsSync(`${native}/tauri.conf.json`)) {
    const config = json(`${native}/tauri.conf.json`);
    compare("Tauri Android versionCode", config.bundle.android.versionCode, data.versionCode);
    compare("Tauri identifier", config.identifier, data.packageName);
    compare("Tauri productName", config.productName, data.productName);
  }
  const android = `${native}/gen/android/tauri.properties`;
  if (existsSync(android)) {
    compare("Android versionName", read(android).match(/^tauri.android.versionName=(.+)$/m)?.[1]);
    compare("Android versionCode", read(android).match(/^tauri.android.versionCode=(.+)$/m)?.[1], String(data.versionCode));
  }
  if (failures.length) throw new Error(`Version mismatch:\n${failures.join("\n")}`);
  process.stdout.write(`version check: consistent (${current}; versionCode ${data.versionCode})\n`);
}

if (mode === "--check") {
  checkVersion();
} else {
  if (mode === "--post-build" && existsSync(lock)) {
    throw new Error("--post-build refused: release.lock present; matrix orchestrator owns the bump");
  }
  let major = Number(match[1]);
  let minor = Number(match[2]) + 1;
  let build = Math.floor(Date.now() / 60000) % 100000;
  if (existsSync(lock)) {
    const text = read(lock);
    const integer = (name) => {
      const found = text.match(new RegExp(`^${name}=["']?(\\d+)["']?\\s*$`, "m"));
      if (!found) throw new Error(`release.lock lacks ${name}`);
      return Number(found[1]);
    };
    major = integer("MAJOR"); minor = integer("MINOR"); build = integer("BUILD_NUM");
  }
  const required = (key) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`${key} must be set in root .env; copy .env.example for defaults`);
    return value;
  };
  const productName = required("VITE_APP_NAME");
  const packageName = required("VITE_APP_ID");
  const slug = required("VITE_APP_SLUG");
  const port = Number(required("NATALLY_DEV_PORT"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid NATALLY_DEV_PORT");
  const buildNumber = String(build).padStart(5, "0");
  const version = `${major}.${minor}.${buildNumber}`;
  const versionCode = major * 100000 + minor;
  const data = {version, versionBase: `${major}.${minor}`, buildNumber, versionCode,
    buildDate: new Date().toISOString(), productName, internalName: slug, packageName};
  writeFileSync("version.txt", `${version}\n`);
  writeJson("version.json", data);
  for (const path of ["package.json", "apps/local/package.json"]) {
    if (existsSync(path)) writeJson(path, {...json(path), version});
  }
  const tauriPath = `${native}/tauri.conf.json`;
  if (existsSync(tauriPath)) {
    const config = json(tauriPath);
    config.version = version;
    config.productName = productName;
    config.identifier = packageName;
    config.build.devUrl = `http://localhost:${port}`;
    config.bundle.android = {...config.bundle.android, versionCode};
    const color = existsSync("packages/design-tokens/tokens.css")
      ? read("packages/design-tokens/tokens.css").match(/--color-midnight:\s*([^;]+);/)?.[1] : undefined;
    for (const window of config.app.windows) {
      window.title = productName;
      if (color) window.backgroundColor = color;
    }
    if (typeof config.app.security.devCsp === "string") {
      config.app.security.devCsp = config.app.security.devCsp.replace(/ws:\/\/localhost:\d+/g, `ws://localhost:${port}`);
    }
    writeJson(tauriPath, config);
  }
  const cargo = `${native}/Cargo.toml`;
  if (existsSync(cargo)) {
    const text = read(cargo);
    writeFileSync(cargo, text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
    const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const cargoLock = `${native}/Cargo.lock`;
    if (name && existsSync(cargoLock)) {
      const blocks = read(cargoLock).split("[[package]]");
      writeFileSync(cargoLock, blocks.map((block) => block.match(/^name = "([^"]+)"/m)?.[1] === name
        ? block.replace(/^version = "[^"]+"/m, `version = "${version}"`) : block).join("[[package]]"));
    }
  }
  if (existsSync(`${native}/gen/android`)) {
    writeFileSync(`${native}/gen/android/tauri.properties`,
      `tauri.android.versionCode=${versionCode}\ntauri.android.versionName=${version}\n`);
  }
  process.stdout.write(`Stamping version: ${version} (versionCode: ${versionCode})\n`);
}
JS
