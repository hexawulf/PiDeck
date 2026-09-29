// Refresh control (D5, what is left of E1). SAFETY: only the speed/pause
// controls and the header Refresh button are clicked.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.use({ viewport: { width: 1280, height: 900 } });

const WIDGET_POLL = /^\/api\/(metrics\/|system\/(info|history)$|docker\/|pm2\/)/;

function recordRequests(page: Page) {
  const seen: { path: string; t: number }[] = [];
  page.on("request", (r) => seen.push({ path: new URL(r.url()).pathname, t: Date.now() }));
  return seen;
}

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("Pause stops widget polling, alerts keep polling, badge shows, manual refresh works", async ({ page }) => {
  test.slow();
  await openDashboard(page);
  await page.getByRole("button", { name: "Pause auto-refresh" }).click();
  await expect(page.getByTestId("paused-badge")).toHaveText("Paused");
  const axe = await new AxeBuilder({ page }).include("header").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  const seen = recordRequests(page);
  await page.waitForTimeout(15_000);
  expect(seen.filter((r) => WIDGET_POLL.test(r.path)).map((r) => r.path)).toEqual([]);
  expect(seen.filter((r) => r.path === "/api/alerts").length).toBeGreaterThanOrEqual(2); // 7s, unaffected (all hosts since H2)

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => seen.some((r) => r.path === "/api/system/info")).toBe(true);
  await expect(page.getByTestId("paused-badge")).toBeVisible();

  await page.getByRole("button", { name: "Resume auto-refresh" }).click();
  await expect(page.getByTestId("paused-badge")).toHaveCount(0);
});

test("Pause is not persisted", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Pause auto-refresh" }).click();
  await expect(page.getByTestId("paused-badge")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  await expect(page.getByTestId("paused-badge")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("pideck:prefs:v1") ?? "")).not.toContain("paused");
});

test("Slow polls about 5× less often and is persisted", async ({ page }) => {
  test.setTimeout(120_000);
  await openDashboard(page);
  await page.getByRole("group", { name: "Refresh speed" }).getByRole("button", { name: "Slow" }).click();
  const seen = recordRequests(page);
  // /api/system/info: base 5s → 25s. Timers restart on the switch, so polls
  // land ~25s and ~50s later; measure the gap between them.
  await expect.poll(() => seen.filter((r) => r.path === "/api/system/info").length, { timeout: 70_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(2);
  const t = seen.filter((r) => r.path === "/api/system/info").map((r) => r.t);
  const gap = t[1] - t[0];
  expect(gap).toBeGreaterThan(20_000);
  expect(gap).toBeLessThan(30_000);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("pideck:prefs:v1")))!).speed).toBe("slow");
});
