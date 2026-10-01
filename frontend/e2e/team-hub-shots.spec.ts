import { expect, test } from "@playwright/test";

// Team Hub design-review capture with the saved e2e user. Team is a paywall:
// a Free user sees the plan card on /teams (captured, then the test ends);
// a user with the Team plan or an existing team gets the full hub: every tab,
// the invite box, the team-mode upload modal and the training page.
// Runs in `team-shots` (1440) and `team-shots-mobile` (390).

test("teams page, then the hub when one is available", async ({ page }, testInfo) => {
  // Generous: against a cold dev server every tab compiles on first visit.
  test.setTimeout(480_000);
  const dir = `test-results/shots/${testInfo.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/teams");
  await expect(page.getByRole("heading", { level: 1, name: /teams/i })).toBeVisible({ timeout: 30_000 });
  // A cold dev server compiles the API route on first hit; wait for the list
  // to settle (paywall card, team cards or the empty state) before deciding.
  const paywall = page.getByRole("button", { name: /choose team/i });
  const firstTeam = page.locator('a[href^="/teams/"]').first();
  await expect(paywall.or(firstTeam).or(page.getByText(/no teams yet/i)).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/teams.png`, fullPage: true });

  if ((await firstTeam.count()) === 0) {
    if (await paywall.isVisible().catch(() => false)) {
      await paywall.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/team-paywall-modal.png` });
      await page.keyboard.press("Escape");
      console.log("[team-shots] no Team plan: paywall captured, hub skipped");
    } else {
      // Entitled but no team yet: create one through the UI.
      const teamName = `E2E Squad ${new Date().toISOString().slice(11, 19)}`;
      await page.getByRole("button", { name: /create team/i }).first().click();
      await page.getByPlaceholder(/night shift/i).fill(teamName);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/teams\/[^/]+/, { timeout: 15_000 });
    }
  } else {
    await firstTeam.click();
    await page.waitForURL(/\/teams\/[^/]+/, { timeout: 15_000 });
  }

  if (!/\/teams\/[^/]+/.test(page.url())) {
    expect(errors, errors.join("; ")).toHaveLength(0);
    return;
  }
  const teamUrl = page.url().split("?")[0];
  console.log(`[team-shots] team hub: ${teamUrl}`);
  await expect(page.getByRole("tab", { name: /overview/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/team-overview.png`, fullPage: true });

  const upload = page.getByRole("button", { name: /upload a demo/i }).first();
  if (await upload.isVisible().catch(() => false)) {
    await upload.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/team-upload-modal.png` });
    await page.keyboard.press("Escape");
  }

  for (const tab of ["Opponents", "Stratbook", "Coach", "Settings"]) {
    const t = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
    await t.click();
    await expect(t).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-skeleton]")).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/team-tab-${tab.toLowerCase()}.png`, fullPage: true });
  }

  await page.goto(`${teamUrl}/training`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/team-training.png`, fullPage: true });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()?.width ?? 0;
  console.log(`[team-shots] training hscroll=${scrollWidth > viewport ? "YES" : "no"} errors=${errors.length}`);
  expect(scrollWidth > viewport, "training page scrolls horizontally").toBe(false);
  expect(errors, errors.join("; ")).toHaveLength(0);
});
