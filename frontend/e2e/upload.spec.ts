import { expect, test } from "@playwright/test";
import fs from "fs";

// Full-pipeline test with a REAL demo: upload zone → in-browser gzip →
// chunked GCS upload → /analysis/{job_id} → Go parse → coaching report.
// Requires the authenticated storageState from auth.setup.ts.
// Point E2E_DEMO_PATH at a .dem; skips when none is present.
const DEMO_PATH =
  process.env.E2E_DEMO_PATH ?? "C:/Users/mgomez/Downloads/Playoff_M1_Anubis.dem";

test("uploads a real demo and produces an analysis", async ({ page }) => {
  test.skip(!fs.existsSync(DEMO_PATH), `no demo at ${DEMO_PATH}`);
  // 339MB: gzip in-browser, minutes of upload, then parse + coach.
  test.setTimeout(25 * 60_000);

  await page.goto("/");
  const input = page.getByLabel(/upload a cs2 demo file/i);
  await expect(input).toBeAttached({ timeout: 15_000 });
  await input.setInputFiles(DEMO_PATH);

  // Upload starts automatically: compressing → uploading → redirect.
  await page.waitForURL(/\/analysis\//, { timeout: 15 * 60_000 });
  const jobUrl = page.url();
  console.log(`[upload.spec] analysis page: ${jobUrl}`);

  // Parse done when the match header names the map from inside the demo.
  await expect(page.getByText(/anubis/i).first()).toBeVisible({ timeout: 8 * 60_000 });
  console.log("[upload.spec] parse complete — map header visible");

  // Never acceptable outcomes: the parse-failed panel or a stack trace.
  await expect(page.getByText(/parse failed/i)).toHaveCount(0);
  await expect(page.getByText(/unable to find existing entity/i)).toHaveCount(0);

  // Coaching lands (full report or the free-tier gated view — either proves
  // the coach job ran instead of crashing on import).
  await expect(
    page.getByText(/report|coaching|debrief|key finding|upgrade/i).first(),
  ).toBeVisible({ timeout: 8 * 60_000 });
  console.log("[upload.spec] coaching content visible");

  // Visual artifact for design review — the finished debrief, full page.
  await page.screenshot({ path: "test-results/debrief-full.png", fullPage: true });
  console.log("[upload.spec] screenshot: test-results/debrief-full.png");
});
