import { expect, test } from "@playwright/test";

// One-off design-review capture: opens an existing finished analysis with the
// saved e2e session and screenshots the full debrief. Set E2E_MATCH_URL.
const MATCH_URL = process.env.E2E_MATCH_URL ?? "";

test("screenshot an existing finished debrief", async ({ page }, testInfo) => {
  test.skip(!MATCH_URL, "E2E_MATCH_URL not set");
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(MATCH_URL);
  await expect(page.getByText(/match debrief/i).first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2500); // page-section entrance animations settle
  // Under the `shots` / `shots-mobile` projects this lands next to the other
  // signed-in captures; under `pipeline` it keeps the historical path.
  const dir = /shots/.test(testInfo.project.name)
    ? `test-results/shots/${testInfo.project.name}`
    : "test-results";
  await page.screenshot({ path: `${dir}/debrief-full.png`, fullPage: true });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()?.width ?? 0;
  console.log(
    `[debrief-shot] saved ${dir}/debrief-full.png hscroll=${scrollWidth > viewport ? "YES" : "no"} errors=${errors.length}`,
  );
  for (const e of errors) console.log(`[debrief-shot]   pageerror: ${e}`);
});
