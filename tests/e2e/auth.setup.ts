import fs from "fs";
import { expect, test as setup } from "@playwright/test";

// Logs in once with the throwaway password from .e2e/password (never the real
// admin password) and stores the session for all specs.
setup("login", async ({ page }) => {
  const password = fs.readFileSync(".e2e/password", "utf8").trim();
  await page.goto("/login");
  await page.getByPlaceholder("Enter admin password").fill(password);
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("PiDeck").first()).toBeVisible();
  await page.context().storageState({ path: ".e2e/state.json" });
});
