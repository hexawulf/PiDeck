// Multi-host H1 (docs/plans/multi-host.md). scripts/e2e-server.sh starts two
// local agents and configures the hub with:
//   e2e-agent    (label "E2E agent") — online, right token
//   e2e-badtoken — its own agent, wrong token → auth-error
//   e2e-offline  — nothing listens → offline
// Offline → recovery uses route stubs instead of stopping the real agent, so
// no spec waits for a poll interval.
import AxeBuilder from "@axe-core/playwright";
import { request as pwRequest, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const switcher = (page: Page) => page.getByTestId("host-switcher");
const openSwitcher = async (page: Page) => {
  await switcher(page).getByRole("button", { name: /switch host/i }).click();
  await expect(switcher(page).getByRole("list", { name: "Hosts" })).toBeVisible();
};
const card = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);

test.describe("multi-host", () => {
  test("switch host from the header: remote cards render the agent's data", async ({ page }) => {
    await page.goto("/dashboard");
    await openSwitcher(page);
    const links = switcher(page).locator("a[data-host]");
    await expect(links).toHaveCount(4); // local + 3 configured hosts
    const agentData = page.waitForResponse((r) => r.url().includes("/api/hosts/e2e-agent/system/info") && r.status() === 200);
    await switcher(page).locator('a[data-host="e2e-agent"]').click();
    await expect(page).toHaveURL(/\/h\/e2e-agent\/dashboard$/);
    const info = await (await agentData).json();
    expect(info).toHaveProperty("uptime");
    await expect(card(page, "cpu")).toBeVisible();
    await expect(card(page, "cpu").locator('[role="alert"], [data-host-problem]')).toHaveCount(0);
    await expect(card(page, "ram")).toContainText(/GB|MB/);
    await expect(switcher(page).getByRole("button")).toContainText("E2E agent");
    await expect(page).toHaveTitle(/^E2E agent · PiDeck$/);
  });

  test("deep link /h/<id>/dashboard; local-only tabs and widgets are hidden", async ({ page }) => {
    await page.goto("/h/e2e-agent/dashboard");
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Logs", "Apps"]); // Logs: e2e-agent serves remote logs (2.6)
    await expect(nav.getByRole("link", { name: "Apps" })).toHaveAttribute("href", "/h/e2e-agent/apps");
    await expect(card(page, "cpu")).toBeVisible();
    await expect(card(page, "quick-actions")).toHaveCount(0);
    await expect(card(page, "disk-io")).toBeVisible(); // history charts work on every host since H2
    // Tabs the remote host doesn't have fall back to its dashboard.
    await page.goto("/h/e2e-agent/cron");
    await expect(page).toHaveURL(/\/h\/e2e-agent\/dashboard$/);
    // The hub's own dashboard still has everything.
    await page.goto("/dashboard");
    await expect(card(page, "quick-actions")).toBeVisible();
  });

  test("Apps on a remote host is read-only (no action buttons)", async ({ page }) => {
    const containers = {
      containers: [{ id: "abc123", name: "web", image: "nginx:1", status: "Up 2 hours", state: "running", ports: [], createdAt: 0, labels: {} }],
    };
    for (const pattern of ["**/api/docker/containers", "**/api/hosts/e2e-agent/docker/containers"]) {
      await page.route(pattern, (route) =>
        route.request().method() === "GET" ? route.fulfill({ json: containers }) : route.fallback(),
      );
    }
    await page.goto("/h/e2e-agent/apps");
    const row = page.getByText("web", { exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-pi-darker')][1]");
    await expect(row).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(1); // copy-name only; no stop/restart
    await page.goto("/apps");
    const localRow = page.getByText("web", { exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-pi-darker')][1]");
    await expect(localRow.getByRole("button")).toHaveCount(3); // copy + stop + restart
  });

  test("an unreachable host: calm offline cards, grey dot", async ({ page }) => {
    await page.goto("/h/e2e-offline/dashboard");
    await expect(card(page, "cpu").getByText(/^e2e-offline is offline \(last seen never\)$/)).toBeVisible();
    await expect(card(page, "ram").locator('[data-host-problem="offline"]')).toBeVisible();
    await expect(page.locator('[data-widget] [role="alert"]')).toHaveCount(0);
    await expect(switcher(page).getByRole("button").locator('[data-status="offline"]')).toBeVisible();
  });

  test("agent goes away, then comes back: offline state, then recovery", async ({ page }) => {
    await page.goto("/h/e2e-agent/dashboard");
    await expect(card(page, "ram")).toContainText(/GB|MB/);
    const lastSeen = new Date(Date.now() - 3 * 60_000).toISOString();
    await page.route("**/api/hosts/e2e-agent/**", (route) =>
      route.fulfill({ status: 502, json: { offline: true, host: "e2e-agent", lastSeen } }),
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(card(page, "ram").getByText("E2E agent is offline (last seen 3 min ago)")).toBeVisible();
    await expect(card(page, "cpu").locator('[data-host-problem="offline"]')).toBeVisible();
    await page.unroute("**/api/hosts/e2e-agent/**");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(card(page, "ram")).toContainText(/GB|MB/);
    await expect(page.locator("[data-host-problem]")).toHaveCount(0);
  });

  test("wrong token: every card says so", async ({ page }) => {
    await page.goto("/h/e2e-badtoken/dashboard");
    await expect(card(page, "cpu").getByText("Can't authenticate to e2e-badtoken, check its token.")).toBeVisible();
    await expect(page.locator('[data-widget] [role="alert"]')).toHaveCount(0);
  });

  test("version mismatch: amber dot with a tooltip", async ({ page }) => {
    await page.route("**/api/hosts", async (route) => {
      const res = await route.fetch();
      const hosts = (await res.json()) as { id: string; status: string; version: string | null }[];
      await route.fulfill({ response: res, json: hosts.map((h) => (h.id === "e2e-agent" ? { ...h, status: "version-mismatch", version: "3.0.0" } : h)) });
    });
    await page.goto("/dashboard");
    await openSwitcher(page);
    const dot = switcher(page).locator('a[data-host="e2e-agent"] [data-status="version-mismatch"]');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute("title", /version mismatch — update the agent \(agent 3\.0\.0/);
  });

  test("unknown host id: No such host page", async ({ page }) => {
    await page.goto("/h/nope/dashboard");
    await expect(page.getByTestId("no-such-host")).toContainText("No such host");
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("palette 'Switch to <host>' and the g h shortcut", async ({ page }) => {
    await page.goto("/apps");
    await expect(page.getByTestId("services-card")).toBeVisible(); // (Docker may be absent here: then it's one line)
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("switch to e2e agent");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/h\/e2e-agent\/apps$/); // keeps the tab
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(switcher(page).getByRole("list", { name: "Hosts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(switcher(page).getByRole("list", { name: "Hosts" })).toHaveCount(0);
    await expect(switcher(page).getByRole("button")).toBeFocused();
  });

  test("per-host layout: hiding a card on a remote host leaves the hub's layout alone", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/h/e2e-agent/dashboard");
    await page.getByRole("button", { name: "Edit layout" }).click();
    await page.getByRole("checkbox", { name: "CPU Usage" }).uncheck();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(card(page, "cpu")).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("pideck:prefs:v1") ?? "{}"));
    expect(saved.version).toBe(2);
    expect(saved.layoutByHost["e2e-agent"].hidden).toContain("cpu");
    expect(saved.hidden).not.toContain("cpu");
    await page.goto("/dashboard");
    await expect(card(page, "cpu")).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("pideck:prefs:v1")); // leave no state for other specs
  });

  test("header text stays on one line with the switcher (2.6.1: 1024–1440 px)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(switcher(page)).toBeVisible();
    await expect(page.getByText("Raspberry Pi Admin")).toHaveCount(0); // the switcher names the host
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const wrapped = await page.getByRole("banner").evaluate((h) =>
        [...h.querySelectorAll("p, span, kbd, div")]
          .filter((e) => e.children.length === 0 && e.textContent?.trim() && e.getBoundingClientRect().height > 24)
          .map((e) => e.textContent!.trim()));
      expect(wrapped, `wrapped header text at ${width} px`).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("header-uptime")).toHaveText(/^Up \d+[ywdhm]( \d+[ywdhm])?$/);
  });

  test("the switcher is axe-clean (serious/critical), open and closed, at 390 px too", async ({ page }) => {
    const serious = async () =>
      (await new AxeBuilder({ page }).include('[data-testid="host-switcher"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`));
    await page.goto("/h/e2e-agent/dashboard");
    await expect(switcher(page)).toBeVisible();
    expect(await serious()).toEqual([]);
    await openSwitcher(page);
    expect(await serious()).toEqual([]);
    // Below sm the header is full: the switcher becomes a full-width bar above the tabs.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(switcher(page)).toBeHidden();
    const bar = page.getByTestId("host-switcher-bar");
    await bar.getByRole("button", { name: /switch host/i }).click();
    await expect(bar.getByRole("list", { name: "Hosts" })).toBeInViewport();
    const barSerious = (await new AxeBuilder({ page }).include('[data-testid="host-switcher-bar"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(barSerious).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await bar.locator('a[data-host="local"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("hub proxy: login required, read-only, allowlist only", async ({ page, baseURL }) => {
    // Explicitly empty: the config's storageState would otherwise log this context in.
    const anon = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { "X-Forwarded-Proto": "https" }, storageState: { cookies: [], origins: [] } });
    expect((await anon.get("/api/hosts")).status()).toBe(401);
    expect((await anon.get("/api/hosts/e2e-agent/metrics/ram")).status()).toBe(401);
    await anon.dispose();

    const api = page.request;
    const hosts = await (await api.get("/api/hosts")).json();
    expect(hosts.map((h: { id: string; status: string }) => `${h.id}:${h.status}`)).toEqual([
      "local:online", "e2e-agent:online", "e2e-badtoken:auth-error", "e2e-offline:offline",
    ]);
    // No token ever leaves the hub (scripts/e2e-server.sh sets these test-only values).
    for (const secret of ["e2e-agent-token-test-only", "wrong-token-test-only", "unused-token-test-only"]) {
      expect(JSON.stringify(hosts)).not.toContain(secret);
    }
    expect((await api.get("/api/hosts/e2e-agent/metrics/ram")).status()).toBe(200);
    expect((await api.post("/api/hosts/e2e-agent/system/update")).status()).toBe(405);
    for (const path of [
      "/api/hosts/e2e-agent/system/history",
      "/api/hosts/e2e-agent/metrics/%2e%2e/auth/me",
      "/api/hosts/e2e-agent/metrics%2Fram",
      "/api/hosts/e2e-agent/metrics/ram?n=1",
    ]) {
      expect((await api.get(path)).status(), path).toBe(400);
    }
    expect((await api.get("/api/hosts/unknown/metrics/ram")).status()).toBe(404);
    const offline = await api.get("/api/hosts/e2e-offline/metrics/ram");
    expect(offline.status()).toBe(502);
    expect(await offline.json()).toMatchObject({ offline: true, host: "e2e-offline" });
  });
});
