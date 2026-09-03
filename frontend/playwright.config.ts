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
      testIgnore: [/auth\.setup\.ts/, /upload\.spec\.ts/],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testIgnore: [/auth\.setup\.ts/, /upload\.spec\.ts/],
    },
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pipeline",
      testMatch: /upload\.spec\.ts/,
      dependencies: ["setup"],
      retries: 0, // an upload retry would double-spend the fresh user's quota
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
});
