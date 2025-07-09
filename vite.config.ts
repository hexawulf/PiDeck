import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal"; // Always import this

// Export an async function to enable dynamic imports for plugins
export default defineConfig(async () => {
  const plugins = [
    react(),
    runtimeErrorOverlay(), // Always include this plugin
  ];

  // Conditionally load @replit/vite-plugin-cartographer
  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID) {
    try {
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer());
    } catch (error) {
      console.warn("Failed to load @replit/vite-plugin-cartographer:", error);
      // Optionally, inform the user or proceed without it if it's non-critical
    }
  }

  return {
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
