import { expect, test } from "@playwright/test";

// Design-review capture of every signed-in route, full page, with the session
// saved by auth.setup.ts. Runs in the `shots` (1440px) and `shots-mobile`
// (390px) projects; output lands in test-results/shots/<project>/<name>.png.
//
// A freshly signed-up user has no matches, so the debrief is covered by
// upload.spec.ts / debrief-shot.spec.ts, not here.
const ROUTES: { name: string; path: string; ready: RegExp }[] = [
  { name: "command-center", path: "/", ready: /upload/i },
  { name: "profile", path: "/profile", ready: /profile|matches|upload/i },
  { name: "settings", path: "/settings", ready: /settings|theme|account/i },
  { name: "settings-admin", path: "/settings/admin", ready: /\S/ },
  { name: "teams", path: "/teams", ready: /team/i },
  { name: "stratbook", path: "/stratbook", ready: /strat/i },
  { name: "scouting", path: "/scouting", ready: /scout/i },
  { name: "billing", path: "/billing", ready: /free/i },
  { name: "coach", path: "/coach", ready: /\S/ },
  { name: "onboarding", path: "/onboarding", ready: /\S/ },
  { name: "admin", path: "/admin", ready: /\S/ },
];

test.describe("signed-in pages", () => {
  for (const route of ROUTES) {
    test(`screenshot ${route.name}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      const resp = await page.goto(route.path);
      // `visible=true` skips the desktop nav links that are display:none on mobile.
      await expect(page.getByText(route.ready).locator("visible=true").first()).toBeVisible({
        timeout: 30_000,
      });
      // PageTransition entrances settle well under a second; give data fetches a beat.
      await page.waitForTimeout(2500);

      const dir = `test-results/shots/${testInfo.project.name}`;
      await page.screenshot({ path: `${dir}/${route.name}.png`, fullPage: true });

      // Record what the reviewer needs to know alongside the image.
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewport = page.viewportSize()?.width ?? 0;
      console.log(
        `[shots] ${route.name} status=${resp?.status()} url=${page.url()} ` +
          `hscroll=${scrollWidth > viewport ? "YES" : "no"} errors=${errors.length}`,
      );
      for (const e of errors) console.log(`[shots]   pageerror: ${e}`);
    });
  }

  test("screenshot upload modal and avatar menu", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const dir = `test-results/shots/${testInfo.project.name}`;
    await page.goto("/");
    const upload = page.getByRole("button", { name: /upload/i }).first();
    await expect(upload).toBeVisible({ timeout: 30_000 });
    await upload.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/upload-modal.png` });
    await page.keyboard.press("Escape");

    // Clerk's user button renders as a button with the avatar image.
    const avatar = page.locator(".cl-userButtonTrigger, button:has(img[alt*='avatar' i])").first();
    if (await avatar.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // force: on 390px the navbar overflows and the trigger sits outside the
      // viewport (a finding in its own right — see the hscroll line above).
      await avatar.click({ force: true });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/avatar-menu.png` });
    } else {
      console.log("[shots] avatar menu not found — skipped");
    }
  });
});
