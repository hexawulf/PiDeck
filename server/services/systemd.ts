// Read-only systemd services for the hub and every agent
// (docs/plans/services-2.8.0.md). Shared by GET /api/services and the sample.
//
//   config (PIDECK_SERVICES)            systemctl, via execFile, fixed argv only:
//     nginx, Web=postgresql@18-main,      show --no-pager -p Id … -p … -- <units…>
//     user:syncthing                      list-units --state=failed --plain --no-legend --no-pager
//                                         show --no-pager -p Version          (once)
//                                       (each also with a leading --user for user units)
//
// Nothing else is ever run (assertAllowedArgv, tested): no start/stop/restart/
// enable/kill/set-property/edit. Unit names come only from the config or from
// list-units output, and are validated (unit-name.ts) either way; "--" ends
// the options before them. Works on systemd 219 (Synology DSM) to 259: no
// --output=json, parse key=value (property order differs by version), a
// missing NRestarts is null, times are CLOCK_MONOTONIC µs + /proc/uptime.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { intSetting } from "../config";
import { isUnitName, parseUnitRef } from "./unit-name";

export const SERVICE_PROPS = [
  "Id", "Description", "LoadState", "ActiveState", "SubState", "UnitFileState", "Type", "Result", "MainPID",
  "NRestarts", "MemoryCurrent", "ActiveEnterTimestampMonotonic", "StateChangeTimestampMonotonic",
] as const;

// ── config ───────────────────────────────────────────────────────────────
export type WatchedUnit = { unit: string; user: boolean; label: string | null };
export type ServiceConfig = { units: WatchedUnit[]; failed: boolean; alertMinutes: number };

/**
 * PIDECK_SERVICES: comma-separated units, `user:<unit>` for the user manager,
 * optionally `Label=<unit>`. PIDECK_SERVICES_FAILED (on) also lists every
 * failed unit. PIDECK_SERVICE_ALERT_MINUTES (3) is read by the hub.
 */
export function serviceConfig(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): ServiceConfig {
  const units: WatchedUnit[] = [];
  for (const raw of (env.PIDECK_SERVICES ?? "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    const label = eq > 0 ? item.slice(0, eq).trim() : null;
    const ref = parseUnitRef((eq > 0 ? item.slice(eq + 1) : item).trim());
    if (!ref || (label !== null && (!label || label.length > 60 || /[\u0000-\u001f]/.test(label)))) {
      warn(`[config] PIDECK_SERVICES: ignoring "${item.slice(0, 60)}"`);
      continue;
    }
    if (units.some((u) => u.unit === ref.unit && u.user === ref.user)) {
      warn(`[config] PIDECK_SERVICES: "${item.slice(0, 60)}" is listed twice`);
      continue;
    }
    units.push({ ...ref, label });
  }
  const failed = (env.PIDECK_SERVICES_FAILED ?? "on").trim().toLowerCase() !== "off";
  return { units, failed, alertMinutes: intSetting(env, "PIDECK_SERVICE_ALERT_MINUTES", 3, 1, 1440, warn) };
}

// ── the only systemctl invocations ───────────────────────────────────────
const propArgs = SERVICE_PROPS.flatMap((p) => ["-p", p]);
export const showArgv = (units: readonly string[], user: boolean): string[] => [...(user ? ["--user"] : []), "show", "--no-pager", ...propArgs, "--", ...units];
export const failedArgv = (user: boolean): string[] => [...(user ? ["--user"] : []), "list-units", "--state=failed", "--plain", "--no-legend", "--no-pager"];
export const VERSION_ARGV: readonly string[] = ["show", "--no-pager", "-p", "Version"];
/** Units per `show` call at most (argv stays small; failed units are few). */
export const MAX_UNITS_PER_SHOW = 200;

export class SystemctlRefused extends Error {}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Throws unless argv is one of the read-only shapes above. Every call passes this gate. */
export function assertAllowedArgv(argv: readonly string[]): void {
  const user = argv[0] === "--user";
  const a = user ? argv.slice(1) : argv;
  if (same(a, failedArgv(false))) return;
  if (!user && same(a, VERSION_ARGV)) return;
  const head = ["show", "--no-pager", ...propArgs, "--"];
  if (a.length > head.length && a.length - head.length <= MAX_UNITS_PER_SHOW && same(a.slice(0, head.length), head) && a.slice(head.length).every(isUnitName)) return;
  throw new SystemctlRefused(`refused: systemctl ${argv.slice(0, 4).join(" ").slice(0, 80)} (not a read-only call PiDeck makes)`);
}

/** Env for `systemctl --user` run from a system service: the user manager's bus. */
export function userEnv(env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? 0): NodeJS.ProcessEnv {
  const runtime = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  return { ...env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus` };
}

export type Exec = (argv: string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
const execSystemctl: Exec = (argv, env) =>
  new Promise((resolve, reject) =>
    execFile("systemctl", argv, { timeout: 3000, maxBuffer: 512 * 1024, env, encoding: "utf8" }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }),
    ),
  );

// ── parsing ──────────────────────────────────────────────────────────────
/** `systemctl show` output → one key/value record per unit (blank line between units). */
export function parseShow(stdout: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    (cur ??= {})[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (cur) out.push(cur);
  return out;
}

/** Unit names from `list-units --state=failed --plain --no-legend`, validated. */
export function parseFailedList(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split("\n")) {
    const name = line.trim().replace(/^[●*×]\s*/, "").split(/\s+/)[0] ?? "";
    if (name && isUnitName(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

const UINT64_MAX = "18446744073709551615";
const value = (v: string | undefined) => (v === undefined || v === "" || v === "[not set]" || v === UINT64_MAX ? null : v);
const num = (v: string | undefined) => {
  const s = value(v);
  if (s === null || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

export type Health = "ok" | "warn" | "fail" | "unknown";
/** ok = active (incl. active (exited) oneshots); warn = (de)activating, reloading, inactive; fail = failed, not found, bad unit. */
export function healthOf(load: string | null, active: string | null): Health {
  if (load === "not-found" || load === "error" || load === "bad-setting") return "fail";
  switch (active) {
    case "active": return "ok";
    case "failed": return "fail";
    case "activating": case "deactivating": case "reloading": case "inactive": case "maintenance": case "refreshing": return "warn";
    default: return "unknown";
  }
}

/** When the unit entered its current state, from CLOCK_MONOTONIC µs and the uptime (s): no locale or TZ parsing. */
export function sinceIso(monotonicUs: number | null, uptimeSec: number | null, now: number): string | null {
  if (!monotonicUs || uptimeSec === null) return null;
  const t = now - uptimeSec * 1000 + monotonicUs / 1000;
  return Number.isFinite(t) && t <= now + 5_000 ? new Date(Math.min(t, now)).toISOString() : null;
}

export type Service = {
  unit: string;
  user: boolean;
  label: string | null;
  description: string | null;
  load: string | null;
  active: string | null;
  sub: string | null;
  unitFileState: string | null;
  type: string | null;
  result: string | null;
  mainPid: number | null;
  /** null on systemd < 235 (no NRestarts). */
  restarts: number | null;
  memory: number | null;
  since: string | null;
  health: Health;
  /** In PIDECK_SERVICES (only these alert); false = shown because it failed. */
  listed: boolean;
};

export function toService(rec: Record<string, string> | undefined, w: WatchedUnit, listed: boolean, uptimeSec: number | null, now: number): Service {
  const r = rec ?? {};
  const load = value(r.LoadState);
  const active = value(r.ActiveState);
  const monotonic = active === "active" ? num(r.ActiveEnterTimestampMonotonic) : num(r.StateChangeTimestampMonotonic);
  return {
    unit: w.unit, user: w.user, label: w.label,
    description: value(r.Description)?.slice(0, 200) ?? null,
    load, active, sub: value(r.SubState), unitFileState: value(r.UnitFileState), type: value(r.Type), result: value(r.Result),
    mainPid: num(r.MainPID) || null, restarts: num(r.NRestarts), memory: num(r.MemoryCurrent),
    since: sinceIso(monotonic, uptimeSec, now),
    health: rec ? healthOf(load, active) : "unknown",
    listed,
  };
}

// ── collection ───────────────────────────────────────────────────────────
export type ServicesResult = {
  /** false: no systemctl on this host (the rest is empty). */
  available: boolean;
  /** systemd version, e.g. "259" (null when unknown). */
  systemd: string | null;
  /** The listed units, in config order. */
  services: Service[];
  /** Failed units that aren't listed (PIDECK_SERVICES_FAILED). */
  failedOnly: Service[];
  warnings: string[];
};

export type CollectDeps = { exec?: Exec; now?: () => number; uptime?: () => Promise<number | null>; env?: NodeJS.ProcessEnv };

const readUptime = async () => {
  const n = Number.parseFloat((await fs.readFile("/proc/uptime", "utf8")).split(" ")[0]);
  return Number.isFinite(n) ? n : null;
};

/** No systemctl, or no systemd running as PID 1 (a container, a non-systemd host). */
const noSystemd = (e: unknown) =>
  (e as NodeJS.ErrnoException).code === "ENOENT" || /not been booted with systemd|Host is down/i.test(String((e as { stderr?: string }).stderr ?? ""));
const UNAVAILABLE: ServicesResult = { available: false, systemd: null, services: [], failedOnly: [], warnings: ["systemd not available on this host"] };

const errText = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).split("\n")[0].slice(0, 160);

export function createServiceCollector(cfg: ServiceConfig, { exec = execSystemctl, now = Date.now, uptime = readUptime, env = process.env }: CollectDeps = {}, cacheMs = 10_000) {
  let version: string | null = null;
  let cached: { at: number; value: ServicesResult } | null = null;
  let inflight: Promise<ServicesResult> | null = null;

  const run = (argv: string[], user: boolean) => {
    assertAllowedArgv(argv); // the gate, before anything runs
    return exec(argv, user ? userEnv(env) : env);
  };

  async function collect(): Promise<ServicesResult> {
    const warnings: string[] = [];
    const services: Service[] = [];
    const failedOnly: Service[] = [];
    const t = now();
    const up = await uptime().catch(() => null);
    if (version === null) {
      try {
        version = value(parseShow((await run([...VERSION_ARGV], false)).stdout)[0]?.Version)?.match(/\d+/)?.[0] ?? null;
      } catch (e) {
        if (noSystemd(e)) return UNAVAILABLE;
      }
    }
    const managers = [false, ...(cfg.units.some((u) => u.user) ? [true] : [])];
    for (const user of managers) {
      const listed = cfg.units.filter((u) => u.user === user);
      const who = user ? "user units" : "system units";
      let failedNames: string[] = [];
      if (cfg.failed) {
        try {
          failedNames = parseFailedList((await run(failedArgv(user), user)).stdout);
        } catch (e) {
          warnings.push(`${who}: can't list failed units (${errText(e)})`);
        }
      }
      const extra = failedNames.filter((n) => !listed.some((l) => l.unit === n || `${l.unit}.service` === n)).slice(0, MAX_UNITS_PER_SHOW - listed.length);
      const names = [...listed.map((l) => l.unit), ...extra];
      if (!names.length) continue;
      let records: Record<string, string>[] | null = null;
      try {
        records = parseShow((await run(showArgv(names, user), user)).stdout);
      } catch (e) {
        if (!user && noSystemd(e)) return UNAVAILABLE;
        warnings.push(
          user
            ? `user units: the user manager isn't reachable (${errText(e)}); it needs lingering: loginctl enable-linger <agent user>`
            : `${who}: systemctl show failed (${errText(e)})`,
        );
      }
      // `show` prints one record per argument, in argument order (an alias shows its target's Id).
      const recFor = (i: number) => (records && records.length === names.length ? records[i] : undefined);
      listed.forEach((w, i) => services.push(toService(recFor(i), w, true, up, t)));
      extra.forEach((n, i) => failedOnly.push(toService(recFor(listed.length + i), { unit: n, user, label: null }, false, up, t)));
    }
    if (!cfg.units.length) warnings.push("No services listed: set PIDECK_SERVICES in .env (e.g. nginx,ssh,user:syncthing) and restart.");
    return { available: true, systemd: version, services, failedOnly, warnings };
  }

  return {
    /** Cached for cacheMs; concurrent callers share one run. */
    async get(): Promise<ServicesResult> {
      if (cached && now() - cached.at < cacheMs) return cached.value;
      inflight ??= collect()
        .then((value) => ((cached = { at: now(), value }), value))
        .finally(() => (inflight = null));
      return inflight;
    },
  };
}

let local: ReturnType<typeof createServiceCollector> | null = null;
/** This process's collector (config from .env). */
export function localServices() {
  local ??= createServiceCollector(serviceConfig());
  return local;
}

// ── the compact form in /api/agent/sample (alerts, overview) ─────────────
export type CompactService = { unit: string; user: boolean; health: Health; listed: boolean; state: string | null; since: string | null };

export const compactServices = (r: ServicesResult): CompactService[] | undefined =>
  r.available
    ? [...r.services, ...r.failedOnly].map((s) => ({
        unit: s.unit, user: s.user, health: s.health, listed: s.listed,
        state: s.load === "not-found" ? "not-found" : s.active, since: s.since,
      }))
    : undefined;

const HEALTHS = new Set(["ok", "warn", "fail", "unknown"]);
/** What the hub accepts from an agent's sample (anything else is dropped). */
export function parseCompactServices(x: unknown): CompactService[] | null {
  if (!Array.isArray(x)) return null;
  const out: CompactService[] = [];
  for (const s of x.slice(0, 500)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.unit !== "string" || !isUnitName(o.unit) || typeof o.health !== "string" || !HEALTHS.has(o.health)) continue;
    out.push({
      unit: o.unit, user: o.user === true, health: o.health as Health, listed: o.listed === true,
      state: typeof o.state === "string" ? o.state.slice(0, 32) : null,
      since: typeof o.since === "string" && Number.isFinite(Date.parse(o.since)) ? o.since : null,
    });
  }
  return out;
}
