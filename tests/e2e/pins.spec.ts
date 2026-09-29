// Log pins + saved filters (P3). SAFETY: read-only GETs; the only write is a
// small fixture log in the server's logs dir, removed afterwards.
import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LOGS_DIR = process.env.PIDECK_LOGS_DIR || path.join(process.env.HOME || os.homedir(), "logs");
const NAME = `pideck-e2e-pins-${process.pid}.log`;
const FILE = path.join(LOGS_DIR, NAME);
const ID = `home_${NAME.replace(/[^a-zA-Z0-9]/g, "_")}`;

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeAll(() => {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(FILE, "boot ok\nError: disk full\nall good\n");
});
test.afterAll(() => fs.rmSync(FILE, { force: true }));

const pinned = (page: Page) => page.getByTestId("pinned-logs").getByRole("listitem");
const savedPins = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("pideck:prefs:v1") ?? "{}").pins ?? []);

async function openFixture(page: Page) {
  await page.goto(`/logs?log=${encodeURIComponent(ID)}`);
  await expect(page.getByText("Error: disk full")).toBeVisible();
  await expect(page).toHaveURL(/\/logs$/); // deep link consumed
}

test("pin a log, reload, pin persists and opens the log", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Pin log", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpin log", exact: true })).toBeVisible();
  await expect(pinned(page)).toHaveCount(1);
  expect(await savedPins(page)).toEqual([{ logId: ID, label: expect.any(String) }]);

  await page.reload();
  await expect(pinned(page)).toHaveCount(1);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await pinned(page).first().getByRole("button").first().click();
  await expect(page.getByText("Error: disk full")).toBeVisible();
});

test("download (left of the pin) saves the lines shown", async ({ page }) => {
  await openFixture(page);
  const dl = page.getByTestId("log-download");
  await expect(dl.locator("xpath=following-sibling::button[1]")).toHaveAccessibleName("Pin log");
  const [file] = await Promise.all([page.waitForEvent("download"), dl.click()]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`-${ID}-\\d{8}-\\d{4}\\.log$`.toLowerCase()));
  expect(fs.readFileSync((await file.path())!, "utf8")).toBe("boot ok\nError: disk full\nall good\n");
});

test("pin with a filter re-applies the filter", async ({ page }) => {
  await openFixture(page);
  await page.getByPlaceholder("Filter (grep)...").fill("disk");
  await page.getByRole("button", { name: "Pin log with this filter" }).click();
  expect(await savedPins(page)).toEqual([expect.objectContaining({ logId: ID, grep: "disk" })]);

  await page.reload();
  await pinned(page).first().getByRole("button").first().click();
  await expect(page.getByPlaceholder("Filter (grep)...")).toHaveValue("disk");
  await expect(page.getByText("Error: disk full")).toBeVisible();
  await expect(page.getByText("boot ok")).toHaveCount(0);
});

test("a pin whose file is gone (404) is greyed out and stays", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Pin log", exact: true }).click();
  await page.route(`**/api/hostlogs/${ID}?**`, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"message":"Log file is no longer available"}' }));
  await pinned(page).first().getByRole("button").first().click();
  const item = pinned(page).first();
  await expect(item).toHaveAttribute("data-stale", "true");
  await expect(item.getByText("file no longer available")).toBeVisible();
  await expect(pinned(page)).toHaveCount(1); // still listed
  expect(await savedPins(page)).toHaveLength(1);

  await item.getByRole("button", { name: /^Unpin / }).click();
  await expect(page.getByTestId("pinned-logs")).toHaveCount(0);
});
