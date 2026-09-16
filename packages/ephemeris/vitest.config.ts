import { defineConfig } from "vitest/config";

// Per-package vitest project; discovered by the root vitest.workspace.ts glob
// (packages/*/vitest.config.ts). Contracts only — node environment, no DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
