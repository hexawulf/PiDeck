// Command palette (P3, E7, E23). SAFETY: POST /api/system/update is stubbed
// with page.route in every test that can reach it (./fixtures aborts it
// otherwise, and the E2E server runs with PIDECK_DISABLE_SYSTEM_UPDATE=1).
import fs from "fs";
import os from "os";
import path from "path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(process.env.HOME || os.homedir(), "logs");
const NAME = `pideck-e2e-palette-${process.pid}.log`;
const FILE = path.join(LOGS_DIR, NAME);
test.beforeAll(() => { fs.mkdirSync(LOGS_DIR, { recursive: true }); fs.writeFileSync(FILE, "palette fixture line\n"); });
test.afterAll(() => fs.rmSync(FILE, { force: true }));

test.use({ viewport: { width: 1280, height: 900 } });

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const input = (page: Page) => palette(page).getByRole("combobox");

async function openWithKeys(page: Page, url = "/dashboard") {
  await page.goto(url);
  await expect(page.locator("[data-widget], [data-testid='pinned-logs'], main").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(input(page)).toBeFocused();
}

async function run(page: Page, query: string) {
  await input(page).fill(query);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
}

async function stubUpdate(page: Page, status = 200) {
  const hits: string[] = [];
  await page.route("**/api/system/update", (route) => {
    hits.push(route.request().method());
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: status === 200 ? "System updated" : "System update disabled in this environment" }) });
  });
  return hits;
}

test("the palette chunk loads on first open, not with the main chunk", async ({ page }) => {
  const chunks: string[] = [];
  page.on("request", (r) => { if (/\/assets\/.*\.js$/.test(r.url())) chunks.push(new URL(r.url()).pathname); });
  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  expect(chunks.some((c) => c.includes("CommandPalette-"))).toBe(false);
  const main = chunks.find((c) => /\/index-[^/]+\.js$/.test(c))!;
  const mainJs = await (await page.request.get(main)).text();
  expect(mainJs).not.toContain("Type a command or search"); // palette UI strings live only in the lazy chunk
  expect(mainJs).not.toContain("fuzzyScore");

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  expect(chunks.some((c) => c.includes("CommandPalette-"))).toBe(true);
});

test("keyboard: Ctrl+K, arrows move the active option, Enter navigates, Esc returns focus", async ({ page }) => {
  await openWithKeys(page);
  const first = await input(page).getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  expect(await input(page).getAttribute("aria-activedescendant")).not.toBe(first);
  await expect(palette(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await run(page, "go logs");
  await expect(page).toHaveURL(/\/logs$/);

  const button = page.getByTestId("palette-button");
  await button.click();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("toggles theme and density; Edit layout on the dashboard", async ({ page }) => {
  await openWithKeys(page);
  const before = await page.evaluate(() => document.documentElement.className);
  await run(page, "theme");
  expect(await page.evaluate(() => document.documentElement.className)).not.toBe(before);

  await page.keyboard.press("Control+k");
  await run(page, "compact density");
  expect(await page.evaluate(() => document.documentElement.dataset.density)).toBe("compact");

  await page.keyboard.press("Control+k");
  await run(page, "edit dashboard layout");
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await run(page, "finish editing");
  await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();
});

test("opens a log from the logs query", async ({ page }) => {
  await openWithKeys(page);
  await run(page, "pideck e2e palette");
  await expect(page).toHaveURL(/\/logs$/);
  await expect(page.getByText("palette fixture line")).toBeVisible();
});

test("Update system → Cancel sends nothing; → Confirm sends one (stubbed) request", async ({ page }) => {
  const hits = await stubUpdate(page);
  await openWithKeys(page);
  await run(page, "update system");
  const confirm = page.getByRole("dialog", { name: "Update system?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId("palette-button")).not.toBeFocused(); // focus went back to where Ctrl+K was pressed
  expect(hits).toEqual([]);

  await page.keyboard.press("Control+k");
  await run(page, "update system");
  await page.getByRole("dialog", { name: "Update system?" }).getByRole("button", { name: "Update system" }).click();
  await expect(page.getByText("System updated successfully", { exact: true })).toBeVisible();
  expect(hits).toEqual(["POST"]);
});

for (const status of [409, 500]) {
  test(`palette Update system → ${status} shows the error toast`, async ({ page }) => {
    const hits = await stubUpdate(page, status);
    await openWithKeys(page);
    await run(page, "update system");
    await page.getByRole("dialog", { name: "Update system?" }).getByRole("button", { name: "Update system" }).click();
    await expect(page.getByText("Failed to update system", { exact: true })).toBeVisible();
    expect(hits).toEqual(["POST"]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`axe: palette and help sheet have no serious findings (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("pideck-ui-theme", t), theme);
    await openWithKeys(page);
    await page.keyboard.press("ArrowDown");
    const serious = async () =>
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`));
    expect(await serious()).toEqual([]);
    await run(page, "keyboard shortcuts");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(await serious()).toEqual([]);
  });
}

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("header button opens the palette; no Edit action; no horizontal scroll", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("[data-widget]").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId("palette-button").click();
    await expect(input(page)).toBeFocused();
    await input(page).fill("edit");
    await expect(palette(page).getByRole("option", { name: /Edit dashboard layout/ })).toHaveCount(0);
    await run(page, "go settings");
    await expect(page).toHaveURL(/\/settings$/);
  });
});
