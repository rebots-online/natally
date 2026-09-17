import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// ARCHITECTURE §2/§18.1 (D22/D23): the hosted edition consumes the same exported
// shared-package UI source from inside the monorepo. Mirrors apps/local's essentials.
export default defineConfig({
  envDir: repositoryRoot,
  esbuild: { jsx: "automatic" },
  // I-16/INC-11: high, non-patterned dev port; never 3000/5173/8080.
  server: {
    port: 4890,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  preview: { port: 4890, strictPort: true },
  // CC12/INC-16: tracked dist/ output is never wiped implicitly.
  build: { outDir: "dist", emptyOutDir: false, target: "es2022" },
});
