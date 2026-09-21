// Theme E2E. SAFETY: only tab buttons and the theme toggle are ever clicked —
// never restart/stop/reboot/update controls.
//
//  no-flash ─ bundle blocked → only the inline script can set <html class>
//  toggle   ─ click → class + storage flip → reload persists
//  system   ─ OS change while "system" → class follows
//  pages    ─ every page × theme: axe AA contrast, screenshot, no CSP violation
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const KEY = "pideck-ui-theme";
const TABS = ["Dashboard", "Logs", "Apps", "Cron", "Settings"] as const;

async function seedTheme(page: Page, value: string | null, throwOnRead = false) {
  await page.addInitScript(([key, v, t]) => {
    if (t) {
      Storage.prototype.getItem = () => { throw new Error("blocked"); };
      return;
    }
    if (v === null) localStorage.removeItem(key as string);
    else localStorage.setItem(key as string, v as string);
  }, [KEY, value, throwOnRead] as const);
}

async function collectCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

const htmlClass = (page: Page) => page.evaluate(() => document.documentElement.className);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("no-flash script (React bundle blocked)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const cases: [string | null, "light" | "dark", string][] = [
    ["light", "dark", "light"], ["dark", "light", "dark"],
    ["system", "dark", "dark"], ["system", "light", "light"],
    [null, "dark", "dark"], [null, "light", "light"],
  ];
  for (const [stored, os, expected] of cases) {
    test(`stored=${stored} os=${os} → ${expected}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await seedTheme(page, stored);
      await page.route("**/assets/*.js", (r) => r.abort());
      await page.goto("/login");
      expect(await htmlClass(page)).toBe(expected);
    });
  }

  test("localStorage throwing falls back to the OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedTheme(page, null, true);
    await page.route("**/assets/*.js", (r) => r.abort());
    await page.goto("/login");
    expect(await htmlClass(page)).toBe("dark");
  });
});

test.describe("toggle", () => {
  for (const path of ["/login", "/dashboard", "/change-password"]) {
    test(`flips and persists on ${path}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(path);
      const toggle = page.getByTestId("theme-toggle");
      await expect(toggle).toBeVisible();
      const before = await htmlClass(page);
      const bgBefore = await bodyBg(page);
      await toggle.click();
      const after = await htmlClass(page);
      expect(after).not.toBe(before);
      expect(await bodyBg(page)).not.toBe(bgBefore);
      expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(after);
      await page.reload();
      expect(await htmlClass(page)).toBe(after);
    });
  }
});

test("follows OS changes while on system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await seedTheme(page, "system");
  await page.goto("/dashboard");
  expect(await htmlClass(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => htmlClass(page)).toBe("dark");
});

test("CSP header is served with the inline-script hash", async ({ request }) => {
  const res = await request.get("/login");
  const csp = res.headers()["content-security-policy-report-only"] ?? res.headers()["content-security-policy"];
  expect(csp).toBeTruthy();
  expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await collectCspViolations(page);
      await seedTheme(page, theme);
    });

    async function audit(page: Page, name: string) {
      expect(await htmlClass(page)).toBe(theme);
      await page.screenshot({ path: `test-results/screens/${theme}-${name}.png`, fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const contrast = axe.violations.filter((v) => v.id === "color-contrast");
      expect(contrast.flatMap((v) => v.nodes.map((n) => `${n.target} — ${n.failureSummary}`))).toEqual([]);
      expect(await page.evaluate(() => (window as any).__csp)).toEqual([]);
    }

    test("login", async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "X-Forwarded-Proto": "https" } });
      const page = await ctx.newPage();
      await collectCspViolations(page);
      await seedTheme(page, theme);
      await page.goto("/login");
      await audit(page, "login");
      await ctx.close();
    });

    test("change-password", async ({ page }) => {
      await page.goto("/change-password");
      await audit(page, "change-password");
    });

    for (const tab of TABS) {
      test(`dashboard › ${tab}`, async ({ page }) => {
        await page.goto("/dashboard");
        await page.getByRole("button", { name: tab, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await audit(page, `tab-${tab.toLowerCase()}`);
      });
    }
  });
}

test("chart strokes follow the theme", async ({ page }) => {
  const stroke = () =>
    page.locator(".recharts-area-curve").first().evaluate((el) => getComputedStyle(el).stroke);
  await seedTheme(page, "light");
  await page.goto("/dashboard");
  await expect(page.locator(".recharts-area-curve").first()).toBeVisible({ timeout: 30_000 });
  const light = await stroke();
  await page.getByTestId("theme-toggle").click();
  await expect.poll(stroke).not.toBe(light);
  expect(light).not.toMatch(/^rgb\(0, 0, 0\)$/); // var() resolved, not default black
});
