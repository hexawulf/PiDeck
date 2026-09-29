// Author:      0xWulf (zk@hexawulf.dev)
// Description: Server chunks in dist/ without a window where a running server
//              loses them (2.6.1). The server is code-split: a running process
//              loads some chunks lazily (pm2 library, drizzle, remote logs), by
//              the names its own build gave them. So a rebuild must not delete
//              those before the restart. build:server runs:
//                node scripts/prune-dist.mjs --rotate   (meta → meta.prev)
//                esbuild … --metafile=dist/.server-meta.json
//                node scripts/prune-dist.mjs            (delete the rest)
//              and keeps every chunk of the current and the previous build.
// Modified:    2026-09-29
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
export const META = ".server-meta.json";
export const PREV_META = ".server-meta.prev.json";

/** Top-level .js files in dist/ that neither build lists (pure; `outputs` are esbuild metafile keys). */
export function chunksToDelete(files, currentOutputs, previousOutputs = []) {
  const keep = new Set([...currentOutputs, ...previousOutputs].map((o) => path.basename(o)));
  return files.filter((f) => f.endsWith(".js") && !keep.has(f)).sort();
}

const outputsOf = (file) => Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).outputs ?? {});

export function main(argv = process.argv.slice(2), dist = DIST, log = console.log) {
  fs.mkdirSync(dist, { recursive: true });
  const meta = path.join(dist, META);
  const prev = path.join(dist, PREV_META);
  if (argv.includes("--rotate")) {
    if (fs.existsSync(meta)) fs.renameSync(meta, prev);
    return 0;
  }
  if (!fs.existsSync(meta)) {
    log(`[prune-dist] no ${META}: nothing deleted`);
    return 0;
  }
  if (!fs.existsSync(prev)) {
    // First build with a metafile (e.g. over a 2.6.0 dist): the running server's
    // chunks are unknown, so keep everything; the next build cleans them up.
    log("[prune-dist] first build with a metafile: nothing deleted");
    return 0;
  }
  const gone = chunksToDelete(fs.readdirSync(dist), outputsOf(meta), outputsOf(prev));
  for (const f of gone) fs.rmSync(path.join(dist, f), { force: true });
  log(`[prune-dist] kept the current and previous build's chunks; deleted ${gone.length} older file(s)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
