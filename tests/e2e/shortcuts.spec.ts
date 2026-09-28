// Keyboard shortcuts (P3). SAFETY: only non-destructive keys are pressed; no
// shortcut can reach Update System or Reset all.
import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(process.env.HOME || os.homedir(), "logs");
const NAME = `pideck-e2e-keys-${process.pid}.log`;
const ID = `home_${NAME.replace(/[^a-zA-Z0-9]/g, "_")}`;
test.beforeAll(() => { fs.mkdirSync(LOGS_DIR, { recursive: true }); fs.writeFileSync(path.join(LOGS_DIR, NAME), "keys fixture\n"); });
test.afterAll(() => fs.rmSync(path.join(LOGS_DIR, NAME), { force: true }));

test.use({ viewport: { width: 1280, height: 900 } });

async function dashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
}

test("? opens the help sheet generated from the shortcut table; Esc closes", async ({ page }) => {
  await dashboard(page);
  await page.keyboard.press("Shift+?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  for (const label of ["Open command palette", "Go to Logs", "Pause / resume auto-refresh", "Edit layout / done (dashboard, wide screens)"]) {
    await expect(help.getByRole("cell", { name: label })).toBeVisible();
  }
  await expect(help.getByText(/update system|reset all/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("g-sequences navigate; p pauses; e toggles Edit mode; t toggles theme", async ({ page }) => {
  await dashboard(page);
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/logs$/);
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.keyboard.press("p");
  await expect(page.getByTestId("paused-badge")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByTestId("paused-badge")).toHaveCount(0);

  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();

  const before = await page.evaluate(() => document.documentElement.className);
  await page.keyboard.press("t");
  expect(await page.evaluate(() => document.documentElement.className)).not.toBe(before);
});

test("single keys are ignored while typing in the log filter; Ctrl+K still works", async ({ page }) => {
  await page.goto(`/logs?log=${encodeURIComponent(ID)}`);
  const filter = page.getByPlaceholder("Filter (grep)...");
  await expect(filter).toBeVisible();
  await filter.click();
  await page.keyboard.type("gd?pet");
  await expect(filter).toHaveValue("gd?pet");
  await expect(page).toHaveURL(/\/logs$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("paused-badge")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("keys are ignored while a dialog is open", async ({ page }) => {
  await dashboard(page);
  await page.getByTestId("update-system").click(); // opens the confirm; nothing is sent (fixture aborts POSTs)
  await expect(page.getByRole("dialog", { name: "Update system?" })).toBeVisible();
  await page.keyboard.press("p");
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("paused-badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
});
