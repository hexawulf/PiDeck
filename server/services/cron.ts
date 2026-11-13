// The Cron tab: read the user's crontab and run one of its jobs on request.
//
//   crontab -l ─► parseCrontab ─► jobs (schedule, command, the variables in force)
//   Run       ─► the command exactly as cron would start it:
//                 /bin/sh -c <command>   (SHELL= from the crontab wins)
//                 cron's small environment + the crontab's own variables,
//                 never PiDeck's (which holds the session secret and host tokens)
//                 "%" → newline, text after the first "%" → stdin, "\%" → "%"
//                 output ─► ~/logs/pideck-cron-run-<stamp>.log (removed when empty)
//
// A job that ends within WAIT_MS reports its exit code; a longer one keeps
// running on its own and the answer says so. Nothing is buffered in memory
// and nothing is killed.
import { execFile, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CronJob } from "@shared/schema";
import { PIDECK_LOGS_DIR } from "../config";

const execFileAsync = promisify(execFile);

export type CronEntry = {
  /** Five fields joined by single spaces, or "@reboot", "@daily", … */
  schedule: string;
  /** The command text as written, "%" included. */
  command: string;
  /** NAME=value lines above this entry, in force for it. */
  env: Record<string, string>;
};

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const AT_LINE = /^(@[a-z]+)\s+(.+)$/i;
const FIVE_FIELDS = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;

const unquote = (v: string) => {
  const t = v.trim();
  return t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))) ? t.slice(1, -1) : t;
};

/**
 * Parse `crontab -l` output. Comments and blank lines are skipped, leading
 * whitespace is ignored, NAME=value lines set variables for the entries
 * below them (they are not jobs), fields may be separated by tabs or several
 * spaces, and @reboot/@daily/… entries are kept with that as their schedule.
 * Lines that are none of these are left out.
 */
export function parseCrontab(text: string): CronEntry[] {
  const entries: CronEntry[] = [];
  const env: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = AT_LINE.exec(line);
    if (at) {
      entries.push({ schedule: at[1].toLowerCase(), command: at[2].trim(), env: { ...env } });
      continue;
    }
    // A variable line starts with a name; a schedule starts with a digit or "*", never a letter.
    const variable = ENV_LINE.exec(line);
    if (variable) {
      env[variable[1]] = unquote(variable[2]);
      continue;
    }
    const five = FIVE_FIELDS.exec(line);
    if (five) entries.push({ schedule: five.slice(1, 6).join(" "), command: five[6].trim(), env: { ...env } });
  }
  return entries;
}

/** cron's "%" rule: the first unescaped % ends the command, the rest is stdin with % as newlines. */
export function splitPercent(command: string): { command: string; stdin: string | null } {
  let cmd = "";
  let i = 0;
  for (; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && command[i + 1] === "%") {
      cmd += "%";
      i++;
    } else if (c === "%") {
      break;
    } else {
      cmd += c;
    }
  }
  if (i >= command.length) return { command: cmd, stdin: null };
  let input = "";
  for (i++; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && command[i + 1] === "%") {
      input += "%";
      i++;
    } else {
      input += c === "%" ? "\n" : c;
    }
  }
  return { command: cmd, stdin: `${input}\n` };
}

function describe(command: string): string {
  if (command.includes("update")) return "Update script";
  if (command.includes("backup")) return "Backup routine";
  if (command.includes("health")) return "Health check";
  if (command.includes("clean")) return "Cleanup task";
  return "Scheduled task";
}

export const toCronJob = (e: CronEntry): CronJob => ({ schedule: e.schedule, command: e.command, description: describe(e.command), status: "Active" });

/** The current user's crontab entries; none when there is no crontab (or no cron). */
export async function readCrontab(): Promise<CronEntry[]> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    return parseCrontab(stdout);
  } catch {
    return [];
  }
}

/** The environment cron gives a job, plus the crontab's own variables. Nothing from PiDeck. */
export function cronEnvironment(entry: CronEntry, user = os.userInfo()): Record<string, string> {
  return {
    HOME: user.homedir,
    LOGNAME: user.username,
    USER: user.username,
    SHELL: "/bin/sh",
    PATH: "/usr/bin:/bin",
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...entry.env,
  };
}

export const CRON_LOG_PREFIX = "pideck-cron-run-";
export const WAIT_MS = 10_000;

export type CronRunResult =
  | { state: "finished"; exitCode: number | null; log: string | null }
  | { state: "running"; log: string };

type Child = {
  stdin?: { end(data?: string): void; on(ev: "error", cb: () => void): unknown } | null;
  on(ev: "exit", cb: (code: number | null) => void): unknown;
  on(ev: "error", cb: (err: Error) => void): unknown;
  unref(): void;
};
type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => Child;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export function runCronEntry(
  entry: CronEntry,
  { logsDir = PIDECK_LOGS_DIR, spawn = nodeSpawn as unknown as Spawn, now = () => new Date(), waitMs = WAIT_MS, user = os.userInfo() }:
    { logsDir?: string; spawn?: Spawn; now?: () => Date; waitMs?: number; user?: os.UserInfo<string> } = {},
): Promise<CronRunResult> {
  const { command, stdin } = splitPercent(entry.command);
  const env = cronEnvironment(entry, user);
  const log = `${CRON_LOG_PREFIX}${stamp(now())}-${process.hrtime.bigint().toString(36).slice(-4)}.log`;
  const file = path.join(logsDir, log);
  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.openSync(file, "a", 0o640);
  fs.writeSync(out, `[pideck] run ${now().toISOString()}: ${entry.command.slice(0, 500)}\n`);
  const headerSize = fs.fstatSync(out).size;

  return new Promise<CronRunResult>((resolve, reject) => {
    let settled = false;
    let child: Child;
    try {
      child = spawn(env.SHELL, ["-c", command], { env, cwd: env.HOME, detached: true, stdio: [stdin === null ? "ignore" : "pipe", out, out] });
    } catch (err) {
      fs.closeSync(out);
      return reject(err);
    }
    fs.closeSync(out); // the child holds its own copy of the descriptor
    if (stdin !== null && child.stdin) {
      child.stdin.on("error", () => {}); // a job that doesn't read its stdin
      child.stdin.end(stdin);
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref(); // keeps running on its own; its exit is still recorded below
      resolve({ state: "running", log });
    }, waitMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      let keep = true;
      try {
        // Most jobs redirect their own output: don't leave a header-only file behind.
        if (fs.statSync(file).size <= headerSize && code === 0) {
          fs.unlinkSync(file);
          keep = false;
        } else {
          fs.appendFileSync(file, `[pideck] exit ${code ?? "killed"}\n`);
        }
      } catch {
        /* the log is a convenience */
      }
      if (settled) return;
      settled = true;
      resolve({ state: "finished", exitCode: code, log: keep ? log : null });
    });
  });
}
