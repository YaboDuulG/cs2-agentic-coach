import { expect, test } from "@playwright/test";

// Security behavior of the Steam OpenID routes for a signed-OUT browser:
// both must bounce to home, never start (or complete) a link for nobody.

// "Home" on whatever host the suite targets (demo-sage.me, the vercel.app
// alias, or a local dev server), with or without a trailing slash.
function homeUrl(): RegExp {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "https://demo-sage.me";
  const host = new URL(base).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https?://${host}/?$`);
}

test("steam login route requires a session", async ({ page }) => {
  await page.goto("/api/steam/login");
  // Signed out → redirected home, NOT to steamcommunity.com.
  await expect(page).not.toHaveURL(/steamcommunity\.com/);
  await expect(page).toHaveURL(homeUrl());
});

test("steam callback rejects an unauthenticated forged assertion", async ({ page }) => {
  await page.goto(
    "/api/steam/callback?openid.claimed_id=" +
      encodeURIComponent("https://steamcommunity.com/openid/id/76561198000000001"),
  );
  await expect(page).not.toHaveURL(/steam=linked/);
  await expect(page).toHaveURL(homeUrl());
});

test("steam callback with a malformed claimed_id never links", async ({ request }) => {
  // Even WITH a session this would fail (claimed_id regex); without one it
  // must redirect away. Assert no route ever answers with steam=linked.
  const resp = await request.get(
    "/api/steam/callback?openid.claimed_id=https%3A%2F%2Fevil.example%2Fopenid%2Fid%2F76561198000000001",
    { maxRedirects: 0 },
  );
  expect([302, 303, 307, 308]).toContain(resp.status());
  expect(resp.headers()["location"] ?? "").not.toContain("steam=linked");
});
