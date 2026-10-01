import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";
import path from "path";

// Signs a Clerk test user in and saves the session for the authenticated
// specs. The user is created through Clerk's Backend API (needs
// CLERK_SECRET_KEY from .env.e2e) and signed in with a one-shot ticket, so the
// sign-up CAPTCHA never runs: the Turnstile challenge cannot load in some
// sandboxes and left the UI flow stuck with an empty form.
//
//   default           reuse the newest `*+clerk_test@example.com` user (keeps
//                     their team and matches between runs); create one if none
//   E2E_EMAIL=…       use that user (must exist)
//   E2E_FRESH_USER=1  always create a new user (fresh free-tier quota)
export const STORAGE_STATE = path.join(__dirname, "../playwright/.clerk/user.json");

const TEST_DOMAIN = "+clerk_test@example.com";

setup("sign in a clerk test user", async ({ page }) => {
  setup.setTimeout(120_000);
  if (!process.env.CLERK_SECRET_KEY) throw new Error("[auth.setup] CLERK_SECRET_KEY missing (see .env.e2e)");
  const { createClerkClient } = await import("@clerk/backend");
  const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  let email = process.env.E2E_EMAIL;
  if (!email && !process.env.E2E_FRESH_USER) {
    // `query` does not match the "+" tag, so filter client-side.
    const list = await backend.users.getUserList({ orderBy: "-created_at", limit: 50 });
    email = list.data
      .flatMap((u) => u.emailAddresses.map((e) => e.emailAddress))
      .find((e) => e.endsWith(TEST_DOMAIN));
  }
  if (!email) {
    email = `e2e-${Date.now()}${TEST_DOMAIN}`;
    const password = `E2e!${Date.now()}x${Math.random().toString(36).slice(2, 10)}`;
    await backend.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true });
    console.log(`[auth.setup] created ${email}`);
  }

  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/");

  // Signed-in shell: the Upload button only renders for a session.
  await expect(page.getByRole("button", { name: /^upload$/i }).first()).toBeVisible({ timeout: 30_000 });

  // Personal uploads need a linked Steam ID (owner decision). Any SteamID64
  // works: a player not in the demo just yields the identity notice.
  const userId = await page.evaluate(
    () => (window as unknown as { Clerk?: { user?: { id?: string } } }).Clerk?.user?.id ?? null,
  );
  if (userId) {
    const user = await backend.users.getUser(userId);
    if (!user.unsafeMetadata?.steam_id) {
      await backend.users.updateUserMetadata(userId, {
        unsafeMetadata: { steam_id: process.env.E2E_STEAM_ID ?? "76561198000000001" },
      });
      console.log("[auth.setup] linked a Steam ID on the test user");
    }
  }

  await page.context().storageState({ path: STORAGE_STATE });
  console.log(`[auth.setup] signed in as ${email}`);
});
