// Shared E2E fixture. SAFETY (E15): any request that could change the host —
// system update, docker/pm2 actions, running a cron job — is aborted and fails
// the test. Read-only GETs (e.g. listing containers) pass through.
import { test as base, expect } from "@playwright/test";

const DESTRUCTIVE = [/\/api\/system\/update\b/, /\/api\/docker\//, /\/api\/pm2\//, /\/api\/cron\/run\b/];

export const test = base.extend<{ destructiveGuard: void }>({
  destructiveGuard: [
    async ({ page }, use) => {
      const attempts: string[] = [];
      await page.route(
        (url) => DESTRUCTIVE.some((re) => re.test(url.pathname)),
        (route) => {
          const req = route.request();
          if (req.method() === "GET") return route.continue();
          attempts.push(`${req.method()} ${new URL(req.url()).pathname}`);
          return route.abort("blockedbyclient");
        },
      );
      await use();
      expect(attempts, "test attempted a destructive request").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
