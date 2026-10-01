import { expect, test } from "@playwright/test";

// Design-review capture: opens an existing finished analysis with the saved
// session and screenshots the full debrief. Set E2E_MATCH_URL.
const MATCH_URL = process.env.E2E_MATCH_URL ?? "";

test("screenshot an existing finished debrief", async ({ page }, testInfo) => {
  test.skip(!MATCH_URL, "E2E_MATCH_URL not set");
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(MATCH_URL);
  await expect(page.getByRole("tab", { name: /report/i })).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const dir = /shots/.test(testInfo.project.name) ? `test-results/shots/${testInfo.project.name}` : "test-results";
  await page.screenshot({ path: `${dir}/debrief-full.png`, fullPage: true });
  // Each section on its own as well, for the mobile tab mode.
  for (const tab of ["Rounds", "Duels", "Players", "Map"]) {
    const t = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
    if (await t.isVisible().catch(() => false)) {
      await t.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/debrief-${tab.toLowerCase()}.png`, fullPage: true });
    }
  }
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()?.width ?? 0;
  console.log(`[debrief-shot] saved to ${dir} hscroll=${scrollWidth > viewport ? "YES" : "no"} errors=${errors.length}`);
  expect(scrollWidth > viewport, "debrief scrolls horizontally").toBe(false);
  expect(errors, errors.join("; ")).toHaveLength(0);
});
