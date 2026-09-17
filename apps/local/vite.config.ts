import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// CHECKLIST T0.2 and ARCHITECTURE §3: one frontend serves installed and web targets.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const port = Number(env.NATALLY_DEV_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("NATALLY_DEV_PORT must be a port from 1024 to 65535 in root .env");
  }
  if (!env.VITE_APP_NAME?.trim()) {
    throw new Error("VITE_APP_NAME must be set in root .env");
  }
  return {
    envDir: repositoryRoot,
    plugins: [tailwindcss()],
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: {
        "@natally/local-shell": fileURLToPath(new URL("./src/ui/shell.tsx", import.meta.url)),
      },
    },
    // Two module workers (ephemeris host, lore SQLite) share chunks with the app:
    // IIFE workers cannot code-split, so workers build as ES modules.
    worker: { format: "es" },
    server: {
      port,
      strictPort: true,
      fs: { allow: [repositoryRoot] },
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    preview: {
      port,
      strictPort: true,
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    // CC12/INC-16: disposable web output never overlaps tracked release artifacts.
    build: { outDir: "dist", emptyOutDir: false, target: "es2022" },
  };
});
