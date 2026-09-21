import { defineConfig, devices } from "@playwright/test";

// E2E runs against a separate build on :5017 (5007 is PiTasker) (scripts/e2e-server.sh), never prod.
// X-Forwarded-Proto mimics nginx so the `secure` session cookie is issued.
const PORT = Number(process.env.E2E_PORT || 5017);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: ".e2e/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
