import { expect, test } from "@playwright/test";

// Design-review capture of every signed-in route, full page, with the session
// saved by auth.setup.ts. Runs in the `shots` (1440px) and `shots-mobile`
// (390px) projects; output lands in test-results/shots/<project>/<name>.png.
//
// A freshly signed-up user has no matches, so the debrief is covered by
// upload.spec.ts / debrief-shot.spec.ts, and the Team Hub by team-hub-shots.
const ROUTES: { name: string; path: string; ready: RegExp }[] = [
  { name: "home", path: "/", ready: /welcome back|upload/i },
  { name: "matches", path: "/matches", ready: /matches/i },
  { name: "teams", path: "/teams", ready: /teams/i },
  { name: "stratbook", path: "/stratbook", ready: /stratbook/i },
  { name: "settings-profile", path: "/settings", ready: /settings/i },
  { name: "settings-appearance", path: "/settings?tab=appearance", ready: /theme/i },
  { name: "settings-plan", path: "/settings?tab=plan", ready: /your plan|invite/i },
  { name: "billing", path: "/billing", ready: /free/i },
  { name: "settings-admin-404", path: "/settings/admin", ready: /\S/ },
];

test.describe("signed-in pages", () => {
  for (const route of ROUTES) {
    test(`screenshot ${route.name}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      const resp = await page.goto(route.path);
      await expect(page.getByText(route.ready).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
      // Let the data land (a cold dev server compiles each API route on first hit).
      await expect(page.locator("[data-skeleton]")).toHaveCount(0, { timeout: 60_000 });
      await page.waitForTimeout(800);

      const dir = `test-results/shots/${testInfo.project.name}`;
      await page.screenshot({ path: `${dir}/${route.name}.png`, fullPage: true });

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewport = page.viewportSize()?.width ?? 0;
      const hscroll = scrollWidth > viewport;
      console.log(`[shots] ${route.name} status=${resp?.status()} url=${page.url()} hscroll=${hscroll ? "YES" : "no"} errors=${errors.length}`);
      for (const e of errors) console.log(`[shots]   pageerror: ${e}`);
      // Assertions, not just logs: the rewrite's regression net.
      expect(hscroll, `${route.name} scrolls horizontally at ${viewport}px`).toBe(false);
      expect(errors, `${route.name} threw: ${errors.join("; ")}`).toHaveLength(0);
    });
  }

  test("screenshot upload modal, step 1 and step 2", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const dir = `test-results/shots/${testInfo.project.name}`;
    await page.goto("/");
    const upload = page.getByRole("button", { name: /^upload$/i }).first();
    await expect(upload).toBeVisible({ timeout: 30_000 });
    await upload.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("radio", { name: /coach me/i })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/upload-step1.png` });
    const cont = dialog.getByRole("button", { name: /continue/i });
    if (await cont.isEnabled()) {
      await cont.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/upload-step2.png` });
    }
    await page.keyboard.press("Escape");
  });

  test("the theme switches and persists", async ({ page }, testInfo) => {
    const dir = `test-results/shots/${testInfo.project.name}`;
    await page.goto("/settings?tab=appearance");
    for (const theme of ["Global Offensive", "The Great Khan", "Counter-Strike 2"]) {
      await page.getByRole("radio", { name: new RegExp(theme, "i") }).click();
      await page.waitForTimeout(300);
      const attr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await page.screenshot({ path: `${dir}/theme-${slug}.png`, fullPage: true });
      console.log(`[shots] theme ${theme} -> data-theme=${attr ?? "(default)"}`);
    }
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();
  });
});
