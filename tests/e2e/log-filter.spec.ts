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
const LINES = ["alpha start", "run with --help for usage", "-v looks like a flag", "Error: disk full", "omega end"];

test.beforeAll(() => {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(FILE, LINES.join("\n") + "\n");
});
test.afterAll(() => fs.rmSync(FILE, { force: true }));

test.describe("rasplogs grep", () => {
  test("grep=--help returns matching lines, not grep's help text", async ({ request }) => {
    const res = await request.get(`/api/rasplogs/${NAME}?grep=--help`);
    expect(res.status()).toBe(200);
    const { content } = await res.json();
    expect(content.trim()).toBe("run with --help for usage");
    expect(content).not.toMatch(/Usage: grep/);
  });

  test("grep=-v is a pattern, not an inverted match", async ({ request }) => {
    const { content } = await (await request.get(`/api/rasplogs/${NAME}?grep=-v`)).json();
    expect(content.trim()).toBe("-v looks like a flag");
  });

  test("/…/ is a regex, plain text is literal", async ({ request }) => {
    const rx = await (await request.get(`/api/rasplogs/${NAME}?grep=${encodeURIComponent("/^[ao]/")}`)).json();
    expect(rx.content.trim().split("\n")).toEqual(["alpha start", "omega end"]);
    const lit = await (await request.get(`/api/rasplogs/${NAME}?grep=${encodeURIComponent("^[ao]")}`)).json();
    expect(lit.content).toBe("");
  });

  test("overlong or multi-line patterns are rejected", async ({ request }) => {
    expect((await request.get(`/api/rasplogs/${NAME}?grep=${"x".repeat(201)}`)).status()).toBe(400);
    expect((await request.get(`/api/rasplogs/${NAME}?grep=a%0Ab`)).status()).toBe(400);
  });
});

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
});
