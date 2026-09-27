// A failing or misbehaving endpoint only ever breaks its own card.
// SAFETY: read-only; responses are stubbed with page.route.
import { expect, test } from "./fixtures";

const DATA_ENDPOINTS = /\/api\/(system\/(info|history)|metrics\/.*)$/;

test("every widget endpoint 500 → every data card shows an error, shell still works", async ({ page }) => {
  await page.route((url) => DATA_ENDPOINTS.test(url.pathname), (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"stubbed failure"}' }));
  await page.goto("/dashboard");

  const cards = page.locator("[data-widget]:not([data-widget='quick-actions'])");
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThan(10);
  for (let i = 0; i < n; i++) {
    await expect(cards.nth(i).getByRole("alert")).toBeVisible();
  }
  await expect(page.getByText("stubbed failure").first()).toBeAttached(); // raw body in details

  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await expect(page).toHaveURL(/\/logs$/);
});

test("malformed response → 'Unexpected data' on that card only", async ({ page }) => {
  await page.route("**/api/metrics/ram", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"total":"lots"}' }));
  await page.goto("/dashboard");
  const ram = page.locator("[data-widget='ram']");
  await expect(ram.getByText("Unexpected data from the server")).toBeVisible();
  await expect(page.locator("[data-widget='cpu'] [role='alert']")).toHaveCount(0);
});

test("phone width stacks cards in one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const cards = page.locator("[data-widget]");
  await expect(cards.first()).toBeVisible();
  const xs = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
