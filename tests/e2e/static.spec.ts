// PD-12 (security headers), PD-13 (asset caching, Firebase out of the entry
// bundle) and PD-14 (unknown /api path is a JSON 404) on the real hub build.
import { expect, test } from "./fixtures";

test("page, assets and unknown API paths get the right headers", async ({ page }) => {
  const api = page.request;

  const home = await api.get("/");
  expect(home.status()).toBe(200);
  const h = home.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  expect(h["cache-control"]).toBe("no-cache");
  // HSTS follows the Secure cookie: the E2E build runs as production without
  // PIDECK_INSECURE_HTTP, so it is sent (browsers ignore it over plain HTTP).
  expect(h["strict-transport-security"]).toBe("max-age=15552000");

  const entry = (await home.text()).match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(entry, "entry script in index.html").toBeTruthy();
  const js = await api.get(entry!);
  expect(js.status()).toBe(200);
  expect(js.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(await js.text(), "Firebase SDK is not in the entry bundle").not.toContain("identitytoolkit.googleapis.com");

  expect((await api.get("/assets/does-not-exist-0000.js")).status()).toBe(404);

  const unknown = await api.get("/api/does-not-exist");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["content-type"]).toMatch(/^application\/json/);

  // A browser navigation to a client route gets the page (API-style callers of
  // /logs get the back-compat stub, server/routes/compat.ts).
  const deep = await api.get("/logs", { headers: { accept: "text/html" } });
  expect(deep.status()).toBe(200);
  expect(await deep.text()).toContain('<div id="root">');
});
