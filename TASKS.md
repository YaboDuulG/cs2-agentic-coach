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

### 2b. Frontend rewrite (DONE 2026-10-01, branch `frontend-rewrite`, uncommitted)

| Area | What | Files | Verified |
|---|---|---|---|
| Foundation | Tokens for three themes (CS2 root, CS:GO, Khan), fonts by role, primitives, identity marks, app shell with one navbar, footer, toaster | `app/globals.css`, `lib/theme/*`, `components/ui/*`, `components/identity/*`, `components/shell/*`, `app/layout.tsx` | tsc, lint, `next build`, screenshots in all three themes |
| Data layer | Every read and mutation as a TanStack Query hook; `useJob` polls light then full; `HttpError` | `lib/api/hooks.ts`, `lib/api/contract.md` | tsc |
| Upload | Two-step modal (who is it for → drop), locked Team cards, Steam-link gate, gzip + chunked upload hook | `components/upload/*`, `lib/upload/useDemoUpload.ts` | modal screenshots; pipeline spec (see below) |
| Pages | Landing, Home, Matches, Debrief (3 stages), Teams + paywall, Team Hub (5 tabs), Training, Server, Stratbook, Settings (3 tabs + Clerk account), Admin (metering + trial codes), Billing, Sign in/up | `app/**`, `components/{home,matches,debrief,teams,stratbook,settings,admin}/*` | `shots`, `shots-mobile`, `team-shots*` suites on localhost |
| Backend support | `mode` on match rows; `stage`/`coach_status`/`coach_error` on jobs; team analyses list includes recon rows | `api/routes/{analyses,jobs,teams}.py` | ruff, pytest (251 passed, 1 xfail) |
| E2E | Setup creates/signs in the test user through Clerk's Backend API (no CAPTCHA); specs wait for data; `E2E_EMAIL` reuses a user | `frontend/e2e/*` | run locally |

Deleted: 25 legacy files (old pages, `components/analysis/*`, `CS2PlanningBoard`,
`ServerControlPanel`, `AddStrategyModal`, old stratbook canvas, old paywall cards, old
theme files). Known gaps carried in §4.

### 2c. Discord channel groups and test suites (DONE 2026-10-02, branch `discord-channel-groups`, uncommitted)

Audit result: the Discord code was complete but **production was never configured**
(the live endpoint answers `401 DISCORD_PUBLIC_KEY is not configured`; no `DISCORD_*`
secret in Secret Manager). `docs/discord.md` is the reference: model, setup, testing.

| Area | What | Files | Tests |
|---|---|---|---|
| Channel groups | `/strat bind` inside a Discord category binds the whole group; each text channel named after a map is that map's channel; strat threads open there; `/strat create` and `/strat view` take the map from the channel; `/strat channels` lists the mapping | `services/discord_bot/{channels,interactions,sync}.py`, `db/models.py` (`team_discord_links.category_id`, `team_discord_channels`), migration `c5d8e2f4a7b1`, deploy migrate job | `tests/test_discord_channels.py` |
| Review button | Submitting a strat for review now posts the embed with **Approve** (before, only a new revision did, so a first review could not be approved from Discord) | `services/discord_bot/sync.py` | same |
| Web | Team-level status / bind code / unbind; the Discord card shows Connected and the channel → map list, and gives the right command (it used to say to bind inside a strat thread) | `api/routes/teams.py`, `app/api/teams/[teamId]/discord`, `components/teams/DiscordCard.tsx` | same |
| Security fix | `POST /api/discord/webhook` was open in production (no secret set → no check): anyone could write into a team's knowledge base and spend Gemini calls. It now fails closed outside `LOCAL_MODE`; the Next relay passes the sender's signature through instead of adding none | `api/routes/discord.py`, `app/api/discord/webhook/route.ts` | same |
| End-to-end suite | Plays Discord with a real Ed25519 key and enforced signatures: bind → channel mapping → create in a map channel → thread → review → Approve → ACTIVE; web-made strat landing in its map channel; outage and recovery | `tests/test_discord_e2e.py`, `tests/discord_fakes.py` | 349 backend tests pass (81 new) |
| `/strat ingest` | Reads a channel's history since the last ingest (first run: from the beginning), Gemini extracts the strategies, saved as `team_strategy` rows with embeddings (the web's "Ingested from Discord" list and the team coach read them); cursor per channel; long channels chain runs; Gemini metered as `purpose=ingest` | `services/discord_bot/ingest.py`, `db/models.py` (`team_discord_ingest_cursors`) | `tests/test_discord_ingest.py` |
| Replay lab fix (2026-10-05) | "2D and 3D maps not loading": the 2D radar drew dots on a dark square because no map image source was configured, and the 3D view had been dropped in the rewrite. Now: per-map radar calibration (`lib/maps.ts`, de_dust2 verified against a real demo), the real radar image under the 2D tracks, names and this round's side from the job roster, and a restored 3D kill view (three.js) sharing the same calibration, behind a 2D / 3D toggle | `lib/maps.ts`, `components/minimap/{TacticalRadar,DemoViewer,Viewer3D}.tsx`, `app/analysis/[jobId]/replay/page.tsx` | checked in the browser with the owner's dust2 match |
| Doctor | `python scripts/discord_doctor.py [--guild id]`: read-only PASS/FAIL report of settings, application, endpoint, commands and the channel group | `scripts/discord_doctor.py` | `tests/test_discord_doctor.py` |

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
   checkout without Link).
   **Live mode is set up (2026-09-30):** live prices minted with the live restricted key
   (`demosage_solo_monthly` $10, `demosage_solo_yearly` $96, `demosage_team_season` $300
   one-time), live webhook endpoint at `https://demo-sage.me/api/billing/webhook`, and the
   live secret, webhook secret and price ids pushed to Vercel **Production**. They take
   effect on the next production deployment — after that, production charges real cards
   and the test-card spec must run against a Preview/test deployment instead.
   `frontend/.env.local` is now LIVE too; for local testing switch it back to the test key
   and test ids (they are in Stripe under the same lookup keys in test mode). The old
   $20 / $5 prices do not exist in this account; nothing to archive.
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
7. **Clerk production instance** `ins_3K3lTRa4SjQMndLMGMW7AQwOoHf` on `demo-sage.me`
   (created 2026-09-30 with `clerk deploy`). The five Clerk CNAMEs (`clerk`, `accounts`,
   `clkmail`, `clk._domainkey`, `clk2._domainkey`) are in the Vercel DNS zone; DNS, email
   and SSL all verified (`clerk.demo-sage.me` serves TLS). Production keys
   (`pk_live_`/`sk_live_`) are in `frontend/.env.local` and in Vercel **Production**; they
   take effect on the next deployment, after which the vercel.app alias no longer signs
   in (production Clerk is bound to the domain). **Still yours:** Google sign-in needs a
   production OAuth client from Google Cloud Console (`clerk deploy` shows the redirect URI
   to register, then asks for the client id and secret); email/password works without it.
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
10. **Discord: configure production** (`docs/discord.md` §3). Create the Discord
    application and bot, put `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`
    and `DISCORD_WEBHOOK_SECRET` in the root `.env`, create the three secrets in Secret
    Manager and add them to the API and worker `--set-secrets` in
    `deploy-staging.yml`, set the Interactions Endpoint URL, switch on the Message
    Content intent, invite the bot to the server, register the commands, then run `python scripts/discord_doctor.py --guild <id>`
    until every line passes and walk the five-minute manual check in §2.3.

## 4. Engineering backlog (OPEN / PLANNED)

Backend (`ARCHITECTURE_REFACTOR_PLAN.md` §3):

| # | Item | Status |
|---|---|---|
| B1a | `mode` on `/api/analyses` rows and `/api/jobs/{id}` | DONE 2026-10-01 (`api/routes/analyses.py` `match_mode`) |
| B1b | Job `stage` + `coach_status` / `coach_error` on `/api/jobs/{id}` (parse / coach / done / failed) | DONE 2026-10-01 (`api/routes/jobs.py` `coach_state`) |
| B1c | Team plan gate (402 + upgrade metadata) on team create, server spin-up and training sessions; join stays open; seats inherit the owner's season | DONE 2026-10-01 (`api/routes/{teams,servers,training_sessions}.py`, `tests/test_team_gates.py`) |
| B1e | Practice-server console: `GET/POST /api/servers/{id}/console` through DatHost's console API; console card on the server page | DONE 2026-10-01 (`services/warlord/dathost_client.py` `send_console_command`/`read_console`, `components/teams/ServerConsole.tsx`) |
| B1f | `DELETE /api/teams/{id}/members/{user}`: members leave, the captain removes; Team Settings has Leave and Remove with confirms | DONE 2026-10-01 |
| B1g | Opponent name on scouting uploads (`opponent` on presign → `matches.match_name`), returned on match rows; Opponents tab groups by opponent, map as the fallback | DONE 2026-10-01 |
| B1d | Server-hour caps per season (metering data first; see `docs/pricing.md`) | PLANNED |
| 3.1 | Move `agents/` into `services/coaching_ai`, `db/jobs.py` into `services/ingestion`; delete `api/agents/tactician_heuristics.py` and the Steam branch of `api/routes/oauth.py` | OPEN |
| 3.2 | import-linter contracts in CI; drop `\|\| true` from mypy | OPEN |
| 3.3 | Per-kill `is_trade` / `trade_window_ms`; `subtick_offset`; `tick_range` on pro examples | OPEN |
| 3.5 | Grounding metrics on the admin page (drop-rate, citation coverage) | OPEN |
| — | Rename `practice_servers.vultr_instance_id` → `provider_server_id` (cosmetic; migration) | PLANNED |

Frontend (`frontend/FRONTEND_REFACTOR_PLAN.md` §3, page specs in §6):

| # | Workstream | Status |
|---|---|---|
| W0–W5 | All shipped by the 2026-10-01 rewrite (see §2b and `FRONTEND_REFACTOR_PLAN.md` §0) | DONE |
| W6 | Capture matrix: assertions and the three-theme switch exist; CI schedule and an 11px label lint rule do not | PARTLY |
| D1 | Live listening (the bot reacting to messages or mentions as they are posted) needs a gateway connection in the worker plus the Message Content intent; `/strat ingest` is the chosen alternative. Revisit only if on-demand ingest proves too slow for the team | PLANNED |
| D2 | Forum channels as map channels (threads are created differently there); only text channels are mapped today | PLANNED |
| W7 | Clerk `UserButton` custom menu items (Settings / Plan / Theme) once `@clerk/nextjs` exposes them again; today they are navbar icons | PLANNED |
| W8 | Debrief Players table: ADR, utility damage, flash assists, trade rate need backend fields (`3.3`) | PLANNED |

## 5. Where the detail lives

| Document | Holds |
|---|---|
| `frontend/FRONTEND_REFACTOR_PLAN.md` | Root causes, workstreams, upload flow, theme slots, shell, debrief state machine, page-by-page spec (§6) |
| `frontend/UX_REVIEW.md` | Findings with screenshot evidence (§2, §6, §7), capture specs |
| `ARCHITECTURE_REFACTOR_PLAN.md` | Backend status vs the architect prompt, deviations, remaining backend work |
| `docs/discord.md` | Discord: channel-group model, commands, setup checklist, the three ways to test |
| `docs/pricing.md` | Competitor prices, decided prices, season model, Stripe checklist, metering rationale |
| `TECHNICAL_SPEC.md` §15 | One row per shipped decision (updated 2026-09-29) |
| `.claude/skills/demosage-frontend/SKILL.md` | Frontend rules and review checklist for future sessions |
