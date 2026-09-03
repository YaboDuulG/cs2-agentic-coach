import { expect, test as setup } from "@playwright/test";
import path from "path";

// Signs up a fresh Clerk test user through the real UI and saves the session
// for the authenticated specs. Works WITHOUT any secret key: Clerk DEV
// instances treat `*+clerk_test@*` addresses as test emails whose email-code
// verification is always 424242 (documented Clerk test mode). A fresh address
// per run also means a fresh free-tier quota for the upload spec.
export const STORAGE_STATE = path.join(__dirname, "../playwright/.clerk/user.json");

setup("sign up a clerk test user", async ({ page }) => {
  setup.setTimeout(120_000);
  // Clerk's documented test-email shape: *+clerk_test@example.com.
  const email = `e2e-${Date.now()}+clerk_test@example.com`;
  const password = `E2e!${Date.now()}x${Math.random().toString(36).slice(2, 10)}`;

  await page.goto("/");

  // Clerk hydrates its modal buttons after load; a too-early click is a no-op.
  // (No networkidle wait — the landing page holds long-lived connections and
  // never goes idle, which timed this test out before.)
  const emailBox = page.getByPlaceholder(/enter your email address/i);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: /sign up/i }).first().click();
    if (await emailBox.isVisible({ timeout: 5_000 }).catch(() => false)) break;
  }
  await expect(emailBox).toBeVisible({ timeout: 10_000 });

  await emailBox.fill(email);
  await page.getByPlaceholder(/create a password/i).fill(password);
  await page.getByRole("button", { name: /^continue/i }).click();

  // Email verification: test addresses always accept 424242. Clerk's code
  // field DOM varies by version — cover the known shapes.
  const otp = page
    .locator(
      'input[data-otp-input], input[name^="codeInput"], input[autocomplete="one-time-code"]',
    )
    .first();
  // If Clerk rejected the submit (bad email, bot protection), say why
  // instead of timing out on the code field.
  const outcome = await Promise.race([
    otp.waitFor({ state: "visible", timeout: 20_000 }).then(() => null),
    page
      .getByRole("alert")
      .filter({ hasText: /\S/ })
      .first()
      .textContent({ timeout: 20_000 })
      .catch(() => null),
  ]);
  if (typeof outcome === "string") throw new Error(`Clerk rejected sign-up: ${outcome}`);
  await expect(otp).toBeVisible({ timeout: 1_000 });
  await otp.click();
  await page.keyboard.type("424242", { delay: 80 });

  // Signed-in shell: the Upload button only renders for a session.
  await expect(page.getByRole("button", { name: /upload/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.context().storageState({ path: STORAGE_STATE });
  console.log(`[auth.setup] signed up ${email}`);
});
