import { defineConfig, devices } from "@playwright/test";
import path from "path";

// E2E suite. Runs against the deployed app by default (no local Clerk keys
// exist); point PLAYWRIGHT_BASE_URL at localhost:3000 to test a dev server.
//
// Projects:
//   chromium / mobile — signed-out smoke + steam route security
//   setup             — signs up a fresh Clerk test user via the real UI
//                       (dev-instance +clerk_test email, code 424242)
//   pipeline          — authenticated: uploads a real .dem end-to-end
//                       (set E2E_DEMO_PATH; skipped when absent)
const STORAGE_STATE = path.join(__dirname, "playwright/.clerk/user.json");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global.setup.ts",
  timeout: 30_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://cs2-agentic-coach.vercel.app",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/auth\.setup\.ts/, /upload\.spec\.ts/, /-shots?\.spec\.ts/, /checkout\.spec\.ts/],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testIgnore: [/auth\.setup\.ts/, /upload\.spec\.ts/, /-shots?\.spec\.ts/, /checkout\.spec\.ts/],
    },
    // Stripe test-mode purchase flow with the saved session (run on demand).
    {
      name: "checkout",
      testMatch: /checkout\.spec\.ts/,
      dependencies: ["setup"],
      retries: 0,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    // Signed-in design-review captures at the two review widths.
    {
      name: "shots",
      testMatch: [/signed-in-shots\.spec\.ts/, /debrief-shot\.spec\.ts/],
      dependencies: ["setup"],
      retries: 0,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
    },
    {
      name: "team-shots",
      testMatch: /team-hub-shots\.spec\.ts/,
      dependencies: ["setup"],
      retries: 0,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
    },
    {
      name: "team-shots-mobile",
      testMatch: /team-hub-shots\.spec\.ts/,
      dependencies: ["setup"],
      retries: 0,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: STORAGE_STATE },
    },
    {
      name: "shots-mobile",
      testMatch: [/signed-in-shots\.spec\.ts/, /debrief-shot\.spec\.ts/],
      dependencies: ["setup"],
      retries: 0,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: STORAGE_STATE },
    },
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pipeline",
      testMatch: [/upload\.spec\.ts/, /debrief-shot\.spec\.ts/],
      dependencies: ["setup"],
      retries: 0, // an upload retry would double-spend the fresh user's quota
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
});
