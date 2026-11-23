// Public landing page on "/" for signed-out visitors (2.13): renders same-origin only, with no
// CSP violations or console errors, in both themes and at phone width; Sign in goes to /login.
// The signed-in "/" → /dashboard redirect is covered in navigation.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function signedOut(browser: Browser, opts: { width?: number; height?: number; scheme?: "light" | "dark" } = {}) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.scheme ?? "light",
  });
  const page = await ctx.newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("request", (r) => requests.push(r.url()));
  const foreign = () => {
    const origin = new URL(page.url()).origin;
    return requests.filter((u) => !u.startsWith("data:") && new URL(u).origin !== origin);
  };
  return { ctx, page, problems, foreign };
}

async function cspViolations(page: Page) {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

test("signed-out / shows the landing page, same-origin only", async ({ browser }) => {
  const { ctx, page, problems, foreign } = await signedOut(browser);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "PiDeck" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What it does" })).toBeVisible();
  await expect(page.getByTestId("landing-preview")).toBeVisible();
  await expect(page.getByTestId("landing-signin")).toBeInViewport();
  await page.waitForLoadState("networkidle");
  expect(foreign()).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test("landing Sign in opens /login, and the login title links back", async ({ browser }) => {
  const { ctx, page } = await signedOut(browser);
  await page.goto("/");
  await page.getByTestId("landing-signin").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByPlaceholder("Enter admin password")).toBeVisible();
  await page.getByRole("link", { name: "PiDeck" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("landing-preview")).toBeVisible();
  await ctx.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`landing at 390px (${scheme}): no horizontal scroll, CTA above the fold`, async ({ browser }) => {
    const { ctx, page, problems } = await signedOut(browser, { width: 390, height: 844, scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "PiDeck" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("landing-signin")).toBeInViewport();
    // axe at phone width: the install <pre> scrolls sideways here, so it must be keyboard-focusable.
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`))).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(problems).toEqual([]);
    await ctx.close();
  });
}
