import { expect, test } from "@playwright/test";

// Security behavior of the Steam OpenID routes for a signed-OUT browser:
// both must bounce to home, never start (or complete) a link for nobody.

test("steam login route requires a session", async ({ page }) => {
  await page.goto("/api/steam/login");
  // Signed out → redirected home, NOT to steamcommunity.com.
  await expect(page).not.toHaveURL(/steamcommunity\.com/);
  await expect(page).toHaveURL(/cs2-agentic-coach\.vercel\.app\/?$|localhost:\d+\/?$/);
});

test("steam callback rejects an unauthenticated forged assertion", async ({ page }) => {
  await page.goto(
    "/api/steam/callback?openid.claimed_id=" +
      encodeURIComponent("https://steamcommunity.com/openid/id/76561198000000001"),
  );
  await expect(page).not.toHaveURL(/steam=linked/);
  await expect(page).toHaveURL(/cs2-agentic-coach\.vercel\.app\/?$|localhost:\d+\/?$/);
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
