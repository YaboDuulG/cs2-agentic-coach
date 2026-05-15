# DemoSage

> **"Analyze like a Khan. Dominate like Vitality."**

AI-powered CS2 demo analysis. Upload a `.dem` file → get round-by-round coaching on kills, economy, and utility.

[![CI](https://github.com/YaboDuulG/cs2-agentic-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/YaboDuulG/cs2-agentic-coach/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-blue)
![Next.js](https://img.shields.io/badge/Frontend-Next.js%2015-black)
![GCP](https://img.shields.io/badge/Infra-Google%20Cloud-blue)

---

## Live

| | URL |
|---|---|
| **Frontend** | https://cs2-agentic-coach-25vuneach-manduul-g-s-projects.vercel.app |
| **API** | https://demosage-api-staging-dsr6wo6mta-uc.a.run.app |

---

## Architecture

```
Browser  ──presigned URL──▶  GCS (demos/raw/{match_id}/)
                                      │
                              OBJECT_FINALIZE event
                                      │
                            Pub/Sub topic: demo-uploaded
                                      │
                             push subscription (auth'd)
                                      │
                            Scout Service (Cloud Run)
                              /internal/scout/parse-from-gcs
                                      │
                            Parse .dem → PostgreSQL
                                      │
                            Frontend polls /api/jobs/{id}
                                      │
                            Results page: kill feed + economy
```

## Services

| Service | Description | Runtime |
|---|---|---|
| **API** (`api/`) | FastAPI — upload presign, job status | Cloud Run |
| **Scout** (`services/scout/`) | Demo parser — demoparser2 → DB | Cloud Run |
| **Frontend** (`frontend/`) | Next.js 15 — Mongol Empire UI | Vercel |
| **DB** | PostgreSQL 15 + pgvector | Cloud SQL |

## Local Dev

```bash
# Backend
pip install -r requirements.txt
uvicorn api.main:app --reload

# Frontend
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Set `LOCAL_MODE=true` in `.env` to skip GCS and Cloud Tasks.

## Deploy

- **Frontend**: Automatic on push to `main` via Vercel GitHub integration
- **Backend**: `deploy-staging.yml` GitHub Action → Cloud Run

## Tech Stack

| Layer | Technology |
|---|---|
| Agent framework | LangGraph / LangChain |
| Demo parsing | demoparser2 |
| API | FastAPI + SQLAlchemy |
| Frontend | Next.js 15 + Tailwind v4 |
| Auth (planned) | Clerk |
| Billing (planned) | Stripe |
| Infra | GCP (Cloud Run, Cloud SQL, GCS, Pub/Sub) |

---

See [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md) for the full architecture and roadmap.
