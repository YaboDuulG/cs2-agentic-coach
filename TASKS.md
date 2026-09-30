# TASKS — everything designed on 2026-09-29, with status

One list. Each row says whether it is shipped in the working tree (uncommitted on
`main` as of writing), open for the owner, or open for engineering, and where the
detail lives. Reference documents were updated the same day: `README.md`,
`TECHNICAL_SPEC.md` §15, `CLAUDE.md`, `.env.example`, `docs/pricing.md`,
`frontend/FRONTEND_REFACTOR_PLAN.md`, `ARCHITECTURE_REFACTOR_PLAN.md`.

Legend: **DONE** = code in the tree with tests passing · **OWNER** = only you can do it
· **OPEN** = engineering work not started · **PLANNED** = specified, not started.

## 1. Decisions taken (do not reopen)

| Decision | Detail |
|---|---|
| Pricing | Free $0 · Solo Pro **$10 / mo or $96 / yr** · Team **$300 flat per ESEA season** (one-time payment, hard paywall) |
| Seasons | ESEA calendar: S59 = 5 Oct – 20 Dec 2026, published S56–S59, projected 4 / year after; access runs until the next season starts |
| Team paywall | Creating a team, team uploads, scouting, servers, Discord all need a season; invited members inherit the owner's season |
| Coaching mode | Chosen at upload (Coach me / Coach my team / Scout an opponent), stored on the match, never a global toggle; "Coach me" needs a linked Steam ID |
| Scouting | Belongs to the team: uploaded from and listed in the Team Hub (Opponents tab) |
| Debrief stages | parse → stats → coaching, one screen per outcome; a coaching failure shows no stats |
| Themes | CS2 default, CS:GO second, Great Khan third; fixed CT/T colours across themes |
| Admin | `/settings/admin` returns 404 to non-admins |
| Trials | Weekly single-use trial codes (Solo Pro or Team); referral link gives both sides 7 days of Solo Pro |
| Metering | Every Gemini call and every server hour is metered per team; no mock servers ever count |

## 2. Shipped in this pass (DONE, uncommitted)

| Area | What | Files | Tests |
|---|---|---|---|
| Security | Admin routes check the Clerk admin role server-side; non-admins get 404 | `frontend/lib/server/admin.ts`, `app/api/admin/*` | — |
| Promo codes | Trial code minting/listing (admin), redemption rules, referral codes, grants as time-boxed `trialing` rows; `trialing` now expires on its period end | `services/billing/promo.py`, `api/routes/{billing,admin}.py`, migration `a1c7e9b3d5f2` | `tests/test_promo.py` |
| Referral UX | Invite card + redeem box on `/profile`; `/sign-up?ref=CODE` → auto-redeem after first sign-in; admin Trial codes panel | `components/InviteCard.tsx`, `ReferralRedeemer.tsx`, `components/admin/TrialCodesPanel.tsx`, `app/sign-up`, `app/api/billing/{redeem,referral,entitlements}` | — |
| Seasons | Season calendar + projection; season purchases via `/api/billing/sync`; `/api/billing/seasons`; `subscriptions.season/season_until` outrank Stripe fields | `services/billing/seasons.py`, `api/routes/billing.py`, `db/models.py` | `tests/test_seasons.py`, `tests/test_billing_sync.py` |
| Checkout | Solo Pro monthly/yearly subscription; Team one-time payment for the purchasable season; refuses a season already owned; webhook handles `mode: payment` | `app/api/billing/{checkout,webhook}`, `lib/flags.ts` | — |
| Pricing page | New prices, Monthly/Yearly toggle, season on sale with dates, "You have Season N"; upgrade modal updated | `app/billing/page.tsx`, `components/paywall/UpgradeModal.tsx` | — |
| Metering | `llm_usage` rows for every Gemini call (coach, chat, critique, RCON), priced at config rates; server hours from training sessions; per-team table with revenue and margin; editable cost rates | `services/billing/metering.py`, `agents/scribe/report_generator.py`, `agents/khan/{llm,nodes}.py`, `agents/strat_reviewer.py`, `db/config.py`, `components/admin/TeamMeteringPanel.tsx` | `tests/test_metering.py` |
| DatHost | Mock-server fallback removed: out of credits → 402 with a clear message, no server row, no session; local/mock servers excluded from billable hours; account credits + servers-on shown on the metering panel | `services/warlord/dathost_client.py`, `api/routes/{servers,admin}.py`, `app/api/admin/dathost-account` | `tests/test_dathost_credits.py` |
| Stripe tooling | CLI installed (winget); idempotent price setup script | `scripts/stripe_setup_prices.ps1` | — |
| Screenshot suite | Signed-in, Team Hub and debrief captures at 1440/390; upload spec waits for coaching | `frontend/e2e/*`, `playwright.config.ts` | run manually |
| Docs | Refactor plans, UX review with evidence, page map, pricing, this file, project skill | see §5 | — |

## 3. Owner to-do (OWNER)

1. Stripe **test mode is done** (2026-09-29) in account `acct_1TZdVcGYeJKiKc7G` (activated:
   charges and payouts enabled): products, the three prices (lookup keys
   `demosage_solo_*`, `demosage_team_season`) and a webhook endpoint for
   `cs2-agentic-coach.vercel.app/api/billing/webhook`. Vercel **Production** holds the
   test secret, the webhook secret and the three price ids, pushed with
   `scripts/vercel_push_env.mjs` (a shell pipe had left a `\r` in the secret →
   "Invalid character in header content" from Stripe). Lesson: the first restricted key
   pointed at a different Stripe environment, so its prices were invisible to the
   standard key; always mint prices with the same key the app runs with.
   **Verified 2026-09-30** on production with `npx playwright test --project=checkout`:
   Solo Pro monthly → `tier=SOLO_PRO source=stripe`; Team season → `tier=TEAM season=59
   season_until=2027-01-04` (webhook → `/api/billing/sync` → entitlements). The spec
   drives Stripe's hosted page (accordion, typed card fields, email typed last, guest
   checkout without Link). For live mode: a live key into
   `frontend/.env.local` as `STRIPE_SECRET_KEY`, re-run `stripe_setup_prices.ps1 -Live`,
   recreate the webhook for `https://demo-sage.me/api/billing/webhook`, push with
   `vercel_push_env.mjs`. The old $20 / $5 prices do not exist in this account; nothing to
   archive.
2. `alembic upgrade head` on staging (one migration: promo tables, season columns, `llm_usage`).
3. Set the real rates on `/settings/admin` → Cost rates: DatHost's per-hour price for the
   server size you use (default $0.10 is a placeholder); Gemini list prices are pre-filled.
4. Confirm DatHost's `/account` payload field for credits (the client reads `credits` and
   `currency`; the panel says "credits not reported" if the names differ — then adjust
   `get_account()` in `services/warlord/dathost_client.py`).
5. Remove dead credentials: `VULTR_API_KEY` (root `.env`) and `HETZNER_API_TOKEN` (Vercel
   env). Nothing reads them.
6. Recreate the repo `.venv` (it points at a removed Python 3.14):
   `py -3.13 -m venv .venv; .venv\Scripts\pip install -r requirements.txt`.
7. Move Clerk production to a production instance (the user menu shows "Development mode"),
   using `demo-sage.me` as the instance domain.
9. **Domain `demo-sage.me` is live** (2026-09-30): nameservers moved to Vercel
   (`ns1/ns2.vercel-dns.com`), both hostnames verified, certificates issued for
   `demo-sage.me` and `*.demo-sage.me`, HTTPS 200 on apex and www. The earlier "invalid
   configuration" was GoDaddy's parked A records living beside Vercel's; moving the
   nameservers made them irrelevant. Playwright's default base URL is the domain now.
   Then: Clerk
   production instance on the domain, Stripe live webhook on the domain, and
   `PLAYWRIGHT_BASE_URL`. The CORS allowlist already includes it (branch `domain-demo-sage`).
8. Decide the referrer bonus: both sides get 7 days today; `REFERRER_BONUS_DAYS` in
   `services/billing/promo.py` sets the referrer's share.

## 4. Engineering backlog (OPEN / PLANNED)

Backend (`ARCHITECTURE_REFACTOR_PLAN.md` §3):

| # | Item | Status |
|---|---|---|
| B1a | `mode` on `/api/analyses` rows and `/api/jobs/{id}` | OPEN |
| B1b | Job `stage` + `failure_reason` on `/api/jobs/{id}` (parse / stats / coaching) | OPEN |
| B1c | `require_entitlement(TEAM_ANALYSIS)` on team create and server/training routes; join stays open | OPEN |
| B1d | Server-hour caps per season (metering data first; see `docs/pricing.md`) | PLANNED |
| 3.1 | Move `agents/` into `services/coaching_ai`, `db/jobs.py` into `services/ingestion`; delete `api/agents/tactician_heuristics.py` and the Steam branch of `api/routes/oauth.py` | OPEN |
| 3.2 | import-linter contracts in CI; drop `\|\| true` from mypy | OPEN |
| 3.3 | Per-kill `is_trade` / `trade_window_ms`; `subtick_offset`; `tick_range` on pro examples | OPEN |
| 3.5 | Grounding metrics on the admin page (drop-rate, citation coverage) | OPEN |
| — | Rename `practice_servers.vultr_instance_id` → `provider_server_id` (cosmetic; migration) | PLANNED |

Frontend (`frontend/FRONTEND_REFACTOR_PLAN.md` §3, page specs in §6):

| # | Workstream | Status |
|---|---|---|
| W0 | Delete `/coach`, `/admin`, `/onboarding`, `/matches/[id]`; `proxy.ts` matcher | OPEN (admin guard part is DONE) |
| W1 | Server truth: `/api/me`, query hooks, delete the three event buses and `localStorage.coaching_mode` | OPEN |
| W2 | Upload modal mode picker (Steam-link gate, team selector, locked cards, scouting via team) | OPEN |
| W3 | App shell, `PageHeader`, `SectionTabs`, themed Clerk menu, `/matches`, `/settings` (Profile · Appearance · Plan incl. invite card), Team Hub Opponents tab, `/teams` paywall | OPEN |
| W4 | Theme system: CS2 root, CS:GO, Khan; identity slots; switcher in avatar menu | OPEN |
| W5 | Debrief split + three-stage state machine + chart pass | OPEN |
| W6 | Three-theme capture matrix with assertions | OPEN |

## 5. Where the detail lives

| Document | Holds |
|---|---|
| `frontend/FRONTEND_REFACTOR_PLAN.md` | Root causes, workstreams, upload flow, theme slots, shell, debrief state machine, page-by-page spec (§6) |
| `frontend/UX_REVIEW.md` | Findings with screenshot evidence (§2, §6, §7), capture specs |
| `ARCHITECTURE_REFACTOR_PLAN.md` | Backend status vs the architect prompt, deviations, remaining backend work |
| `docs/pricing.md` | Competitor prices, decided prices, season model, Stripe checklist, metering rationale |
| `TECHNICAL_SPEC.md` §15 | One row per shipped decision (updated 2026-09-29) |
| `.claude/skills/demosage-frontend/SKILL.md` | Frontend rules and review checklist for future sessions |
