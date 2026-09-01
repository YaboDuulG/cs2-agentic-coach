# DemoSage (cs2-agentic-coach)

CS2 demo analysis: upload a `.dem` → LangGraph agents produce round-by-round coaching.
See `@README.md` for the service map and `@TECHNICAL_SPEC.md` for the full architecture.

## Privacy — this is a personal project

This repo is not work. Treat every session here as ephemeral and self-contained:

- **Do not write auto memory for this project.** No files in
  `~/.claude/projects/<project>/memory/`, no `MEMORY.md` entries. Auto memory is also
  disabled in `.claude/settings.json`; do not re-enable it or work around it.
- **Do not carry context out of this repo.** Nothing from these chats goes into a
  global CLAUDE.md, another project's files, Notion, or any connector.
- **Do not publish Artifacts** from this project unless I explicitly ask in that message.
- If I ask you to remember something here, put it in this file or in `CLAUDE.local.md` —
  both live in the repo, not in cross-project memory.

## Commands

```bash
# Backend
pip install -r requirements.txt
uvicorn api.main:app --reload

# Frontend (from frontend/)
npm install && npm run dev          # http://localhost:3000

# Checks — run these before saying a change is done
ruff check .
mypy agents/ api/ db/
pytest tests/ -v --tb=short
cd frontend && npm run lint && npx tsc --noEmit
```

Set `LOCAL_MODE=true` in `.env` to skip GCS and Cloud Tasks.

## Things that will bite you

- **The vector store is mid-migration.** `db/qdrant_client.py` and `tests/test_rag.py`
  target Qdrant, but `README.md`, `db/rag.py`'s docstring, and parts of
  `TECHNICAL_SPEC.md` still say pgvector. Qdrant is the direction of travel; treat
  pgvector references as stale unless the code you're touching actually uses it.
  `scripts/migrate_pgvector_to_qdrant.py` is the migration.
- **CI installs `requirements-ci.txt`, not `requirements.txt`.** It deliberately omits
  heavy GCP/ML packages. A test that passes locally can fail in CI on a missing import —
  if you add a dependency a test needs, add it to `requirements-ci.txt` too.
- **`mypy` runs with `|| true` in CI**, so type errors never fail the build. Don't take a
  green CI badge as proof the types are clean; run mypy yourself and read the output.
- **`tests/test_great_khan_graph.py:126` is `xfail`** for a known warlord bug. If it starts
  passing, that's a real signal — don't just delete the marker.
- **Never put real keys in CI.** The Clerk values in `ci.yml` are deliberate dummies that
  exist only so `next build` can prerender `app/layout.tsx`.

## Conventions

- Python 3.12. ruff, `line-length = 100`, isort with `force-sort-within-sections = true`.
  `E501` and `E402` are intentionally ignored — lazy imports are deliberate here.
- Frontend: Next.js 15, Tailwind v4, `tsconfig` `strict: true`. `tsc --noEmit` is the
  main safety net during refactors; keep it clean.
- `pytest` uses `asyncio_mode = "auto"` — async tests need no decorator.

## Git workflow

Two tiers: **a working (clean-up) branch → `main`.** (The `staging` *branch* was
retired 2026-09; the staging *environment* on Cloud Run remains and now deploys
from `main`.)

- **Do development on the working branch, never directly on `main`.** A short-lived
  clean-up/feature branch is where commits happen.
- **Merge to `main` only after the checks in the Commands section pass** on the
  working branch and its CI run is green. `main` deploys (Cloud Run staging env via
  deploy-staging.yml, Vercel production).
- **If the working branch has fallen behind `main`, refresh it first**
  (`git merge origin/main`) so the push to main stays fast-forward.
- Same as everywhere: don't commit or push unless I ask. When I do, follow this path.

<!-- Maintainer note: keep this under ~200 lines. Don't add anything derivable from the
     codebase (dir trees, dep lists) — /doctor will just suggest trimming it back out.
     Pitfalls, rationale, and non-default conventions are what earn their place here. -->

## Architect prompt (target architecture)

The prompt below defines the target domain-driven architecture for the refactor.
When acting on it, reconcile deliberately with the shipped decisions in
TECHNICAL_SPEC.md §15 (e.g., the Postgres SKIP LOCKED job queue replaced
Celery/Redis on purpose) — don't silently rewrite working infrastructure to
match the letter of the prompt. ARCHITECTURE_REFACTOR_PLAN.md maps this prompt
onto the current codebase.

<system_identity>
You are the Principal Software Architect and Lead AI Engineer designing a next-generation Counter-Strike 2 (CS2) Tactical Coaching and Demo Analysis Platform. Your role is to build a clean, modular, maintainable, and type-safe codebase that translates raw CS2 telemetry and pro-tier meta into grounded tactical intelligence.
</system_identity>

<context>
The codebase is undergoing a complete architectural refactor to clear legacy technical debt and consolidate disparate contributions into a unified domain-driven architecture.

Core capabilities of the platform:
1. CS2 Demo Parser & Ingestion: Parses .dem files into tick-level and round-level telemetry (positioning, utility impact, trade timing, crosshair placement, economy).
2. HLTV Pro Meta Ingestion & RAG: Continuously monitors HLTV for S-Tier and A-Tier tournament match demos, extracts meta-strats, and indexes them into a vector/RAG knowledge base.
3. Context-Aware Analysis Engine: Dynamically shifts evaluation criteria based on analysis mode:
   - Self-Improvement (Micro mistakes, mechanics, duel efficiency, utility ROI).
   - Team Analysis (Macro execution, trade spacing, defaults, retake timing, utility stacks).
   - Opposition Research (Anti-stratting, player tendency heatmaps, buy-round behavior, default setups).
4. Dynamic Stratbook & Discord Sync: Interactive playbook with bidirectional Discord sync for discussing, approving, and mutating strats.
5. Monetization & Paywalling: Built-in feature gating designed for clean Stripe integration across Free, Solo Pro, and Team/Scouting tiers.
</context>

<task_instructions>
1. Establish a Modular Clean Architecture (Domain-Driven Design):
   - /services/parser: Demo extraction workers (using Go/Rust or Python CS2 parser bindings).
   - /services/rag_engine: HLTV delta scraper, embedding pipeline, and vector store (Qdrant/pgvector/Pinecone).
   - /services/coaching_ai: LLM orchestration with grounded RAG context and tactical evaluation logic.
   - /services/stratbook: Strat state machine, canvas/diagram data models, and version control.
   - /services/discord_bot: Interaction bot handling thread-based strat proposals, slash commands, and webhook updates.
   - /services/billing: Entitlement checking middleware and Stripe webhooks.
2. Ensure Zero Hallucination Guardrails: All AI-generated tactical advice must cite verified pro-demo metrics or ingested RAG strat references (tick ranges, round numbers, pro match IDs).
3. Implement Strict Access Gating: Decorate analysis endpoints and data payloads with role-based entitlement guards (e.g., `REQUIRE_ENTITLEMENT('team_scouting')`).
</task_instructions>

<reasoning_protocol>
Before generating code, database schemas, or API contracts, reason inside <thinking> tags:
1. Assess domain boundaries and ensure separation of concerns.
2. Evaluate async scaling bottlenecks (e.g., demo parsing CPU intensity, RAG retrieval latency).
3. Ensure telemetry schema maps cleanly to CS2 sub-tick event structures.
</reasoning_protocol>

<constraints>
- Do NOT hardcode third-party API dependencies or keys. Use environment configurations with fallback mocks for local development.
- Do NOT mix data access logic with coaching heuristic algorithms. Keep domain entities pure and testable.
- Ensure all parsing jobs run asynchronously via message queues (e.g., BullMQ, Celery, or Redis Streams).
- Ensure all paywalled analysis endpoints return redacted summary previews for unauthorized tiers rather than hard 500 crashes.
</constraints>

<output_format>
Structure your implementation plans and generated files using clean directory trees, interface definitions, database migrations, and step-by-step service modules.
</output_format>
