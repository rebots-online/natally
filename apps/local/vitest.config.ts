// natally — per-app vitest project (M.1 test harness). Picked up by the root
// vitest.workspace.ts glob (apps/*/vitest.config.ts). Node environment: the
// mirror tests run a real local HTTP fixture server and a real node-fs
// storage; future UI tests override per-file with a @vitest-environment
// pragma.
import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
