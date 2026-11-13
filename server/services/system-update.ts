// "Update system" (Quick Actions): `apt-get update && apt-get upgrade -y`
// as a background job with a log file, instead of a request that waits for
// the whole upgrade.
//
//   POST /api/system/update ─► start() ─► setsid --fork sh -c '<fixed script>'  >> ~/logs/pideck-system-update-<stamp>.log
//                                          │  "[pideck] pid <n> started <iso>"       (first line)
//                                          │  sudo -n apt-get update && sudo -n apt-get upgrade -y
//                                          └  "[pideck] exit <code>"                 (last line)
//   GET  /api/system/update ─► status() ─► newest log: exit line → succeeded/failed,
//                                          else pid alive → running, else → interrupted
//
// Why this shape:
//  • The state lives in the log file, so it survives a PiDeck restart, and the
//    job is its own session (setsid --fork): restarting PiDeck under pm2, which
//    kills the process tree, no longer kills apt in the middle of an upgrade.
//  • stdin is /dev/null. A package that asks a question (a changed config
//    file) gets end-of-file and fails for that package, with the reason in the
//    log, instead of waiting forever with the dpkg lock held.
//  • No output cap and no timeout: nothing is buffered in memory.
//  • One run at a time.
//  • The two sudo commands are exactly the ones deploy/sudoers.d/pideck.template
//    allows; don't add options to them.
import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PIDECK_LOGS_DIR } from "../config";

export const UPDATE_LOG_PREFIX = "pideck-system-update-";
/** Fixed text, no input from anywhere. `$$` is the shell's pid, `$?` apt's exit status. */
export const UPDATE_SCRIPT =
  'echo "[pideck] pid $$ started $(date -u +%Y-%m-%dT%H:%M:%SZ)"; sudo -n apt-get update && sudo -n apt-get upgrade -y; echo "[pideck] exit $?"';

export type UpdateStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: string | null; log: string }
  | { state: "succeeded" | "failed"; startedAt: string | null; finishedAt: string; exitCode: number | null; log: string; tail: string[] };

export class UpdateAlreadyRunning extends Error {
  constructor() {
    super("A system update is already running");
  }
}

type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => { on(ev: "error", cb: (e: NodeJS.ErrnoException) => void): unknown; unref(): void };

export type UpdateRunnerDeps = {
  logsDir?: string;
  spawn?: Spawn;
  now?: () => Date;
  /** Is this pid our job's shell? (default: /proc/<pid>/cmdline holds the script) */
  alive?: (pid: number) => boolean;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15); // 20261113-120536

function jobAlive(pid: number): boolean {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("[pideck] exit");
  } catch {
    return false;
  }
}

/** First and last lines of a job log → what happened. Pure, for tests. */
export function parseUpdateLog(text: string): { pid: number | null; startedAt: string | null; exitCode: number | null; finished: boolean; tail: string[] } {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
  const head = /^\[pideck\] pid (\d+) started (\S+)/.exec(lines[0] ?? "");
  let exitCode: number | null = null;
  let finished = false;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    const m = /^\[pideck\] exit (\d+)$/.exec(lines[i]);
    if (m) {
      exitCode = Number(m[1]);
      finished = true;
      break;
    }
  }
  const body = lines.filter((l) => !l.startsWith("[pideck] "));
  return { pid: head ? Number(head[1]) : null, startedAt: head ? head[2] : null, exitCode, finished, tail: body.slice(-15).map((l) => l.slice(0, 300)) };
}

export function createUpdateRunner({ logsDir = PIDECK_LOGS_DIR, spawn = nodeSpawn as unknown as Spawn, now = () => new Date(), alive = jobAlive }: UpdateRunnerDeps = {}) {
  /** A start() that hasn't written its first line yet still counts as running. */
  let starting: { log: string; at: number } | null = null;

  function newestLog(): string | null {
    let names: string[];
    try {
      names = fs.readdirSync(logsDir);
    } catch {
      return null;
    }
    const mine = names.filter((n) => n.startsWith(UPDATE_LOG_PREFIX) && n.endsWith(".log")).sort();
    return mine.length ? mine[mine.length - 1] : null;
  }

  function status(): UpdateStatus {
    const log = newestLog();
    if (!log) return { state: "idle" };
    const file = path.join(logsDir, log);
    let text: string;
    let mtime: Date;
    try {
      const st = fs.statSync(file);
      mtime = st.mtime;
      // Head (pid line) + tail (exit line and the last output) are all that's needed.
      const fd = fs.openSync(file, "r");
      try {
        const headBuf = Buffer.alloc(Math.min(st.size, 512));
        fs.readSync(fd, headBuf, 0, headBuf.length, 0);
        const tailLen = Math.min(st.size, 16 * 1024);
        const tailBuf = Buffer.alloc(tailLen);
        fs.readSync(fd, tailBuf, 0, tailLen, st.size - tailLen);
        const head = headBuf.toString("utf8").split("\n")[0] ?? "";
        text = st.size <= tailLen ? tailBuf.toString("utf8") : `${head}\n${tailBuf.toString("utf8").replace(/^[^\n]*\n/, "")}`;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return { state: "idle" };
    }
    const p = parseUpdateLog(text);
    if (p.finished) {
      return { state: p.exitCode === 0 ? "succeeded" : "failed", startedAt: p.startedAt, finishedAt: mtime.toISOString(), exitCode: p.exitCode, log, tail: p.tail };
    }
    const justStarted = starting !== null && starting.log === log && now().getTime() - starting.at < 10_000;
    if (justStarted || (p.pid !== null && alive(p.pid))) return { state: "running", startedAt: p.startedAt, log };
    // No exit line and no process: killed, or the host went down mid-run.
    return { state: "failed", startedAt: p.startedAt, finishedAt: mtime.toISOString(), exitCode: null, log, tail: p.tail };
  }

  function start(): UpdateStatus {
    if (status().state === "running") throw new UpdateAlreadyRunning();
    const at = now();
    const log = `${UPDATE_LOG_PREFIX}${stamp(at)}.log`;
    fs.mkdirSync(logsDir, { recursive: true });
    const out = fs.openSync(path.join(logsDir, log), "a", 0o640);
    const opts: SpawnOptions = { detached: true, stdio: ["ignore", out, out], cwd: "/" };
    try {
      // Its own session, re-parented to init: outlives a PiDeck restart.
      const child = spawn("setsid", ["--fork", "sh", "-c", UPDATE_SCRIPT], opts);
      child.on("error", (err) => {
        if (err.code !== "ENOENT") return console.error("[system-update] could not start:", err.message);
        // No setsid on this host: a detached shell is the next best thing.
        const fallback = spawn("sh", ["-c", UPDATE_SCRIPT], opts);
        fallback.on("error", (e) => console.error("[system-update] could not start:", e.message));
        fallback.unref();
      });
      child.unref();
    } finally {
      fs.closeSync(out);
    }
    starting = { log, at: at.getTime() };
    console.log(`[system-update] started, log ${log}`);
    return { state: "running", startedAt: at.toISOString(), log };
  }

  return { start, status };
}

export type UpdateRunner = ReturnType<typeof createUpdateRunner>;

let shared: UpdateRunner | null = null;
export const updateRunner = (): UpdateRunner => (shared ??= createUpdateRunner());
