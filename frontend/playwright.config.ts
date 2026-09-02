import { defineConfig, devices } from "@playwright/test";

// E2E smoke suite. Runs against the deployed app by default (no local Clerk
// keys exist); point PLAYWRIGHT_BASE_URL at localhost:3000 to test a dev
// server instead. Everything in e2e/ must work WITHOUT an authenticated
// session — auth'd flows are exercised manually until Clerk testing tokens
// are wired up.
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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
