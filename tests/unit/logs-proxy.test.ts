// Hub side of remote logs (H3 Track B): the proxy's URL/query validation,
// pass-through of the agent's logs statuses, the logs capability, the audit line.
import { describe, expect, it, vi } from "vitest";
import { agentAllows, agentLogsPathFromHubUrl, agentPathFromHubUrl, remoteLogAuditLine } from "../../server/agent-api";
import { createHostHub } from "../../server/hosts";

const H = "/api/hosts/p2/agent/logs";

describe("agentLogsPathFromHubUrl", () => {
  it.each([
    [H, { path: "/api/agent/logs", sourceId: null }],
    [`${H}/`, { path: "/api/agent/logs", sourceId: null }],
    [`${H}/file_syslog`, { path: "/api/agent/logs/file_syslog", sourceId: "file_syslog" }],
    [`${H}/docker_plex?lines=500`, { path: "/api/agent/logs/docker_plex?lines=500", sourceId: "docker_plex" }],
    [`${H}/docker_plex?lines=0500`, { path: "/api/agent/logs/docker_plex?lines=500", sourceId: "docker_plex" }],
    [`${H}/x?filter=error%20code&lines=10`, { path: "/api/agent/logs/x?filter=error+code&lines=10", sourceId: "x" }],
    [`${H}/x?filter=%2Fwarn%7Cerr%2F`, { path: "/api/agent/logs/x?filter=%2Fwarn%7Cerr%2F", sourceId: "x" }],
    [`${H}/x?filter=`, { path: "/api/agent/logs/x", sourceId: "x" }],
  ])("%s → ok", (url, expected) => expect(agentLogsPathFromHubUrl(url, "p2")).toEqual(expected));

  it.each([
    [`${H}/x?lines=0`, /lines/],
    [`${H}/x?lines=2001`, /lines/],
    [`${H}/x?lines=1.5`, /lines/],
    [`${H}/x?lines=-1`, /lines/],
    [`${H}/x?lines=10&lines=20`, /Repeated/],
    [`${H}/x?filter=${"a".repeat(201)}`, /filter/],
    [`${H}/x?filter=a%0Ab`, /filter/],
    [`${H}/x?filter=a%00b`, /filter/],
    [`${H}/x?path=/etc/passwd`, /Unknown parameter/],
    [`${H}/x?follow=1`, /Unknown parameter/],
    [`${H}/x?filter=%E0%A4%A`, /Bad query/],
    [`${H}?lines=5`, /no parameters/],
  ])("%s → 400 %s", (url, msg) => {
    const r = agentLogsPathFromHubUrl(url, "p2");
    expect(r && "error" in r ? r.error : "").toMatch(msg);
  });

  it.each([
    `${H}/..%2F..%2Fetc`,
    `${H}/../../etc/passwd`,
    `${H}/FILE`,
    `${H}/a/b`,
    `${H}/a.b`,
    `${H}x`,
    "/api/hosts/other/agent/logs/x",
    `${H}/${"a".repeat(65)}`,
  ])("%s → not a logs URL", (url) => expect(agentLogsPathFromHubUrl(url, "p2")).toBeNull());

  it("the plain allowlist still refuses query strings and still has the list path", () => {
    expect(agentPathFromHubUrl(`${H}?x=1`, "p2")).toBeNull();
    expect(agentAllows("GET", "/api/agent/logs")).toBe(true);
    expect(agentAllows("GET", "/api/agent/logs/docker_plex")).toBe(true);
    expect(agentAllows("POST", "/api/agent/logs/docker_plex")).toBe(false);
    expect(agentAllows("GET", "/api/agent/logs/../x")).toBe(false);
  });
});

const TOKEN = "0123456789abcdef0123456789abcdef";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function hub(answer: (url: string) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string) => answer(url));
  const h = createHostHub({ hosts: [{ id: "p2", label: "piapps2", url: "http://p2:5016", token: TOKEN }], fetchImpl: fetchImpl as unknown as typeof fetch, cacheMs: 0 });
  return { h, fetchImpl };
}

describe("hub proxy for remote logs", () => {
  it("forwards the canonical path; tags the read for the audit line", async () => {
    const { h, fetchImpl } = hub(() => json({ id: "file_syslog", lines: ["a"], truncated: false, redacted: 0, redactedLines: [] }));
    const r = await h.proxy("p2", `${H}/file_syslog?lines=50&filter=sshd`);
    expect(r).toMatchObject({ status: 200, logSource: "file_syslog", body: { lines: ["a"] } });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://p2:5016/api/agent/logs/file_syslog?lines=50&filter=sshd");
    expect((await h.proxy("p2", H)).logSource).toBeNull(); // the list: tagged, but no source
  });
  it("passes the agent's 400/404/409/503 with its message only; other failures stay 502", async () => {
    for (const status of [400, 404, 409, 503]) {
      const { h } = hub(() => json({ message: `m${status}\u0007`, secret: "never forwarded" }, status));
      expect(await h.proxy("p2", `${H}/x`)).toEqual({ status, body: { message: `m${status} `, host: "p2" }, logSource: "x" });
    }
    const { h } = hub(() => json({ message: "boom" }, 500));
    expect((await h.proxy("p2", `${H}/x`)).status).toBe(502);
    const { h: plain } = hub(() => json({ message: "nope" }, 404));
    expect((await plain.proxy("p2", "/api/hosts/p2/metrics/ram")).status).toBe(502); // metrics keep the H1 rule
  });
  it("a bad query never reaches the agent", async () => {
    const { h, fetchImpl } = hub(() => json({}));
    expect(await h.proxy("p2", `${H}/x?lines=99999`)).toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("logs capability shows up in the host list", async () => {
    const { h } = hub((url) => (url.endsWith("/api/agent/info") ? json({ version: "2.6.0", capabilities: { sample: true, logs: true } }) : json({})));
    const [local, p2] = await h.list();
    expect(local.logs).toBe(true);
    expect(p2).toMatchObject({ id: "p2", logs: true, history: "ok" });
    const { h: old } = hub(() => json({ version: "2.5.0", capabilities: { sample: true, logs: false } }));
    expect((await old.list())[1].logs).toBe(false);
  });
});

describe("audit line", () => {
  it("names host, source, user; never anything the caller controls freely", () => {
    expect(remoteLogAuditLine({ host: "p2", source: "docker_plex", user: 1, ip: "192.168.50.10", status: 200 })).toBe(
      "[logs] remote read host=p2 source=docker_plex user=1 ip=192.168.50.10 status=200",
    );
    expect(remoteLogAuditLine({ host: "p2", source: "x", user: "a b\n", ip: "evil\nline", status: 404 })).toBe("[logs] remote read host=p2 source=x user=? ip=? status=404");
  });
});
