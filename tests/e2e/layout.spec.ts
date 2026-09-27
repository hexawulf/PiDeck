// Dashboard layout (P2: D1–D3, E4, E16). SAFETY: only layout controls are
// clicked (edit toggle, drag handles, move/hide buttons, checkboxes, reset);
// ./fixtures aborts any destructive request.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const KEY = "pideck:prefs:v1";

/** Seed prefs once per tab (addInitScript also runs on reload, which must see what the app saved). */
async function seedPrefs(page: Page, value: string) {
  await page.addInitScript(([key, v]) => {
    if (sessionStorage.getItem("__seeded")) return;
    localStorage.setItem(key, v);
    sessionStorage.setItem("__seeded", "1");
  }, [KEY, value] as const);
}

/** Card ids in visual reading order (top, then left) — order, not pixels. */
async function cardOrder(page: Page): Promise<string[]> {
  return page.locator("[data-widget]").evaluateAll((els) =>
    els
      .map((e) => ({ id: (e as HTMLElement).dataset.widget!, r: e.getBoundingClientRect() }))
      .sort((a, b) => Math.round(a.r.top) - Math.round(b.r.top) || a.r.left - b.r.left)
      .map((c) => c.id),
  );
}

const savedPrefs = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const editToggle = (page: Page) => page.getByRole("button", { name: /^(Edit layout|Done)$/ });

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-grid")).toBeVisible();
  await expect(page.locator("[data-widget]").first()).toBeVisible();
}

test.describe("desktop grid", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("default order follows the registry, locked by default", async ({ page }) => {
    await openDashboard(page);
    expect((await cardOrder(page)).slice(0, 4)).toEqual(["cpu", "memory", "temperature", "network"]);
    await expect(page.locator(".react-resizable-handle")).toHaveCount(0);
    await expect(page.locator(".pi-drag-handle")).toHaveCount(0);
  });

  test("seeded layout is applied and persists across reload", async ({ page }) => {
    await seedPrefs(page, JSON.stringify({
      version: 1,
      layout: [{ i: "firewall", x: 0, y: 0, w: 4, h: 8 }, { i: "cpu", x: 4, y: 0, w: 3, h: 4 }],
      hidden: ["nvme"],
    }));
    await openDashboard(page);
    const order = await cardOrder(page);
    expect(order.slice(0, 2)).toEqual(["firewall", "cpu"]);
    expect(order).not.toContain("nvme");
    await page.reload();
    await expect(page.locator("[data-widget]").first()).toBeVisible();
    expect((await cardOrder(page)).slice(0, 2)).toEqual(["firewall", "cpu"]);
  });

  test("real mouse drag by the handle reorders and persists", async ({ page }) => {
    await openDashboard(page);
    await editToggle(page).click();
    const handle = page.getByTestId("drag-cpu");
    const target = page.locator('[data-widget="temperature"]');
    const h = (await handle.boundingBox())!;
    const t = (await target.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width * 0.75, t.y + 20, { steps: 20 });
    await page.mouse.move(t.x + t.width * 0.8, t.y + 24, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => (await cardOrder(page)).indexOf("cpu")).toBeGreaterThan(0);
    const after = await cardOrder(page);
    expect(after.indexOf("cpu")).toBeGreaterThan(after.indexOf("memory"));
    const saved = await savedPrefs(page);
    expect(saved.layout.find((l: { i: string }) => l.i === "cpu").x).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator("[data-widget]").first()).toBeVisible();
    expect((await cardOrder(page)).slice(0, 4)).toEqual(after.slice(0, 4));
  });

  test("keyboard: Move down/up keeps focus on the pressed button", async ({ page }) => {
    await openDashboard(page);
    await editToggle(page).click();
    const down = page.getByRole("button", { name: "Move CPU Usage down" });
    await down.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await cardOrder(page)).slice(0, 2)).toEqual(["memory", "cpu"]);
    await expect(down).toBeFocused();
    await page.keyboard.press("Tab"); // → Hide
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab"); // → Move up
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await cardOrder(page)).slice(0, 2)).toEqual(["cpu", "memory"]);
  });

  test("Esc and Done leave Edit mode", async ({ page }) => {
    await openDashboard(page);
    await editToggle(page).click();
    await expect(page.locator(".pi-drag-handle").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pi-drag-handle")).toHaveCount(0);
    await expect(editToggle(page)).toHaveText("Edit layout");
    await editToggle(page).click();
    await expect(page.locator(".react-resizable-handle").first()).toBeAttached();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".react-resizable-handle")).toHaveCount(0);
  });

  test("Reset layout restores the default order and shows hidden cards", async ({ page }) => {
    await seedPrefs(page, JSON.stringify({ version: 1, layout: [{ i: "mounts", x: 0, y: 0, w: 6, h: 8 }], hidden: ["cpu"] }));
    await openDashboard(page);
    expect((await cardOrder(page))[0]).toBe("mounts");
    await editToggle(page).click();
    await page.getByRole("button", { name: "Reset layout" }).click();
    await expect.poll(async () => (await cardOrder(page)).slice(0, 4)).toEqual(["cpu", "memory", "temperature", "network"]);
    expect((await savedPrefs(page)).hidden).toEqual([]);
  });

  test("hidden widget stops polling; shown again it polls again", async ({ page }) => {
    test.slow();
    await openDashboard(page);
    await editToggle(page).click();
    await page.getByRole("button", { name: "Hide CPU Frequency" }).click();
    await expect(page.locator('[data-widget="cpu-freq"]')).toHaveCount(0);

    const hits: number[] = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/metrics/cpu-freq") hits.push(Date.now()); });
    await page.waitForTimeout(15_000); // base interval 5s → would be ~3 requests
    expect(hits).toEqual([]);

    await page.getByRole("checkbox", { name: "CPU Frequency" }).check();
    await expect(page.locator('[data-widget="cpu-freq"]')).toBeVisible();
    await expect.poll(() => hits.length, { timeout: 12_000 }).toBeGreaterThanOrEqual(2); // mount fetch + a poll
    expect((await savedPrefs(page)).hidden).toEqual([]);
  });

  test("corrupt localStorage → dashboard renders, toast, .bad backup", async ({ page }) => {
    await seedPrefs(page, "{definitely not json");
    await openDashboard(page);
    await expect(page.getByText("Saved layout was invalid – reset to default", { exact: true })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(`${k}.bad`), KEY)).toBe("{definitely not json");
    expect((await cardOrder(page))[0]).toBe("cpu");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: no serious findings in view and edit mode (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pideck-ui-theme", t), theme);
      await openDashboard(page);
      await page.waitForLoadState("networkidle");
      const serious = async () =>
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`));
      expect(await serious()).toEqual([]);
      await editToggle(page).click();
      await expect(page.locator(".pi-drag-handle").first()).toBeVisible();
      // Not fullPage: that resizes the viewport, which briefly drops below md and ends Edit mode.
      await page.screenshot({ path: `test-results/screens/${theme}-dashboard-edit.png` });
      expect(await serious()).toEqual([]);
    });
  }
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacked, no grid, no resize handles, no Edit toggle", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-stack")).toBeVisible();
    await expect(page.getByTestId("dashboard-grid")).toHaveCount(0);
    await expect(page.locator(".react-resizable-handle, .pi-drag-handle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit layout" })).toHaveCount(0);
    const xs = await page.locator("[data-widget]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
  });

  test("stack follows the saved order", async ({ page }) => {
    await seedPrefs(page, JSON.stringify({ version: 1, layout: [{ i: "swap", x: 0, y: 0, w: 4, h: 4 }], hidden: [] }));
    await page.goto("/dashboard");
    await expect(page.locator("[data-widget]").first()).toHaveAttribute("data-widget", "swap");
  });
});
