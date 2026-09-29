// A minimal, read-only Docker Engine API client for remote logs (H3 Track B):
// node's http over the unix socket, no dependency, no docker CLI.
//
// Being able to reach the socket is root-equivalent, so this client makes
// exactly two kinds of request and refuses everything else *before* any
// byte is written (assertAllowed, unit-tested):
//
//   GET /containers/json?all=1
//   GET /containers/<hex id>/logs?stdout=1&stderr=1&tail=<1..2000>&timestamps=1
//
// Logs of non-TTY containers arrive multiplexed (8-byte frame headers:
// stream, 0, 0, 0, uint32 BE length); TTY containers send raw bytes.
import http from "node:http";

export const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
export const MAX_DOCKER_TAIL = 2000;
/** Bytes read from one Docker response at most (the lines kept are capped separately). */
export const MAX_DOCKER_BYTES = 64 * 1024 * 1024;

const LIST_PATH = "/containers/json?all=1";
const LOGS_RE = /^\/containers\/([a-f0-9]{12,64})\/logs\?stdout=1&stderr=1&tail=(\d{1,4})&timestamps=1$/;

export class DockerRefused extends Error {}
export class DockerUnavailable extends Error {
  constructor(message: string, readonly hint: string) {
    super(message);
  }
}
export class ContainerGone extends Error {}

/** Throws DockerRefused unless (method, path) is one of the two allowed calls. */
export function assertAllowed(method: string, path: string): void {
  if (method !== "GET") throw new DockerRefused(`refused: ${method} (read-only client)`);
  if (path === LIST_PATH) return;
  const m = LOGS_RE.exec(path);
  if (m) {
    const tail = Number(m[2]);
    if (tail >= 1 && tail <= MAX_DOCKER_TAIL) return;
  }
  throw new DockerRefused(`refused: ${path.slice(0, 80)} (not an allowed Docker API call)`);
}

export const logsPath = (id: string, tail: number) => `/containers/${id}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`;

export type DockerClientOptions = { socketPath?: string; timeoutMs?: number };

type Sink = { push(c: Buffer): void; contentType?: (ct: string) => void };
type Done = { status: number; truncated: boolean };

/** One allowed GET; the body goes to `sink` chunk by chunk (never buffered whole). */
function request(path: string, sink: Sink, { socketPath = DEFAULT_DOCKER_SOCKET, timeoutMs = 5000 }: DockerClientOptions): Promise<Done> {
  assertAllowed("GET", path); // the one gate every request passes
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: "GET", headers: { Host: "docker" }, timeout: timeoutMs }, (res) => {
      sink.contentType?.(String(res.headers["content-type"] ?? ""));
      let size = 0;
      let truncated = false;
      res.on("data", (c: Buffer) => {
        if (truncated) return;
        size += c.length;
        if (size > MAX_DOCKER_BYTES) {
          truncated = true; // enough: stop reading, keep what we have
          res.destroy();
          resolve({ status: res.statusCode ?? 0, truncated });
          return;
        }
        if (res.statusCode === 200) sink.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, truncated }));
      res.on("error", (e) => (truncated ? undefined : reject(e)));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("Docker API timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED") {
        reject(new DockerUnavailable("Docker not reachable", "Docker isn't running here (no socket)."));
      } else if (e.code === "EACCES") {
        reject(new DockerUnavailable("Docker socket: permission denied", "Add the agent user to the docker group, then restart the agent."));
      } else {
        reject(new DockerUnavailable(`Docker not reachable (${e.message})`, "Docker didn't answer."));
      }
    });
    req.end();
  });
}

export type Container = { id: string; name: string; image: string; state: string; status: string; created: number };

export async function listContainers(opts: DockerClientOptions = {}): Promise<Container[]> {
  const chunks: Buffer[] = [];
  const r = await request(LIST_PATH, { push: (c) => void chunks.push(c) }, opts);
  if (r.status !== 200 || r.truncated) throw new DockerUnavailable(`Docker answered ${r.status}`, "Docker didn't list its containers.");
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DockerUnavailable("Docker sent invalid JSON", "Docker didn't list its containers.");
  }
  if (!Array.isArray(data)) return [];
  const out: Container[] = [];
  for (const c of data as Record<string, unknown>[]) {
    const id = typeof c.Id === "string" && /^[a-f0-9]{12,64}$/.test(c.Id) ? c.Id : null;
    if (!id) continue;
    const names = Array.isArray(c.Names) ? c.Names.filter((n): n is string => typeof n === "string") : [];
    out.push({
      id,
      name: (names[0] ?? id.slice(0, 12)).replace(/^\//, ""),
      image: typeof c.Image === "string" ? c.Image : "",
      state: typeof c.State === "string" ? c.State : "",
      status: typeof c.Status === "string" ? c.Status : "",
      created: typeof c.Created === "number" ? c.Created : 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type LogLine = { stream: "stdout" | "stderr" | "tty"; text: string; cut?: boolean };

/**
 * Streaming demuxer: frames (non-TTY, 8-byte headers: stream, 0, 0, 0,
 * uint32 BE length) or raw bytes (TTY). Mode comes from the content type,
 * else from the first bytes. Lines longer than `maxLine` bytes are cut (the
 * rest of that line is skipped); only the last `keep` lines are kept, so a
 * huge log never sits in memory whole.
 */
export function createDemuxer({ contentType = "", maxLine = 8 * 1024, keep = MAX_DOCKER_TAIL } = {}) {
  let mode: "mux" | "raw" | null = /raw-stream/.test(contentType) ? "raw" : /multiplexed-stream/.test(contentType) ? "mux" : null;
  const lines: LogLine[] = [];
  const cur: Record<LogLine["stream"], { parts: Buffer[]; size: number; cut: boolean }> = {
    stdout: { parts: [], size: 0, cut: false },
    stderr: { parts: [], size: 0, cut: false },
    tty: { parts: [], size: 0, cut: false },
  };
  let pending = Buffer.alloc(0); // header bytes (mux) not yet complete
  let frameLeft = 0;
  let frameStream: "stdout" | "stderr" = "stdout";

  const emit = (stream: LogLine["stream"]) => {
    const c = cur[stream];
    const text = Buffer.concat(c.parts).toString("utf8").replace(/\r$/, "");
    lines.push(c.cut ? { stream, text, cut: true } : { stream, text });
    if (lines.length > keep) lines.shift();
    c.parts = [];
    c.size = 0;
    c.cut = false;
  };
  const feed = (stream: LogLine["stream"], b: Buffer) => {
    let start = 0;
    for (;;) {
      const nl = b.indexOf(10, start);
      const piece = b.subarray(start, nl === -1 ? b.length : nl);
      const c = cur[stream];
      const room = maxLine - c.size;
      if (piece.length > room) {
        if (room > 0) c.parts.push(piece.subarray(0, room));
        c.size = maxLine;
        c.cut = true;
      } else if (piece.length) {
        c.parts.push(piece);
        c.size += piece.length;
      }
      if (nl === -1) return;
      emit(stream);
      start = nl + 1;
    }
  };

  return {
    setContentType(ct: string) {
      if (mode === null) mode = /raw-stream/.test(ct) ? "raw" : /multiplexed-stream/.test(ct) ? "mux" : null;
    },
    push(chunk: Buffer) {
      if (mode === null) mode = looksMultiplexed(chunk) ? "mux" : "raw";
      if (mode === "raw") return feed("tty", chunk);
      let b = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      pending = Buffer.alloc(0);
      while (b.length) {
        if (frameLeft === 0) {
          if (b.length < 8) {
            pending = Buffer.from(b);
            return;
          }
          frameStream = b[0] === 2 ? "stderr" : "stdout";
          frameLeft = b.readUInt32BE(4);
          b = b.subarray(8);
          continue;
        }
        const take = Math.min(frameLeft, b.length);
        feed(frameStream, b.subarray(0, take));
        frameLeft -= take;
        b = b.subarray(take);
      }
    },
    end(): LogLine[] {
      for (const s of ["stdout", "stderr", "tty"] as const) if (cur[s].size || cur[s].cut) emit(s);
      return lines;
    },
  };
}

/** Whole-body convenience (tests). */
export function demux(body: Buffer, contentType = "", opts: { maxLine?: number; keep?: number } = {}): LogLine[] {
  const d = createDemuxer({ contentType, ...opts });
  d.push(body);
  return d.end();
}

function looksMultiplexed(b: Buffer): boolean {
  return b.length >= 8 && (b[0] === 0 || b[0] === 1 || b[0] === 2) && b[1] === 0 && b[2] === 0 && b[3] === 0;
}

export async function containerLogs(id: string, tail: number, opts: DockerClientOptions & { maxLine?: number } = {}): Promise<{ lines: LogLine[]; truncated: boolean }> {
  const n = Math.min(Math.max(Math.trunc(tail), 1), MAX_DOCKER_TAIL);
  const d = createDemuxer({ maxLine: opts.maxLine, keep: n });
  const r = await request(logsPath(id, n), { push: (c) => d.push(c), contentType: (ct) => d.setContentType(ct) }, opts);
  if (r.status === 404) throw new ContainerGone("container no longer exists");
  if (r.status !== 200) throw new DockerUnavailable(`Docker answered ${r.status}`, "Docker didn't return the logs.");
  return { lines: d.end(), truncated: r.truncated };
}
