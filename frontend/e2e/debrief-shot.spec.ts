import { expect, test } from "@playwright/test";

// One-off design-review capture: opens an existing finished analysis with the
// saved e2e session and screenshots the full debrief. Set E2E_MATCH_URL.
const MATCH_URL = process.env.E2E_MATCH_URL ?? "";

test("screenshot an existing finished debrief", async ({ page }) => {
  test.skip(!MATCH_URL, "E2E_MATCH_URL not set");
  test.setTimeout(180_000);
  await page.goto(MATCH_URL);
  await expect(page.getByText(/match debrief/i).first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2500); // page-section entrance animations settle
  await page.screenshot({ path: "test-results/debrief-full.png", fullPage: true });
  console.log("[debrief-shot] saved test-results/debrief-full.png");
});
