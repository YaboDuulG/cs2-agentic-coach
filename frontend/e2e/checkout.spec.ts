import { expect, test, type Page } from "@playwright/test";

// Stripe TEST-mode checkout, end to end against the deployed app with the saved
// e2e session: /billing → Stripe Checkout (card 4242) → /billing/success →
// the backend's entitlements reflect the purchase via the webhook.
//
// Runs in the `checkout` project. Needs the deployed app to carry the pricing
// v2 code and the STRIPE_* env vars; skips itself when checkout refuses.

const CARD = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123", zip: "94107" };

async function payOnStripe(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  // Stripe's hosted page: fields carry stable ids; email is prefilled when
  // customer_email is passed, otherwise it is required.
  const email = page.locator("#email");
  if (await email.isVisible({ timeout: 5_000 }).catch(() => false)) {
    if (!(await email.inputValue())) await email.fill("e2e+checkout@example.com");
  }
  await page.locator("#cardNumber").fill(CARD.number);
  await page.locator("#cardExpiry").fill(CARD.expiry);
  await page.locator("#cardCvc").fill(CARD.cvc);
  const name = page.locator("#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("E2E Tester");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("US");
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill(CARD.zip);
  // Decline Link's "save my info" if it appears; it is optional.
  const linkOptOut = page.getByRole("checkbox", { name: /save my info|link/i });
  if (await linkOptOut.isVisible({ timeout: 1_000 }).catch(() => false)) {
    if (await linkOptOut.isChecked()) await linkOptOut.uncheck();
  }
  await page.locator("button[type=submit], .SubmitButton").first().click();
  await page.waitForURL(/\/billing\/success/, { timeout: 60_000 });
}

async function entitlements(page: Page) {
  const res = await page.request.get("/api/billing/entitlements");
  expect(res.ok(), `entitlements ${res.status()}`).toBeTruthy();
  return (await res.json()) as { tier: string; source: string; season: number | null; season_until: string | null };
}

test.describe.serial("stripe test-mode checkout", () => {
  test("Solo Pro monthly subscription", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/billing");
    const buy = page.getByRole("button", { name: /upgrade to solo pro/i });
    if (!(await buy.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, "Solo Pro is not purchasable for this user (already on a plan)");
    }
    await buy.click();
    await payOnStripe(page);
    await expect(page).toHaveURL(/\/billing\/success/);

    // The webhook is asynchronous; give it a few seconds.
    await expect
      .poll(async () => (await entitlements(page)).tier, { timeout: 60_000, intervals: [2_000] })
      .toBe("SOLO_PRO");
    const ent = await entitlements(page);
    console.log(`[checkout] solo pro: tier=${ent.tier} source=${ent.source}`);
    expect(ent.source).toBe("stripe");
  });

  test("Team season one-time payment", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/billing");
    const buy = page.getByRole("button", { name: /buy (esea season \d+|this season)/i });
    if (!(await buy.isVisible({ timeout: 15_000 }).catch(() => false))) {
      test.skip(true, "Team season is not purchasable (already owned, or seasons endpoint missing)");
    }
    await buy.click();
    // A 409/500 from checkout surfaces as a toast, not a redirect.
    const failed = page.getByText(/could not|couldn't|not configured|already have/i);
    await Promise.race([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 }),
      failed.waitFor({ state: "visible", timeout: 30_000 }).then(async () => {
        throw new Error(`checkout refused: ${await failed.textContent()}`);
      }),
    ]);
    await payOnStripe(page);

    await expect
      .poll(async () => (await entitlements(page)).source, { timeout: 60_000, intervals: [2_000] })
      .toBe("season");
    const ent = await entitlements(page);
    console.log(`[checkout] team: tier=${ent.tier} season=${ent.season} until=${ent.season_until}`);
    expect(ent.tier).toBe("TEAM");
    expect(ent.season).toBeGreaterThanOrEqual(59);
  });
});
