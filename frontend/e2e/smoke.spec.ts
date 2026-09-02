import { expect, test } from "@playwright/test";

// Unauthenticated user journey: landing → pricing (/billing) → sign-in modal.

test("landing page renders hero and navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page).toHaveTitle(/DemoSage|CS2/i);

  // Pricing must be reachable signed-out on EVERY viewport — phones included.
  await expect(page.getByRole("link", { name: /pricing/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /sign up/i }).first()).toBeVisible();

  expect(errors, `uncaught page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("pricing lives at /billing and shows the three tiers signed-out", async ({ page }) => {
  await page.goto("/billing");
  // Tier cards render as headings; loose getByText can match hidden nodes.
  await expect(page.getByRole("heading", { name: /^free$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /pro/i }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /team/i }).first()).toBeVisible();
  // The signed-out wall must stay gone: no Clerk sign-in form on this page.
  await expect(page.getByText(/sign in to demosage/i)).toHaveCount(0);
});

test("/pricing does not 404 on a typed URL", async ({ page }) => {
  // The navbar labels the page "Pricing" — users WILL type /pricing.
  const resp = await page.goto("/pricing");
  expect(resp?.status(), "expected /pricing to redirect to /billing").toBeLessThan(400);
  await expect(page).toHaveURL(/\/billing/);
});

test("log in opens the Clerk sign-in dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /log in/i }).first().click();
  await expect(page.getByText(/sign in to demosage/i)).toBeVisible({ timeout: 10_000 });
});
