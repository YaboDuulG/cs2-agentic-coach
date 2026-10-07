# TASKS — status of everything in flight

Last updated 2026-10-07 (code at `main` = `dd068eb` plus this doc pass).
`docs/runbook.md` is the SOP: how releases, secrets, checks and routine
operations are done. This file is what is decided, shipped, open and yours.

Legend: **DONE** = merged to `main`, deployed, verified as the row says ·
**OWNER** = only you can do it · **OPEN** = engineering work not started ·
**PLANNED** = specified, not started.

**State of the tree**: nothing uncommitted. `frontend-rewrite` and
`discord-channel-groups` are both merged into `main` (fast-forward) and
deployed; the last three deploys (10-01, 10-06 ×2) were green. 460 backend tests
pass on `main`; the frontend lint, type check and build are clean.

## 1. Decisions taken (do not reopen)

| Decision | Detail |
|---|---|
| Pricing | Free $0 · Solo Pro **$10 / mo or $96 / yr** · Team **$300 flat per ESEA season** (one-time payment, hard paywall) |
| Seasons | ESEA calendar: S59 = 5 Oct – 20 Dec 2026, published S56–S59, projected 4 / year after; access runs until the next season starts |
| Team paywall | Creating a team, team uploads, scouting, servers, Discord all need a season; invited members inherit the owner's season. Enforced server-side (402 + upgrade metadata) |
| Coaching mode | Chosen at upload (Coach me / Coach my team / Scout an opponent), stored on the match, never a global toggle; "Coach me" needs a linked Steam ID |
| Scouting | Belongs to the team: uploaded from and listed in the Team Hub (Opponents tab), filed under the opponent's name |
| Debrief stages | parse → stats → coaching, one screen per outcome; a coaching failure shows no stats |
| Themes | CS2 default, CS:GO second, Great Khan third; fixed CT/T colours across themes |
| Admin | `/settings/admin` returns 404 to non-admins |
| Trials | Weekly single-use trial codes (Solo Pro or Team); referral link gives both sides 7 days of Solo Pro |
| Metering | Every Gemini call and every server hour is metered per team; no mock servers ever count |
| Discord | Command-only bot (HTTP interactions, no gateway): one channel per map in a bound channel group; `/strat ingest` reads history on demand instead of live listening |
| Identity | The API trusts the Next proxy (shared secret) for the user id; a Clerk-token caller may only act as itself |

## 2. Shipped (DONE, on `main`, deployed)

Verification column: "tests" = automated suite in `tests/`; "live" = checked on
the deployed product; "browser" = rendered locally with real or mocked data and
looked at; "—" = reviewed only. Rows marked "—" are not covered by a test; the
honest fix is in §4 (T1).

### 2a. Billing, metering, infrastructure (2026-09-29 → 10-01)

| Area | What | Files | Verified |
|---|---|---|---|
| Admin guard | Admin routes check the Clerk admin role server-side; non-admins get 404 | `frontend/lib/server/admin.ts`, `app/api/admin/*` | browser (404 shot) |
| Promo codes | Trial code minting/listing, redemption rules, referral codes, time-boxed `trialing` rows | `services/billing/promo.py`, `api/routes/{billing,admin}.py`, migration `a1c7e9b3d5f2` | tests (`test_promo.py`) |
| Referral UX | Invite card + redeem box on Settings → Plan; `/sign-up?ref=CODE` auto-redeems; admin Trial codes panel | `components/settings/PlanPanel.tsx`, `components/shell/ReferralRedeemer.tsx`, `components/admin/TrialCodesPanel.tsx` | browser |
| Seasons | Calendar + projection; season purchases via `/api/billing/sync`; `season_until` outranks Stripe fields | `services/billing/seasons.py`, `api/routes/billing.py` | tests (`test_seasons.py`, `test_billing_sync.py`) |
| Checkout | Solo Pro monthly/yearly subscription; Team one-time payment per season; refuses an owned season; webhook handles `mode: payment` | `app/api/billing/{checkout,webhook}`, `lib/flags.ts` | live (`--project=checkout`, test mode, 2026-09-30) |
| Pricing page | Prices, Monthly/Yearly toggle, season on sale with dates, "You have Season N"; upgrade modal | `app/billing/page.tsx`, `components/paywall/UpgradeModal.tsx` | browser |
| Metering | `llm_usage` for every Gemini call priced at config rates; server hours from sessions; per-team table with revenue and margin; editable rates | `services/billing/metering.py`, `components/admin/MeteringPanel.tsx` | tests (`test_metering.py`) |
| DatHost | No mock fallback: out of credits → 402; local/mock servers never billable; credits on the admin page | `services/warlord/dathost_client.py`, `api/routes/{servers,admin}.py` | tests (`test_dathost_credits.py`) |
| Go-live | Domain on Vercel DNS with certificates; Clerk production instance on the domain with Google OAuth; Stripe live prices and webhook; live keys on Vercel; CORS allowlist | `scripts/stripe_setup_prices.ps1`, `scripts/vercel_push_env.mjs` | live (Google sign-in and checkout tested 2026-10-01) |
| Owner upgrades | `spacemonkeyhandy@gmail.com` and `swiftergames15@gmail.com` granted Team Season 59 (until 2027-01-04) by the sync call the webhook makes, mirrored into Clerk | — | live (entitlements endpoint) |

### 2b. Frontend rewrite (2026-10-01)

Clean rewrite from `frontend/FRONTEND_REFACTOR_PLAN.md` §6; only `app/api/**`,
`lib/api/client.ts`, the playback store, `components/minimap/*` and the e2e
suites carried over. 25 legacy files deleted.

| Area | What | Files | Verified |
|---|---|---|---|
| Foundation | Tokens for three themes, fonts by role, primitives, identity marks, one shell | `app/globals.css`, `lib/theme/*`, `components/{ui,identity,shell}/*` | browser, all three themes |
| Data layer | Every read and mutation as a TanStack Query hook; `useJob` polls light then full | `lib/api/hooks.ts`, `lib/api/contract.md` | tsc |
| Upload | Two-step modal (who is it for → drop), locked Team cards, Steam-link gate, gzip + chunked upload; the Home drop zone carries a pre-hydration drop into the modal | `components/upload/*`, `lib/upload/useDemoUpload.ts` | live (339 MB demo through the pipeline spec) |
| Pages | Landing, Home, Matches, Debrief (3 stages), Teams + paywall, Team Hub (5 tabs), Training, Server (+ console), Stratbook, Settings, Admin, Billing, Sign in/up | `app/**`, `components/{home,matches,debrief,teams,stratbook,settings,admin}/*` | browser at 1440 and 390 |
| Backend support | `mode` on match rows; `stage`/`coach_status`/`coach_error` on jobs; Team gate; roster leave/remove; server console; opponent names | `api/routes/{analyses,jobs,teams,servers,training_sessions}.py` | tests (`test_team_gates.py`) |
| E2E | Setup signs the test user in through Clerk's Backend API (no CAPTCHA); specs wait for data; `E2E_EMAIL` reuses a user | `frontend/e2e/*` | run locally |

### 2c. Discord and replay lab (2026-10-02 → 10-06)

Audit found the Discord code complete but production never configured (no
secrets, no application). Now configured: application "Demo-Sage", secrets in
Secret Manager and on both services, Interactions Endpoint URL verified, commands
registered globally, the API kept warm for Discord's 3-second limit. Reference:
`docs/discord.md`.

| Area | What | Files | Verified |
|---|---|---|---|
| Channel groups | `/strat bind` in a category binds the group; channels named after maps are those maps' channels; threads open there; `/strat create` and `/strat view` take the map from the channel; `/strat channels` lists the mapping | `services/discord_bot/{channels,interactions,sync}.py`, migration `c5d8e2f4a7b1` | tests (`test_discord_channels.py`) |
| `/strat ingest` | Reads a channel's history since the last ingest (first run from the beginning), Gemini extracts strategies, saved to the team's knowledge base; per-channel cursor; chained runs; metered | `services/discord_bot/ingest.py` | tests (`test_discord_ingest.py`) |
| Review button | Submitting for review posts the embed with Approve | `services/discord_bot/sync.py` | tests |
| Web | Team-level status / bind code / unbind; Discord card shows the channel → map list | `api/routes/teams.py`, `components/teams/DiscordCard.tsx` | browser |
| Security | `/api/discord/webhook` fails closed without the secret (was open) | `api/routes/discord.py` | tests |
| End to end | Signed with a real Ed25519 key: bind → mapping → create → thread → review → Approve → ACTIVE; outage and recovery | `tests/test_discord_e2e.py`, `tests/discord_fakes.py` | tests |
| Doctor | `python scripts/discord_doctor.py [--guild id]`: PASS/FAIL report of settings, application, endpoint, intent, commands, channel group | `scripts/discord_doctor.py` | live (12/12 on 2026-10-06) |
| Replay lab | Per-map radar calibration, real radar image under the 2D tracks, names and sides from the roster, 3D kill view restored behind a 2D/3D toggle | `lib/maps.ts`, `components/minimap/*` | browser (owner's dust2 match) |

### 2d. Code-review backlog of 2026-10-06 (`demosage-task-list.md`)

Each claim checked against the code. Fixed and deployed (`dd068eb`):

| Item | Finding | Change | Verified |
|---|---|---|---|
| P0 identity header | Latent: production runs in shared-secret mode so only the proxies reach the API; with a Clerk key set, any user could have named another | `api/auth.py`: explicit `Principal`; a Clerk-token caller is refused when header, query or body names someone else; both modes work together | tests (`test_auth_identity.py`) |
| P0 RCON | The Warlord ran whatever Gemini returned | Allowlist with argument patterns for the LLM path; denylist of lock-out commands for everyone incl. the web console; no chaining; refusals reported | tests (`test_rcon_allowlist.py`) |
| P0 FACEIT signatures | Failed open without the secret | Fails closed outside local dev; missing header refused | tests (`test_faceit_webhook.py`), live (unsigned → 401) |
| P1 dead receiver | `/api/faceit/webhook` sat behind user auth | Deleted; `/api/faceit/status` reports the real path | tests |
| P1 dedupe, blocking HTTP | | Dedupe before the FACEIT lookup; the lookup runs off the event loop | tests |
| Found: FACEIT crashed on every match | Both paths wrote demo columns onto `Match` after the demo/match split | `create_faceit_match()` writes demo + match rows | tests |
| P1 supervisor routing | "observed" → server, "pasted" → past, "metadata" → meta | Whole-word `classify_intent()` | tests (`test_supervisor_routing.py`) |
| P2 strat reviewer prompt | Loose | Eight-point strat template with a strat-vs-tip verdict | — |
| P3 cleanup | | `ERROR` file, Vultr key in the deploy, Hetzner token on Vercel, pgvector docstring; audio upload endpoint removed (queued nothing) | — |

Judged, not done, with the decision recorded in §3 or §4: pro-benchmark copy
(§3.4), mypy swallow (§4 T2), CI requirements split (§4 T3), tactician
consolidation (§4 3.1), `vultr_instance_id` rename (§4), strat audit and
MapPlaybook content (§3.6).

## 3. Owner to-do (OWNER)

Open items only; done work moved to §2. In order of consequence.

1. **Discord: finish the server side.** Invite the bot with the link the doctor
   prints (scopes `bot` + `applications.commands`, permissions 309238104064),
   let it see the map channel group, then send the server id so the commands
   can be registered there instantly and the doctor run with `--guild`. Then
   the five-minute walk in `docs/discord.md` §2.3.
2. **Run the verification gate** in `docs/runbook.md` §4 once with your
   accounts: real demo report quality, FACEIT link, RCON probe on a test
   server, negative auth. These need a FACEIT account and a practice server.
3. **Cost rates** on `/settings/admin` → Cost rates: DatHost's per-hour price
   for the server size you use ($0.10 is a placeholder); confirm the DatHost
   `/account` credits field name (the panel says "credits not reported" if it
   differs; `get_account()` in `services/warlord/dathost_client.py`).
4. **Decide the pro-benchmark wording.** The debrief's "Benchmark" line shows
   seeded bootstrap values (tagged as such in the data, `agents/scribe/evidence.py`)
   plus RAG citations, and the landing, pricing and upgrade copy say "pro
   benchmarks". Options: label the number "estimated" in `FindingCard.tsx`, or
   soften the copy, or schedule backlog 3.3 to measure real pro aggregates.
5. **Referrer bonus**: both sides get 7 days today; `REFERRER_BONUS_DAYS` in
   `services/billing/promo.py` sets the referrer's share.
6. **Stratbook content**: audit the existing strat entries against the
   reviewer's template (strat / tip / mechanic) and decide the source of
   `MapPlaybook` rows (pro demos, hand-authored, both). Data, not code.
7. **Local hygiene**: recreate the repo `.venv` (`py -3.13 -m venv .venv`),
   remove `VULTR_API_KEY` from the root `.env` (nothing reads it), and switch
   `frontend/.env.local` back to Stripe test keys when testing checkout locally.

Done and moved out of this list on 2026-10-07: Stripe test and live setup,
Clerk production instance, Google OAuth, domain, Discord secrets and endpoint,
dead credentials on Vercel and in the deploy, the staging migration (the
migrate job runs on every deploy).

## 4. Engineering backlog (OPEN / PLANNED)

Backend (`ARCHITECTURE_REFACTOR_PLAN.md` §3):

| # | Item | Status |
|---|---|---|
| B1d | Server-hour caps per season (metering data first; `docs/pricing.md`) | PLANNED |
| 3.1 | Move `agents/` into `services/coaching_ai`, `db/jobs.py` into `services/ingestion`; delete `api/agents/tactician_heuristics.py` + `api/routes/fcr.py` once diffed against `services/tactician/`; delete the Steam branch of `api/routes/oauth.py` | OPEN |
| 3.2 | import-linter contracts in CI | OPEN |
| 3.3 | Per-kill `is_trade` / `trade_window_ms`; `subtick_offset`; `tick_range` on pro examples; measured pro baselines replacing the bootstrap rows | OPEN |
| 3.5 | Grounding metrics on the admin page (drop-rate, citation coverage) | OPEN |
| — | Rename `practice_servers.vultr_instance_id` → `provider_server_id` (migration + deploy window) | PLANNED |
| — | Comms Analyst (Phase 5): design in `TECHNICAL_SPEC.md` §5.3; endpoint removed until the job exists | PLANNED |

Tests and tooling:

| # | Item | Status |
|---|---|---|
| T1 | Automated coverage for the "—" rows in §2: checkout proxy (mock Stripe), pricing page render, referral redeem, admin 404 | OPEN |
| T2 | Fix the 62 pre-existing mypy errors (mostly SQLAlchemy typing in `api/routes/teams.py`, `db/qdrant_client.py`, `agents/khan/nodes.py`), then drop `\|\| true` from CI | OPEN |
| T3 | `requirements-ci.txt` omits GCP/ML packages on purpose; either a two-stage install or an import smoke test of `requirements.txt` in CI | PLANNED |
| T4 | Screenshot suites on a CI schedule against the deployed app; 11px label lint rule (W6) | PARTLY |

Frontend (`frontend/FRONTEND_REFACTOR_PLAN.md`):

| # | Item | Status |
|---|---|---|
| D1 | Live Discord listening (gateway in the worker); revisit only if `/strat ingest` proves too slow for the team | PLANNED |
| D2 | Forum channels as map channels | PLANNED |
| W7 | Clerk `UserButton` custom menu items once `@clerk/nextjs` exposes them again | PLANNED |
| W8 | Debrief Players table: ADR, utility damage, flash assists, trade rate (needs 3.3) | PLANNED |
| R1 | Radar calibration for maps outside the active pool (only de_dust2 verified against a demo; the others use published offsets) | PLANNED |

## 5. Where the detail lives

| Document | Holds |
|---|---|
| `docs/runbook.md` | SOP: topology, release procedure, secret map, rollback, go-live checklist, verification gate, routine operations, incident checks |
| `docs/discord.md` | Discord: channel-group model, commands, `/strat ingest`, setup checklist, the three ways to test |
| `docs/pricing.md` | Competitor prices, decided prices, season model, Stripe checklist, metering rationale |
| `frontend/FRONTEND_REFACTOR_PLAN.md` | §0 status of the rewrite; target IA, upload flow, theme slots, debrief state machine, page map (§6) |
| `frontend/UX_REVIEW.md` | Pre-rewrite findings with screenshot evidence (superseded; kept for the ids) |
| `frontend/lib/api/contract.md` | What every proxy route returns |
| `ARCHITECTURE_REFACTOR_PLAN.md` | Backend status vs the architect prompt, deviations, remaining backend work |
| `TECHNICAL_SPEC.md` §15 | One row per shipped decision |
| `.claude/skills/demosage-frontend/SKILL.md` | Frontend rules and review checklist for future sessions |
