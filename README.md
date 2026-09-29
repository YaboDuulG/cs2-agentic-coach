# DemoSage

AI-powered CS2 demo analysis. Upload a `.dem` file → get round-by-round coaching on
duels, economy and utility, cited against pro play. Teams get scouting dossiers, a
stratbook with Discord approval, and on-demand practice servers.

[![CI](https://github.com/YaboDuulG/cs2-agentic-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/YaboDuulG/cs2-agentic-coach/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-blue)
![Next.js](https://img.shields.io/badge/Frontend-Next.js%2015-black)
![GCP](https://img.shields.io/badge/Infra-Google%20Cloud-blue)

---

## Live

| | URL |
|---|---|
| **Frontend** | https://cs2-agentic-coach.vercel.app |
| **API** | https://demosage-api-staging-dsr6wo6mta-uc.a.run.app |

---

## Architecture

```
Browser ──fingerprint + presigned upload──▶ GCS (demos/raw/{demo_id}/)
                                                │
                                   jobs table (Postgres, SKIP LOCKED)
                                                │
                     services/worker ── parse ──▶ Go demo-parser (demoinfocs-golang v5)
                                     ── stats ──▶ telemetry v2 (zones, damage, flash, round features)
                                     ── coach ──▶ evidence pack → Gemini → verified findings
                                                │
                            Frontend polls /api/jobs/{id} → debrief
```

Demos are shared artifacts (parsed once); matches are per-user analyses in one of three
modes: personal, team, or scouting.

## Services

| Service | Description | Runtime |
|---|---|---|
| **API** (`api/`) | FastAPI edge: routing, auth, entitlements | Cloud Run |
| **Worker** (`services/worker/`) | Drains the `jobs` table: parse, stats, coaching, Discord outbox | Cloud Run (same image) |
| **Demo parser** (`services/demo-parser/`) | Go, pure function `.dem` → JSON | Cloud Run |
| **Coaching** (`agents/`, moving to `services/coaching_ai/`) | LangGraph orchestration, evidence pack, Scribe report, verification | in worker |
| **RAG engine** (`services/rag_engine/`) | HLTV delta monitor, archetype extraction, hybrid retrieval (Qdrant dense + BM25) | in worker |
| **Billing** (`services/billing/`) | Entitlement matrix, Stripe sync, ESEA season purchases, promo/referral codes, per-team cost metering | in API |
| **Stratbook + Discord** (`services/stratbook/`, `services/discord_bot/`) | Strat state machine, HTTP Interactions bot, transactional sync outbox | in API + worker |
| **Practice servers** (`services/warlord/`) | DatHost provisioning, RCON | in API |
| **Frontend** (`frontend/`) | Next.js 15, three themes, TanStack Query, Clerk | Vercel |
| **DB** | PostgreSQL 15 (Cloud SQL) + Alembic; Qdrant Cloud for vectors | managed |

## Pricing

| Tier | Price | Gets |
|---|---|---|
| Free | $0 | 2 uploads / month, headline + one finding |
| Solo Pro | $10 / month or $96 / year | full personal coaching, benchmarks, drills |
| Team | $300 per ESEA season, one payment | team analysis, scouting, servers, stratbook + Discord, seats for the roster |

Trials: weekly single-use codes (admin-minted) and a referral link on every profile that
gives both sides a week of Solo Pro. Details and the Stripe setup: `docs/pricing.md`.

## Local Dev

```bash
# Backend (Python 3.12/3.13)
pip install -r requirements.txt
alembic upgrade head
uvicorn api.main:app --reload
python -m services.worker          # in a second shell

# Frontend
cd frontend
npm install
npm run dev        # http://localhost:3000

# Checks
ruff check . && mypy agents/ api/ db/ && pytest tests/ -q
cd frontend && npm run lint && npx tsc --noEmit
```

Set `LOCAL_MODE=true` in `.env` to skip GCS and DatHost. Copy `.env.example` to `.env`.

## Deploy

- **Frontend**: automatic on push to `main` via Vercel.
- **Backend**: `deploy-staging.yml` GitHub Action → Cloud Run.
- Development happens on a working branch; `main` only takes green branches (see `CLAUDE.md`).

## Tech Stack

| Layer | Technology |
|---|---|
| Agent framework | LangGraph / LangChain + google-genai |
| Demo parsing | Go + demoinfocs-golang v5 |
| API | FastAPI + SQLAlchemy + Alembic |
| Frontend | Next.js 15 + Tailwind v4 + TanStack Query + Zustand |
| Auth | Clerk (plus Steam OpenID and FACEIT linking) |
| Billing | Stripe (subscriptions for Solo Pro, one-time season payments for Team) |
| Vectors | Qdrant Cloud (BM25 fallback when absent) |
| Infra | GCP (Cloud Run, Cloud SQL, GCS) |

---

Planning documents: `TASKS.md` (everything in flight), `TECHNICAL_SPEC.md` (architecture and
the §15 decision log), `ARCHITECTURE_REFACTOR_PLAN.md` (backend), `frontend/FRONTEND_REFACTOR_PLAN.md`
(frontend), `frontend/UX_REVIEW.md` (evidence), `docs/pricing.md` (pricing).
