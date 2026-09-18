import { defineConfig } from "@playwright/test";
import "dotenv/config";

// Tests run against the real deployment, so they exercise nginx as well as the
// app — which is the point for the 403 and the security headers.
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.AUTH_URL ?? "https://ops.rfsupplements.com",
  },
});
