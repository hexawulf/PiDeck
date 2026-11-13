// About › Diagnostics (P3). SAFETY: read-only; only prefs controls are used.
import { expect, test } from "./fixtures";

test.use({ viewport: { width: 1280, height: 900 } });

test("Diagnostics line reflects prefs and copies to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/dashboard");
  await expect(page.locator("[data-widget]").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Hide CPU Frequency" }).click();
  await page.getByRole("button", { name: "Reset layout" }).click();
  await page.getByRole("button", { name: "Hide Swap" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Pause auto-refresh" }).click();

  await page.getByRole("button", { name: "About PiDeck" }).click();
  const line = page.getByTestId("diagnostics-line");
  await expect(line).toContainText(/^PiDeck v\d+\.\d+\.\d+ · prefs v2 · widgets 19\/20 visible · refresh live \(paused\) · density comfortable · last prefs reset: Reset layout at \d{4}-/);

  // The version links to its GitHub release tag, and the date is a real one.
  const version = page.getByTestId("about-version");
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/);
  expect(await version.getAttribute("href")).toBe(`https://github.com/hexawulf/PiDeck/releases/tag/${await version.textContent()}`);
  await expect(page.getByTestId("about-release-date")).toHaveText(/^Release Date: \d{1,2} [A-Z][a-z]+ \d{4}$/);

  await page.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(page.getByText("Diagnostics copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await line.textContent());
});
