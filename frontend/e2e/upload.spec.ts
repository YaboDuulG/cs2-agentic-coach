import { expect, test } from "@playwright/test";
import fs from "fs";

// Full-pipeline test with a REAL demo: Home drop zone (Coach me) → in-browser
// gzip → chunked GCS upload → /analysis/{id} → parse → coaching → debrief.
// Requires the authenticated storageState from auth.setup.ts (which links a
// Steam ID so the personal upload is allowed).
// Point E2E_DEMO_PATH at a .dem; skips when none is present.
const DEMO_PATH = process.env.E2E_DEMO_PATH ?? "C:/Users/mgomez/Downloads/Playoff_M1_Anubis.dem";

test("uploads a real demo and produces a debrief", async ({ page }) => {
  test.skip(!fs.existsSync(DEMO_PATH), `no demo at ${DEMO_PATH}`);
  // 339MB: gzip in-browser, minutes of upload, then parse + coach.
  test.setTimeout(25 * 60_000);

  await page.goto("/");
  // Home decides "direct personal upload" from the Clerk user's Steam ID, so
  // the user must be loaded before the drop or the file goes to the picker.
  await page.waitForFunction(() => Boolean((window as unknown as { Clerk?: { user?: unknown } }).Clerk?.user), null, { timeout: 30_000 });
  const input = page.getByLabel(/upload a cs2 demo file/i);
  await expect(input).toBeAttached({ timeout: 15_000 });
  await input.setInputFiles(DEMO_PATH);

  await page.waitForURL(/\/analysis\//, { timeout: 15 * 60_000 });
  console.log(`[upload.spec] analysis page: ${page.url()}`);
  // The waiting screen (ProgressMark + stage copy) is only reachable here.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/debrief-waiting.png", fullPage: true });

  // Done state renders the section tabs; the waiting screen does not.
  await expect(page.getByRole("tab", { name: /report/i })).toBeVisible({ timeout: 16 * 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/anubis/i);
  await expect(page.getByText(/parse failed|coaching failed/i)).toHaveCount(0);
  console.log("[upload.spec] debrief rendered with coaching");

  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/debrief-full.png", fullPage: true });
  console.log("[upload.spec] screenshot: test-results/debrief-full.png");
});
