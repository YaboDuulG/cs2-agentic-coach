# DemoSage runbook (SOP)

Last updated 2026-10-07. The standing procedures for shipping, operating and
checking DemoSage. `TASKS.md` says what is in flight; this file says how things
are done. Nothing here contains a secret; it names where each one lives.

## 1. Topology

| Part | Where | Deployed by | URL |
|---|---|---|---|
| Frontend (Next.js) | Vercel project, production = `main` | Vercel on push to `main` | https://demo-sage.me |
| API (FastAPI) | Cloud Run `demosage-api-staging`, us-central1, min 1 instance | `deploy-staging.yml` on push to `main` | https://demosage-api-staging-dsr6wo6mta-uc.a.run.app |
| Worker (parse + coach + Discord outbox) | Cloud Run `demosage-worker-staging`, same image as the API, 1–3 instances | same workflow | internal |
| Demo parser (Go) | Cloud Run `demosage-parser-staging` | same workflow | internal (ID token) |
| Database | Cloud SQL Postgres `demosage-db` | migrate job in the workflow | via Cloud SQL connector |
| Vectors | Qdrant Cloud | manual | — |
| Auth | Clerk production instance `ins_3K3lTRa4SjQMndLMGMW7AQwOoHf` on demo-sage.me; dev instance for localhost and e2e | portal | — |
| Billing | Stripe live mode, prices by lookup key `demosage_solo_monthly` / `_solo_yearly` / `_team_season` | `scripts/stripe_setup_prices.ps1` | — |
| Discord | Application 1556757560240111626 ("Demo-Sage"), interactions endpoint on the API | `scripts/register_discord_commands.py` | — |

The one Cloud Run environment is named "staging" for historical reasons; it is
what production traffic uses. There is no separate production backend.

## 2. Release procedure

Every change follows this path. Nothing is pushed to `main` directly.

1. **Branch** from `main`: `git checkout -b <topic>`.
2. **Checks on the branch**, all four, before calling it done:
   ```
   ruff check .
   mypy agents/ api/ db/            # read the output; CI ignores it
   pytest tests/ -v --tb=short
   cd frontend && npm run lint && npx tsc --noEmit && npx next build
   ```
   `next build` needs the two CI dummy Clerk variables from `ci.yml`.
3. **Browser check** for any frontend change: run `next dev` with the dev Clerk
   keys (`frontend/.env.e2e`), then
   `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --project=shots --project=shots-mobile`
   (`--project=team-shots*` for Team Hub, `E2E_EMAIL=<user>` to reuse a user
   with a team). Look at the screenshots in all three themes.
4. **Commit on the branch, push, wait for CI** ("CI — Lint & Test") to be green.
   A job cancelled with no steps run is a runner shortage, not a failure:
   re-run it (`gh run rerun <id> --failed`).
5. **Fast-forward `main`**: `git merge-base --is-ancestor origin/main <topic>`
   must be true, then `git push origin <topic>:main`. If it is not true,
   `git merge origin/main` on the branch first and repeat step 4.
6. **Watch the deploys**: `gh run list --branch main --limit 2` until both
   "CI — Lint & Test" and "Deploy — Cloud Run (Staging)" are green (the deploy
   takes about seven minutes). Vercel deploys on its own.
7. **Post-deploy checks** (section 5, "after every deploy").

### Schema changes

The migrate job in `deploy-staging.yml` runs `Base.metadata.create_all` plus an
explicit `ALTER TABLE … ADD COLUMN IF NOT EXISTS` list. A new table needs
nothing; a new column on an existing table needs a line in that list and an
Alembic migration in `db/migrations/versions/` for the record. Dropping or
renaming columns needs a deploy window and a real migration (none pending).

### Secrets

Add a secret, never a value, to the repo. The map:

| Secret | Lives in | Read by |
|---|---|---|
| `DATABASE_URL`, `API_SHARED_SECRET`, `GEMINI_API_KEY`, `LANGCHAIN_API_KEY`, `DATHOST_EMAIL`, `DATHOST_PASSWORD`, `GCS_BUCKET`, `DISCORD_PUBLIC_KEY`, `DISCORD_WEBHOOK_SECRET` | Secret Manager → API `--set-secrets` | API |
| `DATABASE_URL`, `API_SHARED_SECRET`, `GEMINI_API_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_SECRET` | Secret Manager → worker `--set-secrets` | worker |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (live), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `API_SHARED_SECRET`, `DATABASE_URL`, `GEMINI_API_KEY`, `DATHOST_*`, `STEAM_API_KEY`, `CRON_SECRET`, `ADMIN_PROVISION_SECRET` | Vercel Production | Next.js server routes |
| Local copies of all of the above plus `DISCORD_APP_ID` | root `.env`, `frontend/.env.local` (live), `frontend/.env.e2e` (dev Clerk) | scripts, local dev |

To add a Cloud Run secret: `gcloud secrets create NAME --data-file=-` (paste,
no trailing newline), grant `roles/secretmanager.secretAccessor` to
`demosage-dev@demosage-cs2.iam.gserviceaccount.com`, add `NAME=NAME:latest`
to the right `--set-secrets` list, deploy. A secret named in the list that does
not exist fails the deploy. To add a Vercel secret:
`node scripts/vercel_push_env.mjs` (a shell pipe leaves a `\r` in the value).

### Rollback

- **Backend**: `gcloud run services update-traffic demosage-api-staging --region us-central1 --to-revisions <previous>=100`
  (same for the worker). `gcloud run revisions list --service demosage-api-staging` shows them.
- **Frontend**: `npx vercel rollback` from `frontend/`, or promote the previous
  deployment in the Vercel dashboard.
- **Code**: revert on a branch and go through section 2 again; never force-push `main`.

## 3. Go-live checklist (for any change to auth, billing or domains)

Done once on 2026-09-30/10-01 in this order; repeat the relevant rows for a
change to any of these systems.

| Step | How to verify |
|---|---|
| Domain on Vercel with certificates | `curl -sI https://demo-sage.me` is 200 with a valid certificate |
| Clerk production instance bound to the domain, CNAMEs verified | Clerk dashboard shows DNS, email and SSL green; the served HTML carries a `pk_live_` key |
| Google OAuth client registered in Clerk | sign in with Google on production succeeds |
| Stripe live prices exist under the lookup keys | `stripe prices list --lookup-keys …` (live key) |
| Stripe live webhook at `https://demo-sage.me/api/billing/webhook` | Stripe dashboard shows recent 200s |
| Vercel Production holds live keys | `npx vercel env ls production` lists them (values hidden) |
| Checkout works end to end | `npx playwright test --project=checkout` against a **test-mode** deployment only; never the live card path |
| Entitlements reflect a purchase | `/api/billing/entitlements?user_id=…` through the proxy shows the tier |
| Discord | `python scripts/discord_doctor.py --guild <id>` 13/13 |

## 4. Verification gate (live checks that need the owner's accounts)

Run after a deploy that touches the area, and once a season.

- [ ] **Report quality**: upload one real match demo (Coach me); every finding
      cites a round and clock, the Players table and Kill map populate, no
      "coaching failed" screen. Flag any claim without an evidence id.
- [ ] **Upload flow**: the same demo a second time dedupes (no second parse);
      a corrupt `.dem` shows the "couldn't parse" screen.
- [ ] **Free-tier gating**: a Free user's third upload in a month is refused with
      the upgrade modal, not a 500.
- [ ] **FACEIT**: link the account in Settings, then a finished match arrives via
      `/api/webhooks/faceit` (Stripe-style signed) and is queued once.
- [ ] **RCON safety**, on a test server only: "pause the match" through the
      Warlord runs; "quit the server" is refused and reported.
- [ ] **Negative auth**: expired Clerk session → 401 from a proxy; unsigned
      FACEIT or Discord request → 401; the API refuses an identity header that
      does not match a Clerk token (`tests/test_auth_identity.py` covers the unit).
- [ ] **Discord**: the five-minute walk in `docs/discord.md` §2.3.

## 5. Routine operations

**After every deploy**

```
curl -s https://demosage-api-staging-dsr6wo6mta-uc.a.run.app/api/health   # 200
curl -s -o /dev/null -w "%{http_code}" https://demo-sage.me/              # 200
python scripts/discord_doctor.py                                          # 12/12 (13 with --guild)
gcloud run services logs read demosage-worker-staging --region us-central1 --limit 50 | grep -i "failed\|error"
```

**Weekly**: mint the trial codes on `/settings/admin` → Trial codes (single use,
Solo Pro or Team, expiry date). Post them wherever the week's giveaway goes.

**Monthly**: the Vercel cron `/api/cron/reset-quotas` resets free-tier upload
counts on the 1st; check its log line in the Vercel dashboard. Look at
`/settings/admin` → Team metering: Gemini spend, server hours and margin per
team; adjust the cost rates there if DatHost or Gemini prices changed.

**Each ESEA season**: when ESEA publishes the next calendar, add it to
`KNOWN_SEASONS` in `services/billing/seasons.py` and deploy. Until then the
calendar is projected (13-week cadence) and the pricing page shows the
projected dates. Team access runs until the next season starts, so a late
update never locks a paying team out.

**Monthly in Stripe**: confirm the webhook endpoint has no failed deliveries;
a failed `checkout.session.completed` means a paid user without the tier (fix:
`POST /api/billing/sync` with the session's user and plan, as the webhook does).

**Grant a plan by hand** (comp, refund-and-keep, partner): the same call the
webhook makes, then mirror the chip into Clerk, as done for the two owner
accounts on 2026-10-01; see TASKS.md §2 "Owner upgrades".

## 6. Incident checks

| Symptom | First look |
|---|---|
| Uploads stuck on "Analysing" | worker logs; `sync_outbox` / jobs table for `failed` rows; parser service health |
| Debrief says "Coaching didn't finish" | `coach_error` on the job; Gemini quota; the "Re-run coaching" button re-queues |
| Discord command "application did not respond" | API cold or slow (min instance must be 1); `discord_doctor.py`; interactions must answer in 3 s |
| Discord thread never appears | worker outbox: `SELECT * FROM sync_outbox WHERE status != 'done'`; bot permissions in the channel group |
| Checkout 500 | missing `STRIPE_PRICE_*` on Vercel; Stripe dashboard logs for the session |
| 401s from the API through the site | `API_SHARED_SECRET` differs between Vercel and Secret Manager (`\r` is the usual cause) |
| Practice server 402 | DatHost credits (admin page shows the balance); not a bug |

## 7. Local development

- Backend: `scratchpad`-style venv on Python 3.13 with `requirements-ci.txt`
  (the repo `.venv` may point at a removed interpreter; recreate it with
  `py -3.13 -m venv .venv`). `LOCAL_MODE=true` skips GCS, Cloud Tasks and
  Discord REST; the Discord interactions endpoint then accepts unsigned requests.
- Frontend: `next dev` with the **dev** Clerk keys (`frontend/.env.e2e`), the
  Cloud Run API as backend and Stripe unset; the live keys in
  `frontend/.env.local` refuse localhost. The e2e setup signs the test user in
  through Clerk's Backend API, so no CAPTCHA.
- Never commit values from any `.env`; `.env.example` lists the names.
