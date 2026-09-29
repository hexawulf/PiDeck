// Remote logs (H3 Track B) against the real e2e-agent (scripts/e2e-server.sh
// starts it with PIDECK_AGENT_LOGS=on and fixture files). Docker logs come
// from a fake Engine API this spec serves on .e2e/fake-docker.sock: never a
// real daemon. The fixture log holds fake secrets; they must never reach
// the browser.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" }); // one fake Docker socket for the file

const SOCK = path.resolve(import.meta.dirname, "../../.e2e/fake-docker.sock");
const WEB = "f".repeat(64);
let docker: http.Server;

test.beforeAll(async () => {
  fs.rmSync(SOCK, { force: true });
  docker = http.createServer((req, res) => {
    if (req.method !== "GET") return res.writeHead(405).end();
    if (req.url === "/containers/json?all=1") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([
        { Id: WEB, Names: ["/web"], Image: "nginx:1", State: "running", Status: "Up", Created: 1_700_000_000 },
      ]));
    }
    if (req.url?.startsWith(`/containers/${WEB}/logs?`)) {
      const frame = (stream: number, text: string) => {
        const b = Buffer.from(text);
        const h = Buffer.alloc(8);
        h[0] = stream;
        h.writeUInt32BE(b.length, 4);
        return Buffer.concat([h, b]);
      };
      res.writeHead(200, { "content-type": "application/vnd.docker.multiplexed-stream" });
      return res.end(Buffer.concat([frame(1, "web listening on :80\n"), frame(2, "web warn api_key=e2e-fake-key\n")]));
    }
    res.writeHead(404, { "content-type": "application/json" }).end('{"message":"not found"}');
  });
  await new Promise<void>((r) => docker.listen(SOCK, r));
});
test.afterAll(async () => {
  await new Promise((r) => docker.close(r));
  fs.rmSync(SOCK, { force: true });
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Sections" });
const source = (page: Page, id: string) => page.locator(`[data-source="${id}"]`);
const SECRETS = ["e2e-fake-bearer", "e2e-fake-password", "e2e-fake-key"];

test("remote Logs tab: list, tail with redactions, filter, unreadable source, Docker", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/agent/logs")) bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/h/e2e-agent/dashboard");
  await expect(nav(page).getByRole("link")).toHaveText(["Dashboard", "Logs", "Apps"]);
  await nav(page).getByRole("link", { name: "Logs" }).click();
  await expect(page).toHaveURL(/\/h\/e2e-agent\/logs$/);
  await expect(page).toHaveTitle(/^E2E agent · Logs · PiDeck$/);

  // List: configured files (the monthly name resolved), a symlink greyed with its hint, Docker containers.
  await expect(source(page, "file_app")).toContainText("App log");
  await expect(source(page, "file_report")).toHaveAttribute("data-readable", "true");
  await expect(source(page, "file_link")).toHaveAttribute("data-readable", "false");
  await expect(source(page, "file_link")).toContainText("symlink");
  await expect(source(page, "docker_web")).toContainText("web");

  // Tail with redactions marked; the fake secrets never reach the browser.
  await source(page, "file_app").click();
  const lines = page.getByTestId("remote-log-lines");
  await expect(lines).toContainText("app started");
  await expect(lines.locator("mark[data-redacted]")).toHaveCount(2);
  await expect(page.getByTestId("redacted-count")).toContainText("2 redacted");

  // Filter (applied on the agent, after redaction).
  await page.getByLabel("Filter").fill("ERROR");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(lines.locator("div")).toHaveCount(1);
  await expect(lines).toContainText("ERROR upstream timeout");
  await page.getByLabel("Filter").fill("");
  await page.getByRole("button", { name: "Apply" }).click();

  // Unreadable source: the hint instead of lines.
  await source(page, "file_link").click();
  await expect(page.getByTestId("unreadable")).toContainText("symlink");

  // Docker (fake Engine): stdout and stderr, redacted.
  await source(page, "docker_web").click();
  await expect(lines).toContainText("web listening on :80");
  await expect(lines).toContainText("[stderr] web warn api_key=[REDACTED]");

  for (const secret of SECRETS) {
    expect(bodies.join("\n")).not.toContain(secret);
    await expect(page.locator("body")).not.toContainText(secret);
  }
});

test("remote log pins are per host and reopen the source with its filter", async ({ page }) => {
  await page.goto("/h/e2e-agent/logs");
  await source(page, "file_app").click();
  await page.getByLabel("Filter").fill("ERROR");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Pin" }).click();
  await expect(page.getByTestId("remote-pins")).toContainText("E2E agent: App log — “ERROR”");
  // The hub's own Logs tab doesn't list the remote pin.
  await page.goto("/logs");
  await expect(page.getByTestId("pinned-logs")).toHaveCount(0);
  await page.goto("/h/e2e-agent/logs");
  await page.getByTestId("remote-pins").getByRole("button").click();
  await expect(page.getByTestId("remote-log-lines").locator("div")).toHaveCount(1);
});

test("the hub proxy validates queries; unknown sources are 404 after auth", async ({ page }) => {
  const api = page.request;
  expect((await api.get("/api/hosts/e2e-agent/agent/logs")).status()).toBe(200);
  expect((await api.get("/api/hosts/e2e-agent/agent/logs/file_app?lines=9999")).status()).toBe(400);
  expect((await api.get("/api/hosts/e2e-agent/agent/logs/file_app?path=/etc/passwd")).status()).toBe(400);
  expect((await api.get(`/api/hosts/e2e-agent/agent/logs/file_app?filter=${"a".repeat(201)}`)).status()).toBe(400);
  const gone = await api.get("/api/hosts/e2e-agent/agent/logs/file_nope");
  expect(gone.status()).toBe(404);
  expect(await gone.json()).toMatchObject({ message: "No such log source" });
  expect((await api.get("/api/hosts/e2e-agent/agent/logs/..%2F..%2Fetc%2Fpasswd")).status()).toBe(400);
  // e2e-badtoken's agent has logs off and the hub can't authenticate anyway.
  expect((await api.get("/api/hosts/e2e-badtoken/agent/logs")).status()).toBe(502);
});

test("the Logs tab is hidden for an agent without the logs capability", async ({ page }) => {
  await page.route((u) => u.pathname === "/api/hosts", async (route) => {
    const hosts = await (await route.fetch()).json();
    for (const h of hosts) if (h.id === "e2e-agent") h.logs = false;
    return route.fulfill({ json: hosts });
  });
  await page.goto("/h/e2e-agent/dashboard");
  await expect(nav(page).getByRole("link")).toHaveText(["Dashboard", "Apps"]);
  await page.goto("/h/e2e-agent/logs");
  await expect(page).toHaveURL(/\/h\/e2e-agent\/dashboard$/);
  await page.goto("/h/e2e-badtoken/dashboard");
  await expect(nav(page).getByRole("link")).toHaveText(["Dashboard", "Apps"]);
});
