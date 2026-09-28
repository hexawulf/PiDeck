// The running PiDeck version, from package.json one directory up from this
// file: server/version.ts (tsx, tests) and dist/index.js (the bundle) both
// sit one level below the checkout root.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const PIDECK_VERSION = readVersion();

/** "2.4.1" → 2; anything unparsable → null. */
export function majorVersion(v: string | null | undefined): number | null {
  const m = /^(\d+)\./.exec(v ?? "");
  return m ? Number(m[1]) : null;
}
