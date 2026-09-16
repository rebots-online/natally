import { defineConfig } from "vitest/config";

// Per-package vitest project — picked up by the root vitest.workspace.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
