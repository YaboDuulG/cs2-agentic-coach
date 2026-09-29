import { expect, test } from "@playwright/test";

// Team Hub design-review capture: creates a team through the real UI for the
// saved e2e user, then screenshots every tab, the invite box, the team-mode
// upload modal and the training page. Runs in `team-shots` (1440) and
// `team-shots-mobile` (390); output in test-results/shots/<project>/team-*.png.
//
// Each run creates one more team for the e2e user — that is fine for a
// throwaway +clerk_test account and keeps the spec independent of prior runs.

test("create a team and screenshot the hub", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const dir = `test-results/shots/${testInfo.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const teamName = `E2E Squad ${new Date().toISOString().slice(11, 19)}`;

  await page.goto("/teams");
  await page.getByRole("button", { name: /create team/i }).first().click();
  await page.getByPlaceholder(/team name/i).fill(teamName);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // The new team renders as a card in the list; clicking it routes to the hub.
  const card = page.getByText(teamName).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/team-list.png`, fullPage: true });
  await card.click();
  await page.waitForURL(/\/teams\/[^/]+$/, { timeout: 15_000 });
  const teamUrl = page.url();
  console.log(`[team-shots] team hub: ${teamUrl}`);

  await expect(page.getByRole("heading", { name: teamName })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/team-overview.png`, fullPage: true });

  // Invite code box.
  const invite = page.getByText(/invite a team member/i).first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/team-invite.png`, fullPage: true });
  }

  // Team-mode upload modal — the only path that sends a team_id today.
  await page.getByRole("button", { name: /upload a demo/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/team-upload-modal.png` });
  await page.keyboard.press("Escape");

  for (const tab of ["Stratbook", "AI Coach", "Settings"] as const) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(1500);
    const slug = tab.toLowerCase().replace(/\s+/g, "-");
    await page.screenshot({ path: `${dir}/team-tab-${slug}.png`, fullPage: true });
  }

  await page.goto(`${teamUrl}/training`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/team-training.png`, fullPage: true });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()?.width ?? 0;
  console.log(
    `[team-shots] training hscroll=${scrollWidth > viewport ? "YES" : "no"} errors=${errors.length}`,
  );
  for (const e of errors) console.log(`[team-shots]   pageerror: ${e}`);
});
