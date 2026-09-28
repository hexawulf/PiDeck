// ConfirmDialog (E7). SAFETY: POST /api/system/update is always stubbed with
// page.route here (and ./fixtures would abort it anyway); the E2E server also
// runs with PIDECK_DISABLE_SYSTEM_UPDATE=1.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.use({ viewport: { width: 1280, height: 900 } });

/** Stub the update endpoint; returns the list of requests that reached the stub. */
async function stubUpdate(page: Page, status = 200, body = { message: "System updated", output: "" }) {
  const hits: string[] = [];
  await page.route("**/api/system/update", (route) => {
    hits.push(route.request().method());
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return hits;
}

async function openQuickActionsConfirm(page: Page) {
  await page.goto("/dashboard");
  const tile = page.getByTestId("update-system");
  await expect(tile).toBeVisible();
  await tile.click();
  const dialog = page.getByRole("dialog", { name: "Update system?" });
  await expect(dialog).toBeVisible();
  return { tile, dialog };
}

test("Quick Actions › Update System asks first; Cancel/Esc send nothing and return focus", async ({ page }) => {
  const hits = await stubUpdate(page);
  const { tile, dialog } = await openQuickActionsConfirm(page);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(tile).toBeFocused();

  await tile.click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(hits).toEqual([]);
});

test("Quick Actions › Update System → Confirm sends one request, success toast", async ({ page }) => {
  const hits = await stubUpdate(page);
  const { dialog } = await openQuickActionsConfirm(page);
  await dialog.getByRole("button", { name: "Update system" }).click();
  await expect(page.getByText("System updated successfully", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(hits).toEqual(["POST"]);
});

for (const [status, label] of [[409, "disabled"], [500, "server error"]] as const) {
  test(`Update System ${status} (${label}) → "Failed to update system" toast`, async ({ page }) => {
    const hits = await stubUpdate(page, status, { message: "System update disabled in this environment" });
    const { dialog } = await openQuickActionsConfirm(page);
    await dialog.getByRole("button", { name: "Update system" }).click();
    await expect(page.getByText("Failed to update system", { exact: true })).toBeVisible();
    expect(hits).toEqual(["POST"]);
  });
}

test("Settings › Reset all uses the ConfirmDialog (focus on Cancel)", async ({ page }) => {
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: "Reset all" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Reset all dashboard preferences?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
