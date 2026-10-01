// Probe: on production, open the sign-in modal, click "Continue with Google",
// and report where Google was asked to send the user back. Signs nobody in.
//   node e2e/google-oauth-probe.mjs [baseUrl]
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://demo-sage.me";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  await page.goto(base);
  const html = await page.content();
  console.log(`clerk key on page: ${(html.match(/pk_(live|test)_/) ?? ["none"])[0]}…  frontend api: ${(html.match(/clerk\.demo-sage\.me|[a-z-]+\.clerk\.accounts\.dev/) ?? ["?"])[0]}`);

  await page.getByRole("button", { name: /log in/i }).first().click();
  await page.getByText(/sign in to demosage/i).waitFor({ state: "visible", timeout: 30_000 });
  const google = page.getByRole("button", { name: /continue with google/i }).first();
  console.log(`"Continue with Google" button: ${(await google.isVisible()) ? "visible" : "MISSING"}`);

  const [popupOrNav] = await Promise.all([
    Promise.race([
      page.waitForEvent("popup", { timeout: 20_000 }).then((p) => ({ kind: "popup", page: p })),
      page.waitForURL(/accounts\.google\.com|clerk\.demo-sage\.me|google\.com/, { timeout: 20_000 }).then(() => ({ kind: "nav", page })),
    ]),
    google.click(),
  ]);
  const target = popupOrNav.page;
  await target.waitForLoadState("domcontentloaded").catch(() => {});
  await target.waitForTimeout(2500);
  const url = new URL(target.url());
  console.log(`landed on: ${url.origin}${url.pathname}`);
  const p = url.searchParams;
  const redirect = p.get("redirect_uri") ?? "";
  const client = p.get("client_id") ?? "";
  if (redirect || client) {
    console.log(`redirect_uri: ${redirect}`);
    console.log(`client_id: ${client ? client.replace(/^(\d{4})\d+/, "$1…") : "(none)"}`);
  }
  const text = (await target.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  const problem = text.match(/error 4\d\d[^.]*|redirect_uri_mismatch|access blocked[^.]*|not verified[^.]*|invalid_client[^.]*/i);
  console.log(problem ? `GOOGLE SAYS: ${problem[0]}` : `google page: ${text.slice(0, 160)}`);
} catch (e) {
  console.log(`probe failed: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
