// Tabs are routes (E5). SAFETY: only tab links, the logo link and browser
// history are used; ./fixtures blocks any destructive request.
import { expect, test } from "./fixtures";

const activeTab = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sections" }).locator('[aria-current="page"]');

test("deep link to /logs, switch tab, back button returns", async ({ page }) => {
  await page.goto("/logs");
  await expect(activeTab(page)).toHaveText("Logs");
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(activeTab(page)).toHaveText("Apps");
  await page.goBack();
  await expect(page).toHaveURL(/\/logs$/);
  await expect(activeTab(page)).toHaveText("Logs");
});

test("logo links to the dashboard", async ({ page }) => {
  await page.goto("/cron");
  await page.getByRole("link", { name: "PiDeck" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("/change-password redirects to /settings", async ({ page }) => {
  await page.goto("/change-password");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(activeTab(page)).toHaveText("Settings");
});

test("unknown tab redirects to /dashboard", async ({ page }) => {
  await page.goto("/nope");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("/ goes to the dashboard when signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("signed-out deep link goes to /login", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "X-Forwarded-Proto": "https" } });
  const page = await ctx.newPage();
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});

// E9: each tab's queries poll only while it is shown.
test("leaving the dashboard stops widget polling", async ({ page }) => {
  test.slow();
  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  await page.getByRole("link", { name: "Cron", exact: true }).click();
  await expect(page).toHaveURL(/\/cron$/);

  const seen: string[] = [];
  page.on("request", (r) => seen.push(new URL(r.url()).pathname));
  await page.waitForTimeout(12_000); // > docker/pm2 (10s) and most metric intervals
  const offTab = seen.filter((p) => /^\/api\/(docker|pm2|system\/history|metrics)\//.test(p) || p === "/api/system/history" || p === "/api/history");
  expect(offTab).toEqual([]);
});
