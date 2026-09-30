import { expect, test, type Page } from "@playwright/test";

// Stripe TEST-mode checkout, end to end against the deployed app with the saved
// e2e session: /billing → Stripe Checkout (card 4242) → /billing/success →
// the backend's entitlements reflect the purchase via the webhook.
//
// Runs in the `checkout` project. Needs the deployed app to carry the pricing
// v2 code and the STRIPE_* env vars; skips itself when checkout refuses.

const CARD = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123", zip: "94107" };

// Click a buy button and surface the checkout route's real response: a
// failure shows as a toast that is gone by the time a timeout fires.
async function startCheckout(page: Page, button: ReturnType<Page["getByRole"]>) {
  // Signed-in shell must be hydrated (Clerk user button present) before the
  // click, and the session cookie must be there — otherwise diagnose, don't guess.
  await expect(page.getByRole("button", { name: /open user menu/i })).toBeVisible({ timeout: 30_000 });
  const cookieNames = (await page.context().cookies()).map((c) => c.name).filter((n) => n.startsWith("__")).sort();
  const probe = await page.request.get("/api/billing/entitlements");
  console.log(
    `[checkout] cookies=${cookieNames.join(",")} entitlements=${probe.status()} ` +
      `auth-reason=${probe.headers()["x-clerk-auth-reason"] ?? "-"} auth-status=${probe.headers()["x-clerk-auth-status"] ?? "-"}`,
  );
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/billing/checkout"), { timeout: 30_000 }),
    button.click(),
  ]);
  // On success the page navigates to Stripe at once and the response body is
  // discarded by the browser, so only read it when something went wrong.
  const body = res.ok() ? "" : await res.text().catch(() => "<body unavailable>");
  console.log(`[checkout] POST /api/billing/checkout -> ${res.status()} ${body.slice(0, 300)}`);
  expect(res.ok(), `checkout route returned ${res.status()}: ${body}`).toBeTruthy();
}

async function payOnStripe(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  // Stripe's hosted page: fields carry stable ids; email is prefilled when
  // customer_email is passed, otherwise it is required.
  // Email is typed last (see below): Stripe re-mounts the contact block when
  // the payment-method accordion opens, which wiped an early entry (run 12).
  // Payment methods are an accordion (card, Cash App, Klarna, bank…); the
  // card fields only render once "Pay with card" is selected.
  // The accordion row is the clickable thing; its "Pay with card" button is
  // visually hidden. Click the "Card" tile, fall back to a forced button click.
  const cardNumber = page.locator("#cardNumber").or(page.getByRole("textbox", { name: /card number/i })).first();
  await page.getByRole("heading", { name: /payment method/i }).waitFor({ state: "visible", timeout: 20_000 });
  const candidates = [
    page.locator('[data-testid="card-accordion-item-button"]'),
    page.locator('[data-testid="card-accordion-item"]'),
    page.getByText("Card", { exact: true }),
  ];
  for (const c of candidates) {
    if (await cardNumber.isVisible().catch(() => false)) break;
    const el = c.first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  if (!(await cardNumber.isVisible().catch(() => false))) {
    const ids = await page.locator("[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    console.log(`[checkout] card fields not found; data-testids: ${[...new Set(ids)].join(", ").slice(0, 800)}`);
  }
  await cardNumber.waitFor({ state: "visible", timeout: 20_000 });

  // Stripe's inputs are formatted as you type; `fill` on the id-matched element
  // left them empty (see run 9), so type into the accessible textboxes.
  const type = async (name: RegExp, value: string) => {
    const box = page.getByRole("textbox", { name }).first();
    await box.click();
    await box.pressSequentially(value, { delay: 25 });
    return box.inputValue();
  };
  const typed = {
    number: await type(/card number/i, CARD.number.replace(/\s/g, "")),
    expiry: await type(/expir/i, "1234"),
    cvc: await type(/cvc|security code/i, CARD.cvc),
  };
  const holder = page.getByRole("textbox", { name: /cardholder name|name on card/i }).first();
  if (await holder.isVisible().catch(() => false)) {
    await holder.click();
    await holder.pressSequentially("E2E Tester", { delay: 20 });
  }
  const country = page.getByRole("combobox", { name: /country/i }).first();
  if (await country.isVisible().catch(() => false)) await country.selectOption("US").catch(() => {});
  const zip = page.getByRole("textbox", { name: /zip|postal/i }).first();
  if (await zip.isVisible().catch(() => false)) await zip.fill(CARD.zip);
  console.log(`[checkout] typed number=${typed.number.replace(/\d(?=\d{4})/g, "•")} expiry=${typed.expiry} cvc=${"•".repeat(typed.cvc.length)}`);

  // Link's "save my information" is pre-checked and then demands a phone
  // number; the test pays as a guest.
  const saveInfo = page.getByRole("checkbox", { name: /save my information/i });
  if (await saveInfo.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if (await saveInfo.isChecked()) await saveInfo.uncheck();
  }

  const email = page.getByRole("textbox", { name: /^email$/i }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await email.inputValue().catch(() => "")).includes("@")) break;
    await email.click();
    await page.keyboard.press("Control+A");
    await email.pressSequentially("e2e+checkout@example.com", { delay: 20 });
    await page.waitForTimeout(300);
  }
  console.log(`[checkout] email=${(await email.inputValue().catch(() => "")) || "<empty>"}`);

  // The submit button is "Subscribe" or "Pay" / "Pay $300.00"; a loose /^pay/
  // also matched the hidden "Pay with card" accordion buttons (run 10).
  const submit = page
    .getByTestId("hosted-payment-submit-button")
    .or(page.getByRole("button", { name: /^(subscribe|pay(\s+\$[\d.,]+)?)$/i }))
    .first();
  await submit.click({ timeout: 15_000 });
  // Surface a validation error instead of waiting out the clock.
  const problem = page.getByText(/incomplete|invalid|declined|required|try again/i).first();
  const outcome = await Promise.race([
    page.waitForURL(/\/billing\/success/, { timeout: 90_000 }).then(() => "success"),
    problem.waitFor({ state: "visible", timeout: 90_000 }).then(async () => `stripe: ${await problem.textContent()}`),
  ]);
  expect(outcome, outcome).toBe("success");
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
    await startCheckout(page, buy);
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
    await startCheckout(page, buy);
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
