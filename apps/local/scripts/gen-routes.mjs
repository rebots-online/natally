#!/usr/bin/env node
// natally — I.1 route-registry generator. Regenerates src/ui/routes.generated.ts
// from the registerRoute call sites that actually exist under src/screens/**
// at the moment this script runs: a REGENERATOR, never a coordinator. The
// output is deterministic (path-sorted) so re-running reproduces the file
// byte-for-byte.
//
// Honest scope: this script reads src/screens/** and src/ui/router.ts and
// writes exactly one file (src/ui/routes.generated.ts). It edits nothing else,
// deletes nothing, and adds no dependencies.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(APP_DIR, "src");
const SCREENS_DIR = path.join(SRC_DIR, "screens");
const ROUTER_FILE = path.join(SRC_DIR, "ui", "router.ts");
const OUT_FILE = path.join(SRC_DIR, "ui", "routes.generated.ts");

function fail(message) {
  process.stderr.write(`gen-routes: ${message}\n`);
  process.exit(1);
}

/**
 * Strip // and block comments while respecting string literals, so a
 * registerRoute mention inside a comment (screens/plate-natal documents its
 * route-less posture that way) is never mistaken for a call site. Deliberately
 * treats a `/` that starts a comment greedily and does not model regex
 * literals: no screen file carries a regex containing `registerRoute(`.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | sq | dq | tq
  let braceDepth = 0;
  const interpolations = [];
  while (i < source.length) {
    const c = source[i];
    const next = i + 1 < source.length ? source[i + 1] : "";
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        out += " ";
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        state = c === "'" ? "sq" : c === '"' ? "dq" : "tq";
        out += c;
        i += 1;
        continue;
      }
      if (c === "{") {
        braceDepth += 1;
      } else if (c === "}") {
        if (interpolations.length > 0 && braceDepth === interpolations[interpolations.length - 1]) {
          interpolations.pop();
          braceDepth -= 1;
          state = "tq";
          out += c;
          i += 1;
          continue;
        }
        braceDepth = Math.max(0, braceDepth - 1);
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        out += " ";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // String states: preserve verbatim (escapes included); a newline may not
    // open or close a ' or " literal, but keep scanning honestly if one does.
    if (c === "\\") {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (state === "sq" && (c === "'" || c === "\n")) state = "code";
    if (state === "dq" && (c === '"' || c === "\n")) state = "code";
    if (state === "tq") {
      if (c === "`") {
        state = "code";
      } else if (c === "$" && next === "{") {
        interpolations.push(braceDepth);
        braceDepth += 1;
        out += "${";
        i += 2;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Every .ts/.tsx file under `dir`, recursively, in sorted order. */
function tsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...tsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// The frozen route set, read from the router itself so the generator fails
// loudly on a call site whose path is outside it (a checklist defect, never an
// improvisation).
const routerSource = readFileSync(ROUTER_FILE, "utf8");
const routePathsMatch = routerSource.match(/export const ROUTE_PATHS = \[([\s\S]*?)\] as const/);
if (routePathsMatch === null) {
  fail("could not parse ROUTE_PATHS from src/ui/router.ts");
}
const FROZEN_PATHS = [...routePathsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const CALL = /registerRoute\s*\(\s*\{\s*path\s*:\s*"([^"]+)"/g;

// Scan every screens file for real (comment-stripped) registerRoute calls.
/** @type {Map<string, string[]>} module file -> registered paths (in file order) */
const registrations = new Map();
for (const file of tsFiles(SCREENS_DIR)) {
  const stripped = stripComments(readFileSync(file, "utf8"));
  const paths = [...stripped.matchAll(CALL)].map((m) => m[1]);
  if (paths.length === 0) {
    continue;
  }
  for (const routePath of paths) {
    if (!FROZEN_PATHS.includes(routePath)) {
      fail(`${file}: registerRoute path "${routePath}" is outside the frozen route set`);
    }
  }
  registrations.set(file, paths);
}

// A path registered by two modules is the router's "double registration" bug
// caught at generation time instead of import time.
const seenPaths = new Map();
for (const [file, paths] of registrations) {
  for (const routePath of paths) {
    const owner = seenPaths.get(routePath);
    if (owner !== undefined && owner !== file) {
      fail(`path "${routePath}" registered by both ${owner} and ${file}`);
    }
    seenPaths.set(routePath, file);
  }
}

// Screen directories (an index module marks a screen) and the ones that
// register nothing — documented in the generated header, never forced a route.
const screenDirs = readdirSync(SCREENS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b));
const routeless = screenDirs.filter(
  (dir) => ![...registrations.keys()].some((file) => file.includes(`${path.sep}${dir}${path.sep}`)),
);

// Deterministic ordering: modules path-sorted by the first route each
// registers, ties broken by module path.
const ordered = [...registrations.entries()].sort((a, b) => {
  const byPath = a[1][0].localeCompare(b[1][0]);
  return byPath !== 0 ? byPath : a[0].localeCompare(b[0]);
});

const UI_DIR = path.join(SRC_DIR, "ui");
function importSpecifier(file) {
  const rel = path.relative(UI_DIR, file).split(path.sep).join("/");
  const stripped = rel.replace(/\.tsx?$/, "");
  return stripped.startsWith("../") ? stripped : `./${stripped}`;
}

const lines = [];
lines.push("// generated by gen-routes.mjs — do not edit");
lines.push("//");
lines.push("// natally — I.1 route registry consolidation. Side-effect imports of every");
lines.push("// module under src/screens/** holding a registerRoute call site (frozen");
lines.push("// route set, src/ui/router.ts): importing the module is what registers its");
lines.push("// route(s). Regenerate with `node apps/local/scripts/gen-routes.mjs` —");
lines.push("// re-running reproduces this file byte-for-byte. Imports are ordered");
lines.push("// path-sorted by the first route each module registers.");
lines.push("//");
lines.push("// Implemented screens registered nowhere (no route, by design — the wiring");
lines.push("// layer mounts these directly, per each module's own header):");
for (const dir of routeless) {
  lines.push(`//   screens/${dir}`);
}
lines.push("");
for (const [file, paths] of ordered) {
  lines.push(
    `import "${importSpecifier(file)}"; // registers ${paths.map((p) => `"${p}"`).join(", ")}`,
  );
}
lines.push("");
lines.push('import { ROUTE_PATHS, type RouteRegistry, routeRegistry } from "./router";');
lines.push("");
lines.push("/**");
lines.push(" * Entry point for router consumers. The side-effect imports above have");
lines.push(" * already registered every frozen route by the time this module loads;");
lines.push(" * this returns the populated registry after asserting it is complete. A");
lines.push(" * missing path means the generated file is stale against the screens —");
lines.push(" * regenerate it, never improvise routes.");
lines.push(" */");
lines.push("export function registerAllRoutes(): RouteRegistry {");
lines.push("  const registry = routeRegistry();");
lines.push("  const missing = ROUTE_PATHS.filter((path) => !registry.has(path));");
lines.push("  if (missing.length > 0) {");
lines.push("    throw new Error(");
lines.push(
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted TypeScript intentionally carries this template placeholder
  '      `registerAllRoutes: route(s) not registered [${missing.join(", ")}] — regenerate routes.generated.ts (node apps/local/scripts/gen-routes.mjs)`,',
);
lines.push("    );");
lines.push("  }");
lines.push("  return registry;");
lines.push("}");
lines.push("");

const output = `${lines.join("\n")}`;
const before = (() => {
  try {
    return readFileSync(OUT_FILE, "utf8");
  } catch {
    return null;
  }
})();
writeFileSync(OUT_FILE, output);
const routeCount = new Set([...registrations.values()].flat()).size;
process.stdout.write(
  `gen-routes: wrote src/ui/routes.generated.ts (${registrations.size} registering modules, ${routeCount} routes, ${routeless.length} route-less screens)${before === output ? " — unchanged" : ""}\n`,
);
