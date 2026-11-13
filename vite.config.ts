import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
// Imported (not read from disk): server/vite.ts bundles this file into dist/index.js,
// where __dirname is dist/ and has no package.json.
import pkg from "./package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  appType: "spa",
  // package.json is the single source of truth for the version shown in About.
  // …and for its release date (package.json "releaseDate"; tests/unit/release.test.ts ties both to the changelog).
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __RELEASE_DATE__: JSON.stringify(pkg.releaseDate) },
  root: path.resolve(__dirname, "client"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  publicDir: path.resolve(__dirname, "client", "public"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Do NOT set rollupOptions.input — let Vite auto-detect client/index.html
  },
  server: { fs: { strict: true, deny: ["**/.*"] } },
});
