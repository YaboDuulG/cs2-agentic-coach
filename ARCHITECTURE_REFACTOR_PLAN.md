# Architecture Refactor Plan — Domain-Driven Consolidation

Executes the architect prompt in CLAUDE.md against the *actual* codebase. Reconciled
against the tree and TECHNICAL_SPEC §15 on 2026-09-29: the original five-phase plan was
written before modules 3–6 shipped, and most of phases 2–5 landed under different names.
This revision records what exists, what was deliberately done differently, and what is
still open — so nobody re-implements a shipped phase or "fixes" a decision.

Reading order: §1 tells you what not to touch. §3 is the work. §4 is how it ships.

## 1. Status of the original plan

| Prompt requirement | Status | Where it lives today |
|---|---|---|
| Parser as a pure Go function | **Shipped** | `services/demo-parser` (demoinfocs-golang v5, GameStateGate, PlayerHurt/PlayerFlashed) |
| Async ingestion via a queue | **Shipped, deviated** | Postgres `jobs` + SKIP LOCKED in `db/jobs.py`, drained by `services/worker` (§15 "Background Jobs"). Not Celery/Redis — see §2 |
| HLTV delta monitor + RAG index | **Shipped** | `services/rag_engine/` (delta_monitor, extractor, vectorizer, hybrid `retrieval.retrieve_pro_comps`), `services/hltv_watcher/crawler.py` |
| Context-aware analysis modes | **Shipped** | `agents/scribe/modes.py` (`AnalysisMode`, `MODE_SPEC`), derived in the worker from match facts |
| Zero-hallucination guardrails | **Shipped (core)** | evidence pack + citation contract + verification pass (`agents/scribe/evidence.py`, `report_generator.py`); pro examples carry `pro_match_id` |
| Entitlement guard + redacted previews | **Shipped** | `services/billing/entitlements.py` (`require_entitlement`, `redact_coaching_payload`, teasers); `subscriptions` table is the authority |
| Stripe webhooks | **Shipped, deviated** | Next.js keeps the Stripe SDK; `/api/billing/sync` fan-out writes `subscriptions` |
| Stratbook state machine + versioning | **Shipped** | `services/stratbook/service.py`, `strats` / `strat_revisions` (migration `a9d3e7b1c552`) |
| Discord bidirectional sync | **Shipped, deviated** | `services/discord_bot/` HTTP Interactions + `sync_outbox` — no gateway bot |
| Modular service tree (`/services/*`) | **Half done** | `billing`, `stratbook`, `discord_bot`, `rag_engine` exist; the coaching core is still `agents/` and the queue is still `db/` |
| Import contract in CI | **Not started** | no import-linter; `mypy` still runs with `\|\| true` |
| Sub-tick / trade telemetry | **Partially** | `hitgroup`, `blind_duration`, `avg_trade_window_s` shipped (`b7f4d2e8a901`); no per-kill `subtick_offset` / `is_trade` |
| Grounding metrics dashboard | **Not started** | drop-rate is logged, nothing aggregates it |

Migrations in the original plan were numbered `0007`–`0010`; Alembic here uses hash
revisions. Mapping: `0007 user_entitlements` → `e8c2b5d90f14_subscriptions`;
`0008 strat_versioning` → `a9d3e7b1c552_stratbook_discord_sync`;
`0009 subtick_and_tradetiming` → `b7f4d2e8a901_telemetry_v2` (partial, see §3.3);
`0010 pro_match_registry` → `f2b9d0c8a417_pro_meta_tables`.

## 2. Deviations from the prompt (deliberate — keep them)

Each is logged with its reason in TECHNICAL_SPEC §15; summarised here so the prompt's
letter is never re-applied by accident.

- **Queue: Postgres SKIP LOCKED, not BullMQ/Celery/Redis Streams.** One fewer stateful
  service; transactional with match rows; observable via SQL. Revisit only past ~1k jobs/s.
- **Entitlement cache: in-process TTL, not Redis.** DB row is the truth; the sync
  endpoint invalidates. Same "no second stateful service" reasoning.
- **Discord: HTTP Interactions endpoint, not a gateway bot.** Scale-to-zero on Cloud Run,
  no always-on process. Cost: no free-text @mention listening (`/strat adapt` instead).
- **Stripe: signature verify + SDK stay in Next.js**, normalized events POST to
  `/api/billing/sync`. The Python side never calls Stripe.
- **Vector store: Qdrant with BM25 fallback, no Pinecone, pgvector references are stale.**
  Retrieval is hybrid (dense + in-module BM25, RRF-fused); either leg may be absent.
- **Retriever `Protocol` from the original §2 was not built.** `retrieve_pro_comps` plus
  metadata filters is the seam; a Protocol adds nothing until a second store exists.
- **`user_entitlements` table was not built.** `subscriptions` + `TIER_ENTITLEMENTS`
  matrix covers it. Do not add a second authority.

## 3. Remaining work

Ordered by value over risk. Each item is independently shippable through the git
workflow in CLAUDE.md.

### 3.1 Finish the move map (mechanical, low risk)

Target tree after this step (only the parts that still move):

```
services/
├── coaching_ai/
│   ├── orchestrator/    ← agents/khan/{graph,nodes,llm,prompts,stats,main}.py
│   ├── heuristics/      ← services/tactician/*  (already pure: no db/httpx imports — keep it so)
│   ├── scribe.py        ← agents/scribe/report_generator.py
│   ├── evidence.py      ← agents/scribe/evidence.py
│   ├── modes.py         ← agents/scribe/modes.py
│   └── state.py         ← agents/state.py
├── ingestion/
│   ├── queue.py         ← db/jobs.py (+ db/outbox.py stays with discord_bot or moves here)
│   ├── parse_worker.py  ← services/worker/parse_handler.py
│   └── faceit_crawler.py   (already here)
├── mcp/server.py        ← agents/mcp_server.py  (pyproject `demosage-mcp` entry point updates)
└── worker/runner.py     stays: it is the process, not a domain
```

Do it with import shims for one release (`agents/khan/__init__.py` re-exporting from the
new path), then delete `agents/`. Callers to update: `services/worker/runner.py`,
`api/routes/chat.py`, `services/hltv_watcher/crawler.py`, `services/rag_engine/worker.py`,
seven tests, `pyproject.toml` (`[project.scripts]`, `[tool.mypy] exclude` — `services/`
is currently excluded from mypy, which would silently un-type the whole coaching core
after the move; narrow the exclude to `services/demo-parser`).

Delete while you are there (verified unreferenced):
- `api/agents/tactician_heuristics.py` — "Phase 4" heuristics superseded by
  `services/tactician`; nothing imports it.
- the Steam branch of `api/routes/oauth.py` — §15 records it could never complete;
  Steam sign-in lives in Next.js (`/api/steam/*`). Keep the FACEIT branch.

### 3.2 Enforce the boundary (CI)

- Add `import-linter` to `requirements-ci.txt` with three contracts: `api` may import
  `services`; `services.coaching_ai.heuristics` and `services.stratbook.models` import
  neither `sqlalchemy.orm` sessions nor `httpx`; `services.*` never import `api`.
- Drop `|| true` from the mypy step once 3.1 lands and the baseline is clean. CLAUDE.md
  already warns that green CI proves nothing about types today.

### 3.3 Telemetry the prompt asks for and the coach cannot yet cite

- **Per-kill trade tagging.** `is_trade` / `trade_window_ms` on `kills` (parser emits
  tick + attacker/victim; the worker can derive it exactly as `features_v2` derives
  `avg_trade_window_s`). Today the frontend recomputes trades client-side in
  `DuelExplorer`, so the report and the table can disagree. Derive once, server-side.
- **Sub-tick offset on kills.** Nothing in the repo reads or stores it. demoinfocs v5
  exposes it on the event; add `subtick_offset FLOAT NULL` and thread it through
  `parse_handler`. Low value until a heuristic consumes it — schedule after trades.
- **Citation `tick_range` on pro examples.** `pro_match_id` is enforced; verify
  `tick_range` is populated by the extractor before claiming the §5 contract is complete.

### 3.4 One plan vocabulary end to end

The backend speaks `FREE / SOLO_PRO / TEAM`; the frontend speaks `free / basic / pro`
(`lib/flags.ts`, Clerk `publicMetadata.plan`, the Navbar chip, `/billing`). `flags.ts`
also says `aiCoaching: false` for `basic` while the entitlement matrix grants
`FULL_COACHING` to `SOLO_PRO` and the pricing page sells it. Upload quotas are enforced
in `app/api/upload/route.ts` from Clerk metadata, not from `services/billing`.

Fix: the Next.js server routes map Clerk's plan to the tier once (they already set
`x-user-plan`); `flags.ts` becomes a display table keyed by tier and stops carrying
capability booleans; quota checks call the API (`/api/billing/entitlements`) instead of
reading Clerk. Frontend detail in `frontend/UX_REVIEW.md` §3.

### 3.5 Grounding metrics

Aggregate what the verification pass already logs: drop-rate, citation coverage
(% findings with ≥1 evidence id), pro-attribution rate. Persist per coaching run on the
`jobs` row (`result_json`) and expose on `/settings/admin`. No new infrastructure.

### 3.6 Frontend

Tracked in `frontend/FRONTEND_REFACTOR_PLAN.md` (the plan), `frontend/UX_REVIEW.md`
(the evidence) and `frontend/DESIGN_PLAN.md` (design system of record). Backend items
that plan depends on, all small and shippable now (its row "B1"):

- `mode` on `/api/analyses` rows and `/api/jobs/{id}` (derive with the same rule as
  `agents/scribe/modes.py::derive_mode`; today only `report_v2` carries it).
- `GET /api/billing/entitlements` for the current user, so the upload picker can lock
  Team and Scouting without reading Clerk metadata.
- Job `stage` (`parse | stats | coaching`) and `failure_reason` on `/api/jobs/{id}`, so
  the debrief renders one screen per outcome instead of inferring state from which
  fields are present. A coaching failure must not look like a finished parse.
- **Pricing (owner decision 2026-09-29): Solo Pro $10 / month or $96 / year; Team
  $300 flat per ESEA season, one-time payment, hard paywall.** Shipped the same day:
  `services/billing/seasons.py` (published 2026 calendar + projection),
  `subscriptions.season` / `season_until` (migration `a1c7e9b3d5f2`), season purchases
  through `/api/billing/sync`, `/api/billing/seasons`, `/api/billing/entitlements`,
  promo + referral codes (`services/billing/promo.py`). Still open:
  `require_entitlement(TEAM_ANALYSIS)` on team create and on server/training routes
  (join stays open so seat inheritance keeps working), and the three Stripe prices in
  the dashboard (`docs/pricing.md`). `TIER_ENTITLEMENTS` is unchanged.
- **Admin role check on `/api/admin/*`.** Today any signed-in user can read and write
  the coaching prompts, model and temperature: the Next.js route checks only for a
  session and FastAPI checks only the shared secret. Pass the Clerk role through and
  reject non-admins server-side, not just in the page.

## 4. Verification per item

Same gates CI runs: `ruff check .`, `mypy agents/ api/ db/` (read the output), `pytest
tests/ -v`, Go build+vet+test, `npm run lint && npx tsc --noEmit && next build`. Contract
tests for 3.1: heuristics against fixture telemetry with zero DB; after 3.2 the import
contracts themselves are the test.

Local environment note (2026-09-29): the repo's `.venv` points at a Python 3.14 base that
is no longer installed, so the backend checks cannot run from it until it is recreated
(`py -3.12 -m venv .venv`, then `pip install -r requirements.txt`). `frontend/node_modules`
was missing `recharts` and `@playwright/test` until `npm install` was re-run, and a stale
`.next/types` referenced deleted routes — delete `.next` before trusting `tsc`.
