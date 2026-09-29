// Remote logs on the agent (docs/plans/multi-host-h3.md › Track B): source
// config, file tails and caps, journald via an injected exec, the Docker
// client against a fake socket, and the HTTP endpoints.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentLogConfig, expandDate, listSources, MAX_ANSWER_BYTES, parseTailQuery, readSource, resolveFile, SourceError, tailFile, type AgentLogConfig,
} from "../../server/services/agent-logs/sources";
import { assertAllowed, containerLogs, demux, DockerRefused, DockerUnavailable, listContainers, logsPath } from "../../server/services/agent-logs/docker";
import { createAgentApp } from "../../server/agent";
import { sha256Hex } from "../../server/middleware/agentAuth";
import { setPlatformForTests } from "../../server/services/platform";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-logs-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  setPlatformForTests(null);
});
const write = (name: string, text: string) => {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
const quiet = () => {};

// ── fake Docker Engine on a unix socket ──────────────────────────────────
const frame = (stream: 1 | 2, text: string) => {
  const b = Buffer.from(text);
  const h = Buffer.alloc(8);
  h[0] = stream;
  h.writeUInt32BE(b.length, 4);
  return Buffer.concat([h, b]);
};
const IDS = { web: "a".repeat(64), tty: "b".repeat(64), gone: "c".repeat(64), huge: "d".repeat(64) };
const CONTAINERS = [
  { Id: IDS.web, Names: ["/web"], Image: "nginx:1", State: "running", Status: "Up 2 hours", Created: 1_700_000_000 },
  { Id: IDS.tty, Names: ["/shell"], Image: "alpine", State: "exited", Status: "Exited (0)", Created: 1_700_000_100 },
  { Id: IDS.gone, Names: ["/ghost"], Image: "x", State: "exited", Status: "Exited", Created: 1 },
  { Id: IDS.huge, Names: ["/chatty"], Image: "y", State: "running", Status: "Up", Created: 2 },
];
const dockerSeen: string[] = [];
let socketPath = "";
let docker: http.Server;
beforeAll(async () => {
  socketPath = path.join(tmp, "docker.sock");
  docker = http.createServer((req, res) => {
    dockerSeen.push(`${req.method} ${req.url}`);
    if (req.url === "/containers/json?all=1") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(CONTAINERS));
    const m = /^\/containers\/([a-f0-9]+)\/logs\?/.exec(req.url ?? "");
    if (m?.[1] === IDS.web) {
      res.writeHead(200, { "content-type": "application/vnd.docker.multiplexed-stream" });
      // frames split across writes, a line split across two frames, stderr interleaved
      res.write(frame(1, "2026-09-29T08:00:00Z GET / 200\n2026-09-29T08:00:01Z GET /login?"));
      res.write(frame(2, "2026-09-29T08:00:01Z warn: slow upstream\n"));
      res.write(frame(1, "token=abcdef123 302\n"));
      return res.end(frame(1, "2026-09-29T08:00:02Z Authorization: Bearer zzzzzzzzzz\n"));
    }
    if (m?.[1] === IDS.tty) {
      res.writeHead(200, { "content-type": "application/vnd.docker.raw-stream" });
      return res.end("\u001b[32mready\u001b[0m\r\nprompt> ls\r\n");
    }
    if (m?.[1] === IDS.huge) {
      res.writeHead(200, { "content-type": "application/vnd.docker.multiplexed-stream" });
      return res.end(Buffer.concat([frame(1, `${"x".repeat(20_000)}\n`), frame(1, "short\n")]));
    }
    res.writeHead(404, { "content-type": "application/json" }).end('{"message":"No such container"}');
  });
  await new Promise<void>((r) => docker.listen(socketPath, r));
});
afterAll(() => new Promise((r) => docker.close(r)));

describe("Docker client: only two calls, ever", () => {
  it.each([
    ["GET", "/containers/json?all=1"],
    ["GET", logsPath("a".repeat(64), 200)],
    ["GET", logsPath("abcdef012345", 2000)],
  ])("allows %s %s", (m, p) => expect(() => assertAllowed(m, p)).not.toThrow());
  it.each([
    ["POST", "/containers/json?all=1"],
    ["DELETE", `/containers/${"a".repeat(64)}`],
    ["GET", "/containers/json"],
    ["GET", "/containers/json?all=1&filters=x"],
    ["GET", `/containers/${"a".repeat(64)}/json`],
    ["GET", `/containers/${"a".repeat(64)}/logs?stdout=1&stderr=1&tail=200&timestamps=1&follow=1`],
    ["GET", `/containers/${"a".repeat(64)}/logs?stdout=1&stderr=1&tail=0&timestamps=1`],
    ["GET", `/containers/${"a".repeat(64)}/logs?stdout=1&stderr=1&tail=2001&timestamps=1`],
    ["GET", "/containers/web/logs?stdout=1&stderr=1&tail=10&timestamps=1"],
    ["GET", "/containers/../images/json?stdout=1&stderr=1&tail=10&timestamps=1"],
    ["GET", "/images/json"],
    ["GET", "/exec/abc/start"],
    ["GET", "/v1.43/containers/json?all=1"],
    ["POST", `/containers/${"a".repeat(64)}/exec`],
  ])("refuses %s %s", (m, p) => expect(() => assertAllowed(m, p)).toThrow(DockerRefused));

  it("lists containers (running and stopped) and demuxes stdout/stderr across frames", async () => {
    const list = await listContainers({ socketPath });
    expect(list.map((c) => `${c.name}:${c.state}`)).toEqual(["chatty:running", "ghost:exited", "shell:exited", "web:running"]);
    const { lines } = await containerLogs(IDS.web, 50, { socketPath });
    expect(lines).toEqual([
      { stream: "stdout", text: "2026-09-29T08:00:00Z GET / 200" },
      { stream: "stderr", text: "2026-09-29T08:00:01Z warn: slow upstream" },
      { stream: "stdout", text: "2026-09-29T08:00:01Z GET /login?token=abcdef123 302" },
      { stream: "stdout", text: "2026-09-29T08:00:02Z Authorization: Bearer zzzzzzzzzz" },
    ]);
  });
  it("TTY containers: raw bytes, CRLF trimmed", async () => {
    const { lines } = await containerLogs(IDS.tty, 10, { socketPath });
    expect(lines.map((l) => l.text)).toEqual(["\u001b[32mready\u001b[0m", "prompt> ls"]);
    expect(lines[0].stream).toBe("tty");
  });
  it("demux without a content type: detects frames or raw; keeps the last N lines; cuts huge lines", () => {
    expect(demux(Buffer.concat([frame(1, "a\n"), frame(2, "b\n")])).map((l) => l.text)).toEqual(["a", "b"]);
    expect(demux(Buffer.from("plain\ntext\n")).map((l) => `${l.stream}:${l.text}`)).toEqual(["tty:plain", "tty:text"]);
    const many = Buffer.concat(Array.from({ length: 50 }, (_, i) => frame(1, `line ${i}\n`)));
    expect(demux(many, "", { keep: 3 }).map((l) => l.text)).toEqual(["line 47", "line 48", "line 49"]);
    const cut = demux(frame(1, `${"y".repeat(100)}\nok\n`), "", { maxLine: 10 });
    expect(cut[0]).toEqual({ stream: "stdout", text: "y".repeat(10), cut: true });
    expect(cut[1].text).toBe("ok");
  });
  it("a container gone between list and tail → ContainerGone; daemon down → DockerUnavailable", async () => {
    await expect(containerLogs("e".repeat(64), 10, { socketPath })).rejects.toThrow("container no longer exists");
    await expect(listContainers({ socketPath: path.join(tmp, "nope.sock") })).rejects.toBeInstanceOf(DockerUnavailable);
  });
  it("the fake daemon saw only the two allowed kinds of request", () => {
    for (const r of dockerSeen) expect(r).toMatch(/^GET \/containers\/(json\?all=1|[a-f0-9]{64}\/logs\?stdout=1&stderr=1&tail=\d+&timestamps=1)$/);
  });
});

describe("log source config", () => {
  it("files (PIDECK_HOST_LOGS syntax), journald units, docker; off by default", () => {
    const warn = vi.fn();
    const cfg = agentLogConfig({
      PIDECK_HOST_LOGS: "syslog:Syslog=/var/log/syslog,wulf:Wulfreport=/home/zk/logs/wulfreport/%Y-%m.log,Relative=logs/x.log",
      PIDECK_AGENT_JOURNAL_UNITS: "pideck-agent, user:openclaw-gateway, bad unit, -x, nginx.service",
      PIDECK_AGENT_DOCKER_LOGS: "on",
    }, warn);
    expect(cfg.enabled).toBe(false);
    expect(cfg.files.map((f) => [f.id, f.pattern])).toEqual([["file_syslog", "/var/log/syslog"], ["file_wulf", "/home/zk/logs/wulfreport/%Y-%m.log"]]);
    expect(cfg.journal.map((j) => [j.id, j.unit, j.user])).toEqual([
      ["journal_pideck_agent", "pideck-agent", false], ["journal_user_openclaw_gateway", "openclaw-gateway", true], ["journal_nginx_service", "nginx.service", false],
    ]);
    expect(cfg.docker).toEqual({ enabled: true, socketPath: "/var/run/docker.sock" });
    expect(warn).toHaveBeenCalledTimes(3); // relative path, "bad unit", "-x"
    expect(agentLogConfig({ PIDECK_AGENT_LOGS: "on" }).enabled).toBe(true);
    expect(agentLogConfig({ PIDECK_AGENT_LOGS: "1" }).enabled).toBe(false);
  });
  it("monthly names: %Y-%m placeholder and a newest-match glob (never a rotated file)", async () => {
    expect(expandDate("/l/%Y-%m.log", new Date(2026, 8, 29))).toBe("/l/2026-09.log");
    expect(expandDate("/l/%Y%m%d.log", new Date(2026, 0, 5))).toBe("/l/20260105.log");
    const dir = path.join(tmp, "wulf");
    write("wulf/2026-08.log", "old\n");
    write("wulf/2026-09.log", "new\n");
    write("wulf/2026-10.log.gz", "rotated");
    write("wulf/2026-11.log.1", "rotated");
    fs.utimesSync(path.join(dir, "2026-08.log"), new Date(2026, 7, 31), new Date(2026, 7, 31));
    fs.utimesSync(path.join(dir, "2026-09.log"), new Date(2026, 8, 29), new Date(2026, 8, 29));
    fs.utimesSync(path.join(dir, "2026-10.log.gz"), new Date(2027, 0, 1), new Date(2027, 0, 1));
    expect(await resolveFile(`${dir}/*.log*`)).toBe(path.join(dir, "2026-09.log"));
    expect(await resolveFile(`${dir}/%Y-%m.log`, new Date(2026, 7, 2))).toBe(path.join(dir, "2026-08.log"));
    expect(await resolveFile(`${dir}/nothing-*.log`)).toBeNull();
    expect(await resolveFile(`${tmp}/*/x.log`)).toBeNull(); // no wildcards in directories
  });
});

const cfgWith = (over: Partial<AgentLogConfig> = {}): AgentLogConfig => ({ enabled: true, files: [], journal: [], docker: { enabled: false, socketPath }, ...over });

describe("tails, caps, redaction, filter", () => {
  it("the last N lines of a file; secrets redacted and marked; filter runs on redacted text", async () => {
    const p = write("app.log", `${Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n")}\nlogin password=hunter22 ok\n`);
    const cfg = cfgWith({ files: [{ id: "file_app", label: "App", kind: "file", pattern: p }] });
    const r = await readSource(cfg, "file_app", 3, undefined);
    expect(r).toMatchObject({ id: "file_app", kind: "file", lines: ["line 498", "line 499", "login password=[REDACTED] ok"], truncated: false, redacted: 1, redactedLines: [2] });
    // A filter can't probe the secret: it matches only the redacted text.
    expect((await readSource(cfg, "file_app", 10, "hunter22")).lines).toEqual([]);
    expect((await readSource(cfg, "file_app", 10, "/line 49[89]/")).lines).toEqual(["line 498", "line 499"]);
    await expect(readSource(cfg, "file_app", 10, "/(a+)+/")).rejects.toMatchObject({ status: 400 }); // ReDoS guard
  });
  it("cuts lines at 8 kB and caps the answer at 1 MB (JSON-encoded), keeping the newest lines", async () => {
    const long = "z".repeat(20_000);
    const p = write("big.log", `${Array.from({ length: 1500 }, (_, i) => `${i} ${"q".repeat(1000)}`).join("\n")}\n${long}\n`);
    const cfg = cfgWith({ files: [{ id: "file_big", label: "Big", kind: "file", pattern: p }] });
    const r = await readSource(cfg, "file_big", 2000, undefined);
    expect(r.truncated).toBe(true);
    expect(r.lines.at(-1)).toMatch(/^z{8192} …\[line cut\]$/);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(MAX_ANSWER_BYTES);
    expect(r.lines.at(-2)).toMatch(/^1499 /);
  });
  it("tailFile on a huge file reads only the end", async () => {
    const p = write("huge.log", `${"old line\n".repeat(400_000)}last\n`);
    const t = await tailFile(p, 2);
    expect(t.lines).toEqual(["old line", "last"]);
  });
  it("unreadable, missing, symlinked sources are listed with a hint, never a 500", async () => {
    const real = write("real.log", "x\n");
    const link = path.join(tmp, "link.log");
    fs.symlinkSync(real, link);
    const denied = write("denied.log", "secret\n");
    const cfg = cfgWith({
      files: [
        { id: "file_ok", label: "OK", kind: "file", pattern: real },
        { id: "file_missing", label: "Missing", kind: "file", pattern: path.join(tmp, "missing.log") },
        { id: "file_link", label: "Link", kind: "file", pattern: link },
        { id: "file_denied", label: "Denied", kind: "file", pattern: denied },
      ],
    });
    const access = fsp.access;
    vi.spyOn(fsp, "access").mockImplementation(async (p, mode) => {
      if (p === denied) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return access(p, mode);
    });
    const { sources } = await listSources(cfg);
    const by = Object.fromEntries(sources.map((s) => [s.id, s]));
    expect(by.file_ok).toMatchObject({ readable: true, size: 2 });
    expect(by.file_missing).toMatchObject({ readable: false, hint: "File not found." });
    expect(by.file_link).toMatchObject({ readable: false, hint: expect.stringMatching(/symlink/) });
    expect(by.file_denied).toMatchObject({ readable: false, hint: expect.stringMatching(/adm on Ubuntu, log on DSM/) });
    await expect(readSource(cfg, "file_denied", 10, undefined)).rejects.toMatchObject({ status: 409 });
    await expect(readSource(cfg, "file_nope", 10, undefined)).rejects.toMatchObject({ status: 404 });
  });
  it("journald via journalctl -u / --user-unit (argument array, no shell); permission problems become a hint", async () => {
    vi.spyOn(await import("../../server/services/unavailable"), "hasTool").mockReturnValue(true);
    const exec = vi.fn(async (_cmd: string, args: string[]) =>
      args.includes("--user-unit") ? { stdout: "", stderr: "Hint: You are currently not seeing messages from other users" } : { stdout: "2026-09-29T08:00:00+0800 piapps2 pideck-agent[1]: started token=abc123\n", stderr: "" },
    );
    const cfg = cfgWith({
      journal: [
        { id: "journal_pideck_agent", label: "pideck-agent · journal", kind: "journal", unit: "pideck-agent", user: false },
        { id: "journal_user_x", label: "x (user) · journal", kind: "journal", unit: "x", user: true },
      ],
    });
    const { sources } = await listSources(cfg, { exec });
    expect(sources.map((s) => s.readable)).toEqual([true, false]);
    expect(sources[1].hint).toMatch(/systemd-journal/);
    const r = await readSource(cfg, "journal_pideck_agent", 5, undefined, { exec });
    expect(r.lines).toEqual(["2026-09-29T08:00:00+0800 piapps2 pideck-agent[1]: started token=[REDACTED]"]);
    expect(exec).toHaveBeenLastCalledWith("journalctl", ["-u", "pideck-agent", "-n", "5", "--no-pager", "-q", "-o", "short-iso"], expect.anything());
  });
  it("journald on DSM: not available", async () => {
    setPlatformForTests({ kind: "dsm", os: "DSM 7.4.1" });
    const cfg = cfgWith({ journal: [{ id: "journal_a", label: "a", kind: "journal", unit: "a", user: false }] });
    expect((await listSources(cfg)).sources[0]).toMatchObject({ readable: false, hint: expect.stringMatching(/DSM/) });
  });
  it("docker: every container is a source; tails are redacted and ANSI-free; gone → 404; daemon down → hint", async () => {
    const cfg = cfgWith({ docker: { enabled: true, socketPath } });
    const list = await listSources(cfg);
    expect(list.docker).toEqual({ enabled: true, reachable: true });
    expect(list.sources.map((s) => s.id)).toEqual(["docker_chatty", "docker_ghost", "docker_shell", "docker_web"]);
    const web = await readSource(cfg, "docker_web", 200, undefined);
    expect(web.lines).toEqual([
      "2026-09-29T08:00:00Z GET / 200",
      "[stderr] 2026-09-29T08:00:01Z warn: slow upstream",
      "2026-09-29T08:00:01Z GET /login?token=[REDACTED] 302",
      "2026-09-29T08:00:02Z Authorization: [REDACTED]",
    ]);
    expect(web.redacted).toBe(2);
    expect((await readSource(cfg, "docker_shell", 10, undefined)).lines).toEqual(["ready", "prompt> ls"]);
    const chatty = await readSource(cfg, "docker_chatty", 10, undefined);
    expect(chatty.truncated).toBe(true);
    expect(chatty.lines[0]).toMatch(/^x{8192} …\[line cut\]$/);
    await expect(readSource(cfg, "docker_ghost", 10, undefined)).rejects.toMatchObject({ status: 404, message: "container no longer exists" });
    const down = cfgWith({ docker: { enabled: true, socketPath: path.join(tmp, "none.sock") } });
    expect(await listSources(down)).toEqual({ sources: [], docker: { enabled: true, reachable: false, hint: expect.stringMatching(/Docker isn't running/) } });
    await expect(readSource(down, "docker_web", 10, undefined)).rejects.toMatchObject({ status: 503 });
  });
  it("query validation: lines 1–2000, filter ≤ 200 chars, nothing else", () => {
    expect(parseTailQuery({})).toEqual({ lines: 200, filter: undefined });
    expect(parseTailQuery({ lines: "2000", filter: "err" })).toEqual({ lines: 2000, filter: "err" });
    for (const q of [{ lines: "0" }, { lines: "2001" }, { lines: "1e3" }, { lines: ["1", "2"] }, { filter: "x".repeat(201) }, { filter: ["a"] }, { path: "/etc/passwd" }]) {
      expect(() => parseTailQuery(q as Record<string, unknown>)).toThrow(SourceError);
    }
  });
});

describe("agent HTTP: /api/agent/logs", () => {
  const TOKEN = "logs-test-token-only-0123456789abcdef";
  let base = "";
  let offBase = "";
  const servers: http.Server[] = [];
  beforeAll(async () => {
    const p = write("http/app.log", "hello\nAuthorization: Bearer abcdefghijkl\n");
    const start = async (logs: AgentLogConfig) => {
      const s = createAgentApp({ tokenSha256: sha256Hex(TOKEN), logs }).listen(0, "127.0.0.1");
      await new Promise((r) => s.once("listening", r));
      servers.push(s);
      return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    };
    base = await start(cfgWith({ files: [{ id: "file_app", label: "App", kind: "file", pattern: p }], docker: { enabled: true, socketPath } }));
    offBase = await start({ ...cfgWith(), enabled: false });
  });
  afterAll(async () => {
    for (const s of servers) await new Promise((r) => s.close(r));
  });
  const get = (b: string, p: string, token: string | null = TOKEN) => fetch(b + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("401 before anything else, even for unknown ids and when logs are off", async () => {
    for (const [b, p] of [[base, "/api/agent/logs"], [base, "/api/agent/logs/nope"], [offBase, "/api/agent/logs"]]) {
      expect((await get(b, p, null)).status).toBe(401);
    }
  });
  it("off by default: 404 after auth, capabilities.logs false", async () => {
    expect((await get(offBase, "/api/agent/logs")).status).toBe(404);
    expect((await get(offBase, "/api/agent/logs/file_app")).status).toBe(404);
    expect((await (await get(offBase, "/api/agent/info")).json()).capabilities.logs).toBe(false);
  });
  it("on: list, tail (redacted), 404 unknown id, 400 bad query; ids can't be paths", async () => {
    expect((await (await get(base, "/api/agent/info")).json()).capabilities.logs).toBe(true);
    const list = await (await get(base, "/api/agent/logs")).json();
    expect(list.sources.map((s: { id: string }) => s.id)).toEqual(["file_app", "docker_chatty", "docker_ghost", "docker_shell", "docker_web"]);
    const tail = await (await get(base, "/api/agent/logs/file_app?lines=5")).json();
    expect(tail.lines).toEqual(["hello", "Authorization: [REDACTED]"]);
    expect((await get(base, "/api/agent/logs/file_nope")).status).toBe(404);
    expect((await get(base, "/api/agent/logs/file_app?lines=9999")).status).toBe(400);
    expect((await get(base, "/api/agent/logs/file_app?lines=5&path=/etc/passwd")).status).toBe(400);
    for (const p of ["/api/agent/logs/..%2F..%2Fetc%2Fpasswd", "/api/agent/logs/../../etc/passwd", "/api/agent/logs/FILE_APP", "/api/agent/logs/a/b"]) {
      expect((await get(base, p)).status, p).toBe(404);
    }
  });
});
