FIXIT — PiDeck Vite build fails: [vite:asset-import-meta-url] Unexpected token 'import' in client/index.html
Context

Repo root: /home/zk/projects/PiDeck

Build command: npm run build → vite build (client) then esbuild (server)

Error repeats:

[vite:asset-import-meta-url] Unexpected token 'import'
file: /home/zk/projects/PiDeck/client/index.html


We’re not on Replit. Strip all Replit plugins/integration.

Client root is client/; server is server/. Static output should be dist/public.

Keep ESM server build to dist/index.js.

Goal

Make vite build succeed.

Output client to dist/public and keep server bundle in dist/.

SPA serves via Express static from dist/public (index.html fallback).

No Replit references.

Preserve aliases @, @shared, @assets.

Strong suspicion (do not skip)

The error means Rollup is parsing HTML as JS. This usually happens if:

A plugin or config bypasses the HTML plugin, or

There’s a stray/duplicate HTML entry, or

index.html has an inline <script> without type="module", or

The Vite root/input is misconfigured, or

Tooling versions are clashing (Vite/Rollup/tailwind-vite).

Step 0 — Print environment (for the log)
node --version
npm --version
npx vite --version
node -e "console.log(process.versions)"

Step 1 — Show the exact files (do not assume)

Print these (verbatim):

cat vite.config.ts
cat package.json
cat tsconfig.json
sed -n '1,120p' client/index.html
sed -n '1,120p' client/src/main.tsx
sed -n '1,120p' client/src/App.tsx
ls -al client | sed -n '1,120p'
ls -al client/src | sed -n '1,120p'
ls -al

Step 2 — Sanity edits (apply exactly)

vite.config.ts — replace completely:

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  appType: "spa",
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
    emptyOutDir: true
    // DO NOT set rollupOptions.input; let Vite detect client/index.html
  },
  server: { fs: { strict: true, deny: ["**/.*"] } },
});


client/index.html — replace completely:

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PiDeck</title>
  </head>
  <body>
    <div id="root"></div>
    <!-- Must be type="module" -->
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>


client/src/main.tsx — ensure minimal valid boot:

import React from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);


package.json — replace “scripts” with:

"scripts": {
  "dev": "dotenv -e .env -- tsx server/index.ts",
  "dev:client": "vite",
  "build:client": "vite build --debug",
  "build:server": "esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "build": "npm run build:client && npm run build:server",
  "start": "PORT=5006 NODE_ENV=production node dist/index.js",
  "check": "tsc",
  "db:push": "drizzle-kit push"
}


tsconfig.json — replace (paths consistent with aliases):

{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["client/src/*"],
      "@shared/*": ["shared/*"],
      "@assets/*": ["attached_assets/*"]
    }
  },
  "include": ["client", "server", "shared"]
}

Step 3 — Remove anything that can confuse Rollup/Vite
# Remove other HTML entries at client/ root
find client -maxdepth 1 -type f -name '*.html' ! -name 'index.html' -print -delete

# Force-add type="module" for any inline scripts lacking it (idempotent)
perl -0777 -pe 's/<script(?![^>]*type=)[^>]*>/<script type="module">/g' \
  client/index.html > client/.index.tmp && mv client/.index.tmp client/index.html

# Clean caches & outputs
rm -rf node_modules client/.vite dist

Step 4 — Pin compatible versions (temporary if needed)

To rule out a Rollup/Vite quirk:

npm i -D vite@5.4.10 rollup@4.21.2 @vitejs/plugin-react@4.3.2

Step 5 — Build with full debug & show logs
npm run build:client --silent 2>&1 | tee /tmp/vite-debug.log
sed -n '1,200p' /tmp/vite-debug.log


Confirm the plugin order includes the HTML plugin and that client/index.html is recognized as HTML, not JS.

If it still throws [vite:asset-import-meta-url] Unexpected token 'import', bisect plugins:

Temporarily set plugins: [] (no react) and try vite build again.

If it passes with no plugins, re-enable @vitejs/plugin-react only.

If it fails only when another plugin is present, identify and remove/upgrade it.

Step 6 — Finalize server static handling (if not present)

Ensure Express serves the SPA:

// server/index.ts snippet
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const staticDir = path.resolve(__dirname, "../dist/public");
app.use(express.static(staticDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(staticDir, "index.html"));
});

Acceptance Criteria

npm run build succeeds with:

Vite outputs to dist/public/ (assets + index.html)

esbuild outputs server to dist/index.js

vite build --debug shows client/index.html processed as HTML (no “Unexpected token 'import'”).

Starting the server serves SPA from dist/public and all routes work.

Commit message
build(vite): fix HTML parsing error; standardize client root + output; remove replit remnants; stabilize paths

- root=client, output dist/public, aliases @/@shared/@assets
- clean index.html (module script), minimal main.tsx
- pin vite/rollup versions temporarily to avoid parse bug
- ensure server static fallback to dist/public/index.html


Run these exactly; if the failure persists after plugin bisect, print the first 200 lines of /tmp/vite-debug.log and the plugin list Vite reports so we can lock the offending plugin/version.

