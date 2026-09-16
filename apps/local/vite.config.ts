import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri 2 dev law (ARCHITECTURE.md §3): the dev server listens on the fixed
// port the Tauri config expects — strictPort fails fast instead of drifting to
// 5174 on a stray occupancy. `build.outDir` stays `dist` relative to
// apps/local; R.4 later overrides it for the web PWA leg.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
