// Remote log sources on an agent (docs/plans/multi-host-h3.md › Track B).
// Opt-in (PIDECK_AGENT_LOGS=on) and explicit only: nothing is discovered
// except Docker containers, and only when PIDECK_AGENT_DOCKER_LOGS=on.
//
//   GET /api/agent/logs        → { sources: [...], docker }
//   GET /api/agent/logs/:id    → { id, lines, truncated, redacted, … }
//
// An id always maps to a configured source (a file path from .env, a
// journald unit from .env, or a container the Docker API listed). No path,
// unit or container id ever comes from the request, so there is nothing to
// traverse. Lines are cut at 8 kB, the answer at 2,000 lines / 1 MB,
// every line is redacted, and only then filtered.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseHostLogs } from "../../config";
import { lineFilter } from "../log-filter";
import { hasTool } from "../unavailable";
import { isDsm } from "../platform";
import { redactLine } from "./redact";
import { ContainerGone, DEFAULT_DOCKER_SOCKET, DockerUnavailable, containerLogs, listContainers, type Container } from "./docker";

export const DEFAULT_LINES = 200;
export const MAX_LINES = 2000;
export const MAX_LINE_BYTES = 8 * 1024;
export const MAX_ANSWER_BYTES = 1024 * 1024;
export const MAX_FILTER_CHARS = 200;
const JOURNAL_TIMEOUT_MS = 4000;
/** Room for the rest of the JSON answer (id, label, flags). */
const ANSWER_OVERHEAD = 4 * 1024;
/** Terminal colour/cursor sequences (docker logs are full of them). */
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export type FileSource = { id: string; label: string; kind: "file"; pattern: string };
export type JournalSource = { id: string; label: string; kind: "journal"; unit: string; user: boolean };
export type AgentLogConfig = {
  enabled: boolean;
  files: FileSource[];
  journal: JournalSource[];
  docker: { enabled: boolean; socketPath: string };
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
const UNIT_RE = /^[A-Za-z0-9@._:-]{1,120}$/;

/** The agent's log configuration from its .env. */
export function agentLogConfig(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): AgentLogConfig {
  const enabled = env.PIDECK_AGENT_LOGS === "on";
  const files: FileSource[] = parseHostLogs(env.PIDECK_HOST_LOGS, undefined, warn).map((e) => ({
    id: `file_${e.id}`.slice(0, 64),
    label: e.label,
    kind: "file",
    pattern: e.path,
  }));
  const journal: JournalSource[] = [];
  for (const raw of (env.PIDECK_AGENT_JOURNAL_UNITS ?? "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const user = item.startsWith("user:");
    const unit = user ? item.slice(5) : item;
    if (!UNIT_RE.test(unit) || unit.startsWith("-")) {
      warn(`[config] PIDECK_AGENT_JOURNAL_UNITS: ignoring "${item.slice(0, 60)}"`);
      continue;
    }
    const id = `journal_${user ? "user_" : ""}${slug(unit)}`.slice(0, 64);
    if (journal.some((j) => j.id === id)) continue;
    journal.push({ id, label: `${unit}${user ? " (user)" : ""} · journal`, kind: "journal", unit, user });
  }
  const socket = env.PIDECK_AGENT_DOCKER_SOCKET?.trim();
  const socketPath = socket && path.isAbsolute(socket) ? socket : DEFAULT_DOCKER_SOCKET;
  return { enabled, files, journal, docker: { enabled: env.PIDECK_AGENT_DOCKER_LOGS === "on", socketPath } };
}

// ── file names: %Y/%m/%d placeholders and a newest-match glob ────────────
const pad = (n: number) => String(n).padStart(2, "0");
export function expandDate(p: string, d = new Date()): string {
  return p.replace(/%Y/g, String(d.getFullYear())).replace(/%m/g, pad(d.getMonth() + 1)).replace(/%d/g, pad(d.getDate()));
}
const ROTATED = /\.(gz|xz|bz2|zst|lz4|z|zip)$|\.\d+$/i;
const globToRe = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);

/**
 * The live file for a configured path: placeholders filled in; a `*`/`?` in
 * the file name picks the newest regular file that matches (never a rotated
 * one: .1, .gz, .xz …). Wildcards in directory names aren't supported.
 */
export async function resolveFile(pattern: string, now = new Date()): Promise<string | null> {
  const p = expandDate(pattern, now);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (/[*?]/.test(dir)) return null;
  if (!/[*?]/.test(base)) return p;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const re = globToRe(base);
  let best: { file: string; mtime: number } | null = null;
  for (const n of names) {
    if (!re.test(n) || ROTATED.test(n)) continue;
    const file = path.join(dir, n);
    const st = await fs.lstat(file).catch(() => null);
    if (!st?.isFile()) continue;
    if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
  }
  return best?.file ?? null;
}

// ── listing ──────────────────────────────────────────────────────────────
export type SourceInfo = {
  id: string;
  label: string;
  kind: "file" | "journal" | "docker";
  readable: boolean;
  hint?: string;
  size?: number;
  mtime?: string;
  /** docker: running, exited, … */
  state?: string;
  image?: string;
};
export type SourceList = { sources: SourceInfo[]; docker: { enabled: boolean; reachable: boolean; hint?: string } };

const PERMISSION_HINT = "No permission: add the agent user to the file's group (adm on Ubuntu, log on DSM), then restart the agent.";

async function fileInfo(src: FileSource): Promise<SourceInfo & { file?: string }> {
  const base = { id: src.id, label: src.label, kind: "file" as const };
  const file = await resolveFile(src.pattern);
  if (!file) return { ...base, readable: false, hint: "No matching file yet." };
  try {
    const st = await fs.lstat(file);
    if (st.isSymbolicLink()) return { ...base, readable: false, hint: "Is a symlink: configure the real path." };
    if (!st.isFile()) return { ...base, readable: false, hint: "Not a regular file." };
    await fs.access(file, fs.constants.R_OK);
    return { ...base, readable: true, size: st.size, mtime: st.mtime.toISOString(), file };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return { ...base, readable: false, hint: PERMISSION_HINT };
    if (code === "ENOENT") return { ...base, readable: false, hint: "File not found." };
    return { ...base, readable: false, hint: "Can't read this file." };
  }
}

const journalArgs = (s: JournalSource, lines: number) => [s.user ? "--user-unit" : "-u", s.unit, "-n", String(lines), "--no-pager", "-q", "-o", "short-iso"];
type Exec = (cmd: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr: string }>;
const execFileP: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { ...opts, encoding: "utf8" }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }))),
  );

function journalProblem(stderr: string): string | null {
  if (/insufficient permissions|not seeing messages from other users|No journal files were opened/i.test(stderr)) {
    return "No permission: add the agent user to systemd-journal or adm, then restart the agent.";
  }
  return null;
}

async function journalInfo(s: JournalSource, exec: Exec): Promise<SourceInfo> {
  const base = { id: s.id, label: s.label, kind: "journal" as const };
  if (isDsm()) return { ...base, readable: false, hint: "Not available on DSM (no journald)." };
  if (!hasTool("journalctl")) return { ...base, readable: false, hint: "journalctl not found on this host." };
  try {
    const { stderr } = await exec("journalctl", journalArgs(s, 1), { timeout: JOURNAL_TIMEOUT_MS, maxBuffer: 64 * 1024 });
    const problem = journalProblem(stderr);
    return problem ? { ...base, readable: false, hint: problem } : { ...base, readable: true };
  } catch (e) {
    return { ...base, readable: false, hint: journalProblem(String((e as { stderr?: string }).stderr ?? "")) ?? "journalctl failed for this unit." };
  }
}

export const dockerId = (c: Container) => `docker_${slug(c.name) || c.id.slice(0, 12)}`.slice(0, 64);

export type Deps = { exec?: Exec; now?: () => Date };

export async function listSources(cfg: AgentLogConfig, { exec = execFileP }: Deps = {}): Promise<SourceList> {
  const sources: SourceInfo[] = [];
  for (const f of cfg.files) {
    const { file: _file, ...info } = await fileInfo(f);
    sources.push(info);
  }
  for (const j of cfg.journal) sources.push(await journalInfo(j, exec));
  const docker: SourceList["docker"] = { enabled: cfg.docker.enabled, reachable: false };
  if (cfg.docker.enabled) {
    try {
      const seen = new Set<string>();
      for (const c of await listContainers({ socketPath: cfg.docker.socketPath })) {
        const id = dockerId(c);
        if (seen.has(id)) continue;
        seen.add(id);
        sources.push({ id, label: c.name, kind: "docker", readable: true, state: c.state, image: c.image, mtime: c.created ? new Date(c.created * 1000).toISOString() : undefined });
      }
      docker.reachable = true;
    } catch (e) {
      docker.hint = e instanceof DockerUnavailable ? e.hint : "Docker not reachable.";
    }
  }
  return { sources, docker };
}

// ── reading ─────────────────────────────────────────────────────────────
export class SourceError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

export type TailResult = {
  id: string;
  label: string;
  kind: SourceInfo["kind"];
  lines: string[];
  /** Anything cut: lines over 8 kB, the 1 MB cap, or an older part of a huge file. */
  truncated: boolean;
  /** How many spans were replaced by [REDACTED]. */
  redacted: number;
  /** Line numbers (0-based, in `lines`) that contain a redaction. */
  redactedLines: number[];
};

/** Parse ?lines= and ?filter= (400 on anything odd). */
export function parseTailQuery(q: Record<string, unknown>): { lines: number; filter: string | undefined } {
  for (const k of Object.keys(q)) if (k !== "lines" && k !== "filter") throw new SourceError(400, `unknown parameter: ${k.slice(0, 20)}`);
  let lines = DEFAULT_LINES;
  if (q.lines !== undefined) {
    if (typeof q.lines !== "string" || !/^\d{1,4}$/.test(q.lines)) throw new SourceError(400, `lines must be an integer 1–${MAX_LINES}`);
    lines = Number(q.lines);
    if (lines < 1 || lines > MAX_LINES) throw new SourceError(400, `lines must be an integer 1–${MAX_LINES}`);
  }
  let filter: string | undefined;
  if (q.filter !== undefined) {
    if (typeof q.filter !== "string" || q.filter.length > MAX_FILTER_CHARS) throw new SourceError(400, `filter must be one string of at most ${MAX_FILTER_CHARS} characters`);
    filter = q.filter;
  }
  return { lines, filter };
}

/** Cut a line at 8 kB (UTF-8 safe enough: cut on a char boundary of the JS string). */
function cutLine(line: string): { text: string; cut: boolean } {
  if (Buffer.byteLength(line, "utf8") <= MAX_LINE_BYTES) return { text: line, cut: false };
  let text = line.slice(0, MAX_LINE_BYTES);
  while (Buffer.byteLength(text, "utf8") > MAX_LINE_BYTES) text = text.slice(0, -64);
  return { text: `${text} …[line cut]`, cut: true };
}

/** The last `n` lines of a file, reading backwards at most ~1 MB + one line cap per requested line. */
export async function tailFile(file: string, n: number): Promise<{ lines: string[]; truncated: boolean }> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const budget = Math.min(size, Math.max(MAX_ANSWER_BYTES * 2, n * 1024));
    const start = size - budget;
    const buf = Buffer.alloc(budget);
    await fh.read(buf, 0, budget, start);
    let text = buf.toString("utf8");
    let truncated = false;
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl === -1 ? "" : text.slice(nl + 1); // drop the partial first line
    }
    const all = text.split("\n");
    if (all.length && all[all.length - 1] === "") all.pop();
    if (start > 0 && all.length < n) truncated = true; // older lines exist but weren't read
    return { lines: all.slice(-n), truncated };
  } finally {
    await fh.close();
  }
}

function finish(src: { id: string; label: string; kind: SourceInfo["kind"] }, raw: string[], filter: string | undefined, truncatedIn: boolean): TailResult {
  const keep = lineFilter(filter); // throws LogFilterError (400) for a bad or too complex regex
  let truncated = truncatedIn;
  let redacted = 0;
  const out: { text: string; red: boolean }[] = [];
  for (const line of raw) {
    const c = cutLine(line.replace(ANSI, ""));
    if (c.cut) truncated = true;
    const r = redactLine(c.text); // redact first: a filter must never match a secret's value
    if (keep && !keep(r.text)) continue;
    redacted += r.count;
    out.push({ text: r.text, red: r.count > 0 });
  }
  // 1 MB cap on the JSON answer (the hub refuses more): keep the newest lines,
  // counting each line as it will be encoded (quotes, escapes, comma).
  let bytes = ANSWER_OVERHEAD;
  let from = out.length;
  for (;;) {
    if (from === 0) break;
    const cost = Buffer.byteLength(JSON.stringify(out[from - 1].text), "utf8") + 8; // + comma and its redactedLines index
    if (bytes + cost > MAX_ANSWER_BYTES) break;
    bytes += cost;
    from--;
  }
  if (from > 0) truncated = true;
  const kept = out.slice(from);
  return {
    id: src.id, label: src.label, kind: src.kind,
    lines: kept.map((l) => l.text), truncated, redacted,
    redactedLines: kept.flatMap((l, i) => (l.red ? [i] : [])),
  };
}

export async function readSource(cfg: AgentLogConfig, id: string, lines: number, filter: string | undefined, { exec = execFileP }: Deps = {}): Promise<TailResult> {
  lineFilter(filter); // validate before touching anything
  const file = cfg.files.find((f) => f.id === id);
  if (file) {
    const info = await fileInfo(file);
    if (!info.readable || !info.file) throw new SourceError(409, info.hint ?? "Can't read this file.");
    const t = await tailFile(info.file, lines);
    return finish(file, t.lines, filter, t.truncated);
  }
  const j = cfg.journal.find((x) => x.id === id);
  if (j) {
    const info = await journalInfo(j, exec);
    if (!info.readable) throw new SourceError(409, info.hint ?? "Can't read this unit.");
    const { stdout } = await exec("journalctl", journalArgs(j, lines), { timeout: JOURNAL_TIMEOUT_MS, maxBuffer: 8 * MAX_ANSWER_BYTES });
    const all = stdout.split("\n");
    if (all.length && all[all.length - 1] === "") all.pop();
    return finish(j, all.slice(-lines), filter, false);
  }
  if (cfg.docker.enabled && id.startsWith("docker_")) {
    let containers: Container[];
    try {
      containers = await listContainers({ socketPath: cfg.docker.socketPath });
    } catch (e) {
      throw new SourceError(503, e instanceof DockerUnavailable ? e.hint : "Docker not reachable.");
    }
    const c = containers.find((x) => dockerId(x) === id);
    if (!c) throw new SourceError(404, "container no longer exists");
    try {
      // One byte over the line cap, so cutLine() below cuts it and adds the marker.
      const r = await containerLogs(c.id, lines, { socketPath: cfg.docker.socketPath, maxLine: MAX_LINE_BYTES + 1 });
      return finish({ id, label: c.name, kind: "docker" }, r.lines.map((l) => (l.stream === "stderr" ? `[stderr] ${l.text}` : l.text)), filter, r.truncated);
    } catch (e) {
      if (e instanceof ContainerGone) throw new SourceError(404, "container no longer exists");
      if (e instanceof DockerUnavailable) throw new SourceError(503, e.hint);
      throw e;
    }
  }
  throw new SourceError(404, "No such log source");
}
