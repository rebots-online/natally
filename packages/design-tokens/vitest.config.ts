import { defineProject } from "vitest/config";

// T0.4 scaffold — discovered by the root vitest.workspace.ts glob
// (packages/*/vitest.config.ts). Scoped strictly to this package's tests.
export default defineProject({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
