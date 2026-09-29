// What kind of host this is, and the hwmon CPU temperature fallback
// (docs/plans/multi-host-h3.md › Track A step 3). Pure readers with an
// injectable root so tests run against fixture trees.
//
//   DSM   /etc.defaults/VERSION (no /etc/os-release on a Synology):
//         productversion="7.4.1" → "DSM 7.4.1". Tools PiDeck shells out to
//         (apt, ufw, vcgencmd, smartctl, systemd) aren't there or need root.
//   hwmon /sys/class/hwmon/hwmonN/{name,temp*_label,temp*_input}: x86 hosts
//         without thermal_zone0 (DS920+: coretemp, "Physical id 0").
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { unavailable, type Unavailable } from "./unavailable";

export type Platform = { kind: "dsm"; os: string } | { kind: "linux" };

const VERSION_FILE = "/etc.defaults/VERSION";

/** Parse DSM's VERSION file (shell-style key="value" lines). null if it isn't one. */
export function parseDsmVersion(text: string): string | null {
  const kv = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z_]+)\s*=\s*"?([^"\n]*)"?\s*$/i.exec(line);
    if (m) kv.set(m[1].toLowerCase(), m[2].trim());
  }
  const product = kv.get("productversion");
  const version =
    product && /^\d+(\.\d+)*$/.test(product)
      ? product
      : kv.has("majorversion") && kv.has("minorversion")
        ? [kv.get("majorversion"), kv.get("minorversion"), kv.get("micro")].filter((x) => x !== undefined && x !== "").join(".")
        : null;
  return version && /^\d+(\.\d+)*$/.test(version) ? `DSM ${version}` : null;
}

export function detectPlatform(read: (p: string) => string = (p) => fsSync.readFileSync(p, "utf8"), file = VERSION_FILE): Platform {
  try {
    const os = parseDsmVersion(read(file));
    if (os) return { kind: "dsm", os };
  } catch {
    // not DSM
  }
  return { kind: "linux" };
}

let cached: Platform | null = null;
/** This host's platform (read once). */
export function platform(): Platform {
  cached ??= detectPlatform();
  return cached;
}
export const isDsm = () => platform().kind === "dsm";
/** Tests only. */
export const setPlatformForTests = (p: Platform | null) => void (cached = p);

/** The calm "can't work here" answer on DSM, instead of "needs sudoers"/"not installed". */
export const notOnDsm = (what: string): Unavailable => unavailable("not-supported", `Not available on DSM (${what}).`);

// ── hwmon CPU temperature ───────────────────────────────────────────────
export const HWMON_CPU_DRIVERS = ["coretemp", "k10temp", "cpu_thermal", "zenpower"] as const;
const PACKAGE_LABEL = /^(Package id 0|Physical id 0|Tctl|Tdie)$/i;

const readTrim = async (p: string) => (await fs.readFile(p, "utf8")).trim();

/**
 * CPU temperature (°C, 1 decimal) from the first hwmon device whose `name` is a
 * CPU driver: the package sensor ("Package id 0"/"Physical id 0"/"Tctl"), else
 * the hottest input. null when there is none or nothing is readable.
 */
export async function readHwmonTemperature(root = "/sys/class/hwmon"): Promise<number | null> {
  let dirs: string[];
  try {
    dirs = (await fs.readdir(root)).filter((d) => /^hwmon\d+$/.test(d)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  } catch {
    return null;
  }
  for (const d of dirs) {
    const dir = path.join(root, d);
    const name = await readTrim(path.join(dir, "name")).catch(() => "");
    if (!(HWMON_CPU_DRIVERS as readonly string[]).includes(name)) continue;
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    const inputs = files.filter((f) => /^temp\d+_input$/.test(f));
    let pkg: number | null = null;
    let max: number | null = null;
    for (const f of inputs) {
      const raw = Number.parseInt(await readTrim(path.join(dir, f)).catch(() => ""), 10);
      if (!Number.isFinite(raw)) continue;
      const c = raw / 1000;
      if (c <= 0 || c >= 125) continue; // sensor junk
      const label = await readTrim(path.join(dir, f.replace("_input", "_label"))).catch(() => "");
      if (PACKAGE_LABEL.test(label)) pkg = c;
      max = max === null ? c : Math.max(max, c);
    }
    const t = pkg ?? max;
    if (t !== null) return Math.round(t * 10) / 10;
  }
  return null;
}
