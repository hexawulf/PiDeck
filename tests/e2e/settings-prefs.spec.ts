// Settings › Dashboard: density, export/import, reset (P2). SAFETY: only
// preference controls are used; nothing is sent to the server.
import fs from "fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const KEY = "pideck:prefs:v1";
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const density = (page: Page) => page.evaluate(() => document.documentElement.dataset.density);

test.use({ viewport: { width: 1280, height: 900 } });

test("dense mode toggles and persists across reload", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Comfortable" })).toBeChecked(); // app rendered
  expect(await density(page)).toBe("comfortable");
  await page.getByRole("radio", { name: "Compact" }).check();
  expect(await density(page)).toBe("compact");

  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  const pad = await page.locator(".pi-widget-body").first().evaluate((e) => getComputedStyle(e).paddingLeft);
  expect(pad).toBe("10px"); // --pi-card-pad: 0.625rem

  await page.reload();
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  expect(await density(page)).toBe("compact");
  expect((await saved(page)).density).toBe("compact");

  await page.goto("/settings");
  await page.getByRole("radio", { name: "Comfortable" }).check();
  expect(await density(page)).toBe("comfortable");
});

test("export downloads prefs JSON without `paused`", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Pause auto-refresh" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await (await download).path();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(Object.keys(data).sort()).toEqual(["density", "hidden", "layout", "pins", "speed", "version"]);
});

test("import rejects bad files inline and keeps current prefs; accepts a good one", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Compact" }).check();
  const input = page.getByTestId("prefs-import");
  const before = await saved(page);

  await input.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.getByRole("alert")).toContainText("Not valid JSON");

  const unknownKey = { ...before, paused: true };
  await input.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(unknownKey)) });
  await expect(page.getByRole("alert")).toContainText("(root): Unrecognized key(s) in object: 'paused'");

  const badSpeed = { ...before, speed: "warp" };
  await input.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(badSpeed)) });
  await expect(page.getByRole("alert")).toContainText("speed:");

  await input.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("x".repeat(65 * 1024)) });
  await expect(page.getByRole("alert")).toContainText("larger than 64 KB");
  expect(await saved(page)).toEqual(before);

  const good = { ...before, density: "comfortable", speed: "relaxed", hidden: ["swap"] };
  await input.setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(good)) });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).speed).toBe("relaxed");
  expect(await density(page)).toBe("comfortable");
  await expect(page.getByRole("checkbox", { name: "Swap" })).not.toBeChecked();
});

test("hiding a widget in Settings removes it from the dashboard; Reset all restores", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Mounts" }).uncheck();
  await page.getByRole("radio", { name: "Slow (×5)" }).check();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  await expect(page.locator('[data-widget="mounts"]')).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset all" }).click();
  await expect.poll(async () => (await saved(page)).speed).toBe("live");
  expect((await saved(page)).hidden).toEqual([]);
  await expect(page.getByRole("checkbox", { name: "Mounts" })).toBeChecked();
});

test("Reset all asks first; Cancel changes nothing", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Compact" }).check();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Reset all" }).click();
  expect((await saved(page)).density).toBe("compact");
});

for (const theme of ["light", "dark"] as const) {
  test(`settings: no serious axe findings (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("pideck-ui-theme", t), theme);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const v = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
      .filter((x) => x.impact === "serious" || x.impact === "critical")
      .flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target}`));
    expect(v).toEqual([]);
  });
}
