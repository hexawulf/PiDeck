// Server rebuild while running (2.6.1): keep the current and the previous build's chunks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chunksToDelete, main, META, PREV_META } from "../../scripts/prune-dist.mjs";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** One "esbuild run": write its chunks and its metafile the way build:server does. */
function build(dist: string, files: string[]) {
  main(["--rotate"], dist, () => {});
  for (const f of files) fs.writeFileSync(path.join(dist, f), `// ${f}`);
  fs.writeFileSync(path.join(dist, META), JSON.stringify({ outputs: Object.fromEntries(files.map((f) => [`dist/${f}`, { bytes: 1 }])) }));
  main([], dist, () => {});
}

describe("prune-dist", () => {
  it("chunksToDelete keeps both builds' outputs, ignores non-JS", () => {
    expect(chunksToDelete(["index.js", "hub-A.js", "hub-B.js", "hub-C.js", ".build-commit", "public"], ["dist/index.js", "dist/hub-C.js"], ["dist/index.js", "dist/hub-B.js"]))
      .toEqual(["hub-A.js"]);
    expect(chunksToDelete(["index.js", "x.js"], ["dist/index.js"])).toEqual(["x.js"]);
  });

  it("a running server keeps its chunks through one rebuild; the build before that is removed", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "prune-dist-"));
    dirs.push(dist);
    fs.writeFileSync(path.join(dist, ".build-commit"), "abc\n");
    build(dist, ["index.js", "hub-1.js", "storage-1.js"]);
    build(dist, ["index.js", "hub-2.js", "storage-1.js"]); // the process started from build 1 may still lazy-load hub-1.js
    expect(fs.readdirSync(dist).filter((f) => f.endsWith(".js")).sort()).toEqual(["hub-1.js", "hub-2.js", "index.js", "storage-1.js"]);
    build(dist, ["index.js", "hub-3.js", "storage-3.js"]);
    expect(fs.readdirSync(dist).filter((f) => f.endsWith(".js")).sort()).toEqual(["hub-2.js", "hub-3.js", "index.js", "storage-1.js", "storage-3.js"]);
    expect(fs.existsSync(path.join(dist, PREV_META))).toBe(true);
    expect(fs.readFileSync(path.join(dist, ".build-commit"), "utf8")).toBe("abc\n"); // never touched
  });

  it("an old dist without a metafile loses nothing on the first new build", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "prune-dist-"));
    dirs.push(dist);
    fs.writeFileSync(path.join(dist, "hub-OLD.js"), "// 2.6.0 build");
    build(dist, ["index.js", "hub-NEW.js"]);
    expect(fs.existsSync(path.join(dist, "hub-OLD.js"))).toBe(true); // may still be loaded by the running 2.6.0 server
    build(dist, ["index.js", "hub-NEWER.js"]);
    expect(fs.readdirSync(dist).filter((f) => f.endsWith(".js")).sort()).toEqual(["hub-NEW.js", "hub-NEWER.js", "index.js"]);
  });
});
