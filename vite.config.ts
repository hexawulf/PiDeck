import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Async config to support dynamic plugin imports
export default async function getConfig() {
  const plugins = [react(), runtimeErrorOverlay()];

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
  ) {
    try {
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer());
    } catch (err) {
      console.warn("⚠️ Failed to load @replit/vite-plugin-cartographer", err);
    }
  }

  return defineConfig({
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  });
}
