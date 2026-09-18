// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const runtimeFiles = [
  ["dist/wasm/swisseph.wasm", "wasm/swisseph.wasm"],
  ["dist/ephe/sepl_18.se1", "ephe/sepl_18.se1"],
  ["dist/ephe/semo_18.se1", "ephe/semo_18.se1"],
  ["dist/ephe/seas_18.se1", "ephe/seas_18.se1"],
] as const;

describe("browser Swiss Ephemeris assets", () => {
  it.each(runtimeFiles)(
    "publishes pinned %s bytes instead of a Vite fallback",
    async (vendor, web) => {
      const manifest = JSON.parse(
        await readFile(`${root}VENDORED/ephemeris-manifest.json`, "utf8"),
      ) as { files: ManifestFile[] };
      const expected = manifest.files.find((file) => file.path === `sweph-wasm/${vendor}`);
      if (!expected) throw new Error(`Pinned ephemeris manifest entry is missing: ${vendor}`);

      const bytes = await readFile(`${root}apps/local/public/vendor/sweph/${web}`);
      expect(bytes.byteLength).toBe(expected.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
    },
  );
});
