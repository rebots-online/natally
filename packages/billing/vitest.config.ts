import { defineProject } from "vitest/config";

// Per-package vitest project; picked up by the root vitest.workspace.ts glob
// (packages/*/vitest.config.ts).
export default defineProject({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
