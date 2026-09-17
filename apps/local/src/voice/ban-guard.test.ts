import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const forbidden = "speech" + "Synthesis";

function fixture() {
  const staging = join(root, ".tmp");
  mkdirSync(staging, { recursive: true });
  // Retained under semantic staging paths; never put fixtures in the shared apps tree.
  const directory = mkdtempSync(join(staging, "STAGING_V2_guard_"));
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "apps"));
  const script = join(directory, "scripts/grep-no-speechsynthesis.sh");
  copyFileSync(join(root, "scripts/grep-no-speechsynthesis.sh"), script);
  const write = (path: string, contents: string) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  return {
    directory,
    script,
    write,
    run: () => spawnSync("bash", [script], { cwd: root, encoding: "utf8" }),
  };
}

describe("browser speech ban guard", () => {
  it("prints the exact zero-hit acceptance line and scans only source extensions", () => {
    const test = fixture();
    test.write("apps/local/src/voice.ts", "export const voice = 'Kokoro';");
    test.write("apps/local/src/README.md", forbidden);
    test.write("apps/local/test/test.ts", forbidden);
    const result = test.run();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${forbidden}: 0 hits`);
  });

  it.each([
    "apps/local/src/root.ts",
    "apps/web/src/deep/voice.tsx",
    "apps/native/src/audio.rs",
    "apps/.hidden/src/.nested/voice.ts",
  ])("fails on a reference in %s", (path) => {
    const test = fixture();
    test.write(path, `globalThis.${forbidden};`);
    const result = test.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${path}:1:`);
    expect(result.stdout).not.toContain("0 hits");
  });

  it("propagates grep errors instead of claiming zero hits", () => {
    const test = fixture();
    mkdirSync(join(test.directory, "apps/local/src"), { recursive: true });
    symlinkSync("missing.ts", join(test.directory, "apps/local/src/broken.ts"));
    expect(test.run().status).toBe(2);
  });
});
