import { globSync } from "node:fs";
import { defineWorkspace } from "vitest/config";

// Per-package vitest projects (packages/*, apps/*). The globs are expanded
// here rather than handed to vitest raw, because vitest startup-errors when a
// projects definition resolves to nothing. Tolerance rule: an empty workspace
// (no packages yet) yields a single no-op project instead — with
// `--passWithNoTests` that is a clean, zero-test-files pass; once a package
// ships its own vitest.config.ts the real per-package projects take over.
const packageConfigs = [
  ...globSync("packages/*/vitest.config.ts"),
  ...globSync("apps/*/vitest.config.ts"),
];

export default defineWorkspace(
  packageConfigs.length > 0 ? packageConfigs : [{ test: { include: [] } }],
);
