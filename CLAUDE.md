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

Work flows through three tiers: **a working (clean-up) branch → `staging` → `main`.**

- **Do development on a working branch, never directly on `staging` or `main`.** A
  short-lived clean-up/feature branch is where commits happen.
- **Merge the working branch into `staging` when it's ready.** `staging` is the
  integration branch — the place changes come together and get exercised.
- **Promote `staging` to `main` only after the work is verified on `staging`** and the
  checks in the Commands section pass. `main` is the release branch.
- **If `staging` or the working branch has fallen behind `main`, refresh it from `main`
  first** (`git merge main`) so you build on current code.
- Same as everywhere: don't commit or push unless I ask. When I do, follow this path.

<!-- Maintainer note: keep this under ~200 lines. Don't add anything derivable from the
     codebase (dir trees, dep lists) — /doctor will just suggest trimming it back out.
     Pitfalls, rationale, and non-default conventions are what earn their place here. -->
