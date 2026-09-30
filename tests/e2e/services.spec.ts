// Services (2.8): read-only systemd units on the hub and e2e-agent, from the
// fake systemctl that scripts/e2e-server.sh puts first on their PATH
// (tests/e2e/fake-systemctl.sh; it logs every argv it was called with).
//   hub:       PIDECK_SERVICES=nginx,ssh
//   e2e-agent: pideck-agent,nginx,wg-quick@wg-pideck,Typo=typo-unit,vnstat,user:syncthing
//   both:      pkgctl-HyperBackup-ED.service failed (unlisted)
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const CALLS = path.resolve(import.meta.dirname, "../../.e2e/fake-systemctl.log");
const units = (page: Page) => page.getByTestId("services-table").locator("tr[data-unit]");
const absentStubs = async (page: Page, host: string) => {
  await page.route((u) => u.pathname === `/api/hosts/${host}/docker/containers`, (r) => r.fulfill({ json: { containers: [], warning: "docker_unavailable" } }));
  await page.route((u) => u.pathname === `/api/hosts/${host}/pm2/processes`, (r) => r.fulfill({ json: { available: false, reason: "not-installed", message: "pm2 isn't running on this host." } }));
};

test("hub Apps tab: listed units and an unlisted failed one first", async ({ page }) => {
  await page.goto("/apps");
  const card = page.getByTestId("services-card");
  await expect(card).toBeVisible();
  await expect(units(page)).toHaveCount(3);
  await expect(units(page).first()).toHaveAttribute("data-unit", "pkgctl-HyperBackup-ED.service");
  await expect(units(page).first()).toContainText("not listed");
  await expect(page.getByTestId("services-count")).toHaveText("2/2 ok");
  await expect(card).toContainText("systemd 259 · read-only");
});

test("remote Apps tab: health order, user badge, active (exited), not found, Logs link; Docker/pm2 collapsed", async ({ page }) => {
  await absentStubs(page, "e2e-agent");
  await page.goto("/h/e2e-agent/apps");
  await expect(units(page)).toHaveCount(7);
  const order = await units(page).evaluateAll((rows) => rows.map((r) => `${r.getAttribute("data-unit")}:${r.getAttribute("data-health")}`));
  expect(order.slice(0, 3)).toEqual(["typo-unit:fail", "pkgctl-HyperBackup-ED.service:fail", "vnstat:warn"]);
  const row = (u: string) => page.locator(`tr[data-unit="${u}"]`);
  await expect(row("typo-unit")).toContainText("Typo");
  await expect(row("typo-unit")).toContainText("unit not found");
  await expect(row("wg-quick@wg-pideck")).toContainText("active (exited)");
  await expect(row("syncthing")).toContainText("user");
  await expect(page.getByTestId("services-count")).toHaveText("4/6 ok");
  await expect(page.getByTestId("docker-absent")).toContainText("No Docker on this host");
  await expect(page.getByTestId("pm2-absent")).toContainText("No pm2 on this host");
  await expect(page.getByRole("heading", { name: "Docker Containers" })).toHaveCount(0);

  // Filter, then the Logs link opens the unit's journal source in the host's Logs tab.
  await page.getByLabel("Filter services").fill("nginx");
  await expect(units(page)).toHaveCount(1);
  await page.getByRole("link", { name: "Logs of nginx" }).click();
  await expect(page).toHaveURL(/\/h\/e2e-agent\/logs$/);
  await expect(page.getByTestId("remote-log-title")).toContainText("nginx");
});

test("All hosts: services chip per host, opening the Apps tab", async ({ page }) => {
  await page.goto("/hosts");
  const chip = page.getByTestId("services-chip-local");
  await expect(chip).toHaveText("Services: 1 failed: pkgctl-HyperBackup-ED.service");
  await expect(chip).toHaveAttribute("data-tone", "fail");
  await chip.click();
  await expect(page).toHaveURL(/\/apps$/);
});

test("an agent older than 2.8: 'update the agent', no request", async ({ page }) => {
  await page.route((u) => u.pathname === "/api/hosts", async (route) => {
    const hosts = await (await route.fetch()).json();
    for (const h of hosts) if (h.id === "e2e-agent") h.services = false;
    return route.fulfill({ json: hosts });
  });
  const asked: string[] = [];
  page.on("request", (r) => /\/api\/.*services/.test(new URL(r.url()).pathname) && asked.push(r.url()));
  await page.goto("/h/e2e-agent/apps");
  await expect(page.getByTestId("services-update-agent")).toBeVisible();
  expect(asked).toEqual([]);
});

test("the API: proxied, no parameters; systemctl was only ever asked read-only questions", async ({ page }) => {
  const res = await page.request.get("/api/hosts/e2e-agent/services");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ available: true, systemd: "259" });
  expect((await page.request.get("/api/hosts/e2e-agent/services?unit=nginx")).status()).toBe(400);
  expect((await page.request.get("/api/services")).status()).toBe(200);
  const calls = fs.readFileSync(CALLS, "utf8").split("\n").filter(Boolean);
  expect(calls.length).toBeGreaterThan(0);
  const PROPS = "-p Id -p Description -p LoadState -p ActiveState -p SubState -p UnitFileState -p Type -p Result -p MainPID -p NRestarts -p MemoryCurrent -p ActiveEnterTimestampMonotonic -p StateChangeTimestampMonotonic";
  const allowed = [
    /^show --no-pager -p Version$/,
    /^(--user )?list-units --state=failed --plain --no-legend --no-pager$/,
    new RegExp(`^(--user )?show --no-pager ${PROPS} -- [A-Za-z0-9@._:-]+( [A-Za-z0-9@._:-]+)*$`),
  ];
  for (const c of calls) expect(allowed.some((re) => re.test(c)), c).toBe(true);
});
