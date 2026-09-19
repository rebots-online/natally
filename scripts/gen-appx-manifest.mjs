#!/usr/bin/env node
// WP.2 — AppxManifest generator (architecture §20.3, DOCS/ARCHITECTURE.md).
// Substitutes @…@ tokens in config/appx-template.xml with XML-escaped values,
// rejects any unresolved token, writes to stdout or --out. No dependencies.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = resolve(REPO_ROOT, "config/appx-template.xml");
const IDENTITY_PATH = resolve(REPO_ROOT, "config/windows-store-identity.json");

// Token name -> identity-file JSON keys accepted for it (checked in order).
const IDENTITY_KEYS = {
  IDENTITY_NAME: ["identityName", "STORE_IDENTITY_NAME", "identity_name"],
  PUBLISHER: ["publisher", "STORE_PUBLISHER", "publisher_dn"],
  DISPLAY_NAME: ["displayName", "DISPLAY_NAME", "display_name"],
  PUBLISHER_DISPLAY_NAME: [
    "publisherDisplayName",
    "PUBLISHER_DISPLAY_NAME",
    "publisher_display_name",
  ],
  VERSION: ["version", "MSIX_VERSION", "msix_version"],
  ARCHITECTURE: ["architecture", "ARCHITECTURE"],
  EXECUTABLE: ["executable", "EXECUTABLE"],
  MAX_VERSION_TESTED: ["maxVersionTested", "TESTED_WINDOWS_VERSION", "tested_windows_version"],
};

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return ch;
    }
  });
}

/**
 * Substitute every @TOKEN@ in `text` using `values` (already plain strings).
 * Each value is XML-escaped. Returns { xml, unresolved } — unresolved is the
 * sorted list of token names that had no value.
 */
export function substitute(text, values) {
  const unresolved = new Set();
  const xml = text.replace(/@([A-Z0-9_]+)@/g, (_m, token) => {
    const v = values[token];
    if (v === undefined || v === null) {
      unresolved.add(token);
      return _m;
    }
    return escapeXml(v);
  });
  return { xml, unresolved: [...unresolved].sort() };
}

/**
 * Build values for every token the template uses from the identity object
 * (config/windows-store-identity.json shape) plus explicit overrides.
 */
export function valuesFromIdentity(identity, overrides = {}) {
  const values = { ...overrides };
  for (const [token, keys] of Object.entries(IDENTITY_KEYS)) {
    if (values[token] !== undefined) continue;
    for (const key of keys) {
      if (identity[key] !== undefined && identity[key] !== null) {
        values[token] = String(identity[key]);
        break;
      }
    }
  }
  return values;
}

export function generateManifest({ template, values }) {
  const { xml, unresolved } = substitute(template, values);
  if (unresolved.length > 0) {
    const err = new Error(
      `unresolved AppxManifest token(s): ${unresolved.map((t) => `@${t}@`).join(", ")}`,
    );
    err.unresolvedTokens = unresolved;
    throw err;
  }
  return xml;
}

// Built-in self-test fixture used by --check when no committed identity file
// exists. These values are NOT store identity values; they exist only to
// exercise the generator end-to-end. Real identity values live (if at all) in
// config/windows-store-identity.json — owned by WP.1, never invented here.
export function selfTestFixture() {
  return {
    IDENTITY_NAME: "ExampleCorp.SelfTest.Package&<check>",
    PUBLISHER: "CN=Self Test <Publisher>, O=Self Test & Co",
    DISPLAY_NAME: "natally Self-Test <fixture> & 'Demo'",
    PUBLISHER_DISPLAY_NAME: 'Self "Test" & Sons <Ltd>',
    VERSION: "1.0.0.0",
    ARCHITECTURE: "x64",
    EXECUTABLE: String.raw`app\Self"Test & <Demo>.exe`,
    MAX_VERSION_TESTED: "10.0.22621.0",
  };
}

function loadValuesFromArgsAndEnv(argv, env) {
  const overrides = {};
  for (const arg of argv) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(arg);
    if (m) overrides[m[1]] = m[2];
  }
  for (const token of Object.keys(IDENTITY_KEYS)) {
    if (overrides[token] === undefined && env[token] !== undefined) {
      overrides[token] = env[token];
    }
  }
  return overrides;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = { check: false, out: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--out") args.out = argv[++i];
    else args.rest.push(argv[i]);
  }

  const template = readFileSync(TEMPLATE_PATH, "utf8");
  let values;

  if (args.check) {
    if (existsSync(IDENTITY_PATH)) {
      const identity = JSON.parse(readFileSync(IDENTITY_PATH, "utf8"));
      values = valuesFromIdentity(identity, loadValuesFromArgsAndEnv(args.rest, env));
    } else {
      // No committed identity file: run the self-test fixture (includes
      // escape-hostile values) plus any CLI/env overrides.
      values = { ...selfTestFixture(), ...loadValuesFromArgsAndEnv(args.rest, env) };
    }
  } else {
    values = loadValuesFromArgsAndEnv(args.rest, env);
  }

  let xml;
  try {
    xml = generateManifest({ template, values });
  } catch (err) {
    if (err.unresolvedTokens) {
      process.stderr.write(`ERROR: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (args.out) {
    writeFileSync(args.out, xml, "utf8");
    process.stdout.write(`wrote ${args.out}\n`);
  } else {
    process.stdout.write(xml);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
