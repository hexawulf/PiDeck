// Log filters can't reach grep as options and can't hang the server with a
// regex. SAFETY: read-only GETs; the only write is a small fixture log in the
// server's logs dir, removed afterwards.
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "./fixtures";

// Same default as server/config.ts (the E2E server runs as this user).
const LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(process.env.HOME || os.homedir(), "logs");
const NAME = `pideck-e2e-grep-${process.pid}.log`;
const FILE = path.join(LOGS_DIR, NAME);
const HOST_ID = `home_${NAME.replace(/[^a-zA-Z0-9]/g, "_")}`;
const LINES = ["alpha start", "run with --help for usage", "-v looks like a flag", "Error: disk full", "deploy token=e2e-not-a-real-secret-123", "omega end"];

test.beforeAll(() => {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(FILE, LINES.join("\n") + "\n");
});
test.afterAll(() => fs.rmSync(FILE, { force: true }));

test.describe("hostlogs filter", () => {
  test("grep=--help is a substring match", async ({ request }) => {
    const res = await request.get(`/api/hostlogs/${HOST_ID}?grep=--help`);
    expect(res.status()).toBe(200);
    expect((await res.text()).trim()).toBe("run with --help for usage");
  });

  test("nested-quantifier and invalid regexes get 400", async ({ request }) => {
    const bad = await request.get(`/api/hostlogs/${HOST_ID}?grep=${encodeURIComponent("/(a+)+$/")}`);
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toBe("regex too complex");
    expect((await request.get(`/api/hostlogs/${HOST_ID}?grep=${encodeURIComponent("/foo(/")}`)).status()).toBe(400);
  });

  test("hub logs are redacted like agent logs, and say so (PD-16)", async ({ request }) => {
    const res = await request.get(`/api/hostlogs/${HOST_ID}`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("deploy token=[REDACTED]");
    expect(text).not.toContain("e2e-not-a-real-secret-123");
    expect(res.headers()["x-pideck-redacted"]).toBe("1");
    expect(res.headers()["x-pideck-truncated"]).toBe("0");
    // the filter runs on the redacted text: the secret's value never matches
    const grep = await request.get(`/api/hostlogs/${HOST_ID}?grep=not-a-real-secret`);
    expect((await grep.text()).trim()).toBe("");
  });
});
