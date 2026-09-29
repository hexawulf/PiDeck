// Multi-host H2 (docs/plans/multi-host-h2.md): per-host history, alerts and
// the /hosts overview. The E2E hub runs with PIDECK_SAMPLER=off (it shares
// the prod database), so it records no rows: the real endpoints answer (empty
// history, real host statuses) and route stubs supply rows, an old agent and
// a hot host. The sampler itself is covered by tests/unit/hub-sampler.test.ts
// and the real agent → hub tick in tests/unit/agent.test.ts.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const card = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);
const tile = (page: Page, id: string) => page.getByTestId(`host-tile-${id}`);
const isPath = (path: string) => (url: URL) => url.pathname === path;

test.describe("multi-host H2", () => {
  test("history, alerts and overview APIs answer for every host", async ({ page }) => {
    const api = page.request;
    const hist = await api.get("/api/history?host=e2e-agent&range=1h");
    expect(hist.status()).toBe(200);
    expect(Array.isArray(await hist.json())).toBe(true);
    expect((await api.get("/api/history?host=nope&range=1h")).status()).toBe(404);
    expect((await api.get("/api/history?host=e2e-agent&range=7d")).status()).toBe(400);
    expect((await api.get("/api/system/history")).status()).toBe(200); // 2.4 alias
    expect((await api.get("/api/system/alerts")).status()).toBe(200); // 2.4 alias
    expect(Array.isArray(await (await api.get("/api/alerts?host=all")).json())).toBe(true);
    const overview = await (await api.get("/api/overview")).json();
    expect(overview.hosts.map((h: { id: string; status: string; history: string }) => `${h.id}:${h.status}:${h.history}`)).toEqual([
      "local:online:ok", "e2e-agent:online:ok", "e2e-badtoken:auth-error:unknown", "e2e-offline:offline:unknown",
    ]);
  });

  test("a remote host's history chart reads /api/history for that host", async ({ page }) => {
    const now = Date.now();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1, timestamp: new Date(now - (30 - i) * 60_000).toISOString().replace("T", " ").replace("Z", ""),
      cpuUsage: 20, memoryUsage: 30, temperature: 50, diskReadSpeed: 100 + i, diskWriteSpeed: 50, networkRx: 10, networkTx: 5,
    }));
    const asked: string[] = [];
    await page.route(isPath("/api/history"), (route) => {
      asked.push(new URL(route.request().url()).search);
      return route.fulfill({ json: rows });
    });
    await page.goto("/h/e2e-agent/dashboard");
    await expect(card(page, "disk-io")).toBeVisible();
    await expect(card(page, "disk-io").locator(".recharts-area").first()).toBeVisible();
    await expect(card(page, "disk-io")).toContainText("Sampled every minute by the hub — gaps mean the host was unreachable.");
    expect(asked).toContain("?host=e2e-agent&range=24h");
  });

  test("overview tiles: online, wrong token, unreachable; click-through; All hosts link and g o", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("host-switcher").getByRole("button", { name: /switch host/i }).click();
    await page.getByTestId("all-hosts-link").click();
    await expect(page).toHaveURL(/\/hosts$/);
    await expect(page).toHaveTitle("All hosts · PiDeck");

    await expect(tile(page, "local")).toHaveAttribute("data-status", "online");
    await expect(tile(page, "e2e-agent")).toContainText("E2E agent");
    await expect(tile(page, "e2e-agent")).toHaveAttribute("data-status", "online");
    await expect(tile(page, "e2e-badtoken")).toContainText("can't authenticate");
    await expect(tile(page, "e2e-offline")).toContainText(/offline, last seen/);
    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await tile(page, "e2e-agent").click();
    await expect(page).toHaveURL(/\/h\/e2e-agent\/dashboard$/);
    await page.locator("body").press("g");
    await page.locator("body").press("o");
    await expect(page).toHaveURL(/\/hosts$/);
    await tile(page, "local").click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("an agent older than 2.5 is amber: 'update the agent for history', not offline", async ({ page }) => {
    await page.route(isPath("/api/overview"), async (route) => {
      const body = await (await route.fetch()).json();
      for (const h of body.hosts) if (h.id === "e2e-agent") Object.assign(h, { version: "2.4.0", history: "unsupported" });
      return route.fulfill({ json: body });
    });
    await page.goto("/hosts");
    await expect(tile(page, "e2e-agent")).toContainText("update the agent for history");
    await expect(tile(page, "e2e-agent")).toHaveAttribute("data-status", "online");
    await expect(tile(page, "e2e-agent").locator("[data-history]")).toHaveAttribute("data-history", "unsupported");
  });

  test("an alert toast names the host, and so does its resolve toast", async ({ page }) => {
    const alert = {
      id: 4242, hostId: "e2e-agent", hostLabel: "E2E agent", type: "temperature", severity: "warning",
      message: "Temperature above 70 °C (75.0 °C)", startedAt: new Date().toISOString(), resolvedAt: null as string | null,
    };
    await page.route(isPath("/api/alerts"), (route) => route.fulfill({ json: [alert] }));
    await page.goto("/dashboard");
    await expect(page.getByText("E2E agent: temperature above 70 °C (75.0 °C)", { exact: true })).toBeVisible();
    alert.resolvedAt = new Date().toISOString();
    await expect(page.getByText("E2E agent: temperature back to normal", { exact: true })).toBeVisible({ timeout: 15_000 }); // next 7 s poll
  });
});
