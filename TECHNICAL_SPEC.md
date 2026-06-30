# 🏹 DemoSage — Technical Specification
> **Version:** 1.0.0 | **Status:** v2 Architecture — Implementation Ready | **Last Updated:** 2026-06-30

---

## 📋 Table of Contents
1. [Project Vision](#1-project-vision)
2. [System Architecture](#2-system-architecture)
3. [Agent Definitions (The Horde)](#3-agent-definitions-the-horde)
4. [AI Reasoning & Knowledge Layer](#4-ai-reasoning--knowledge-layer)
5. [Data Pipelines](#5-data-pipelines)
6. [Integrations](#6-integrations)
7. [Practice Server System](#7-practice-server-system)
8. [MCP Server](#8-mcp-server)
9. [Design System](#9-design-system)
10. [Frontend — Page Architecture](#10-frontend--page-architecture)
11. [Tech Stack](#11-tech-stack)
12. [GitHub Actions Plan](#12-github-actions-plan)
13. [Security Model](#13-security-model)
14. [Progress Tracker](#14-progress-tracker)
15. [Decisions Made](#15-decisions-made)
16. [Future Planned Features](#16-future-planned-features)

---

## 1. Project Vision

**DemoSage** is an AI-powered CS2 coaching ecosystem that automatically ingests match demos from FACEIT and Steam Matchmaking, analyzes them using a multi-agent Gemini pipeline, and delivers personalized tactical coaching — for both individual players and team IGLs.

### Core Pillars

| Pillar | Description |
| :--- | :--- |
| **Zero-Friction Ingestion** | Connect Steam + FACEIT once. Matches auto-fetch without any manual upload. |
| **Match Analysis** | Parse `.dem` files via Go (`demoinfocs-golang`) and generate round-by-round breakdowns |
| **Dual-RAG Coaching** | Compare player tendencies (Qdrant) against HLTV pro patterns (Qdrant) for personalized advice |
| **Stratbook** | Interactive HTML5 Canvas tactical board with AI critique for individuals and teams |
| **Communication Coaching** | Transcribe and analyze team audio for callout quality, IGL clarity, and morale patterns |
| **Practice Server** | Spin up a CS2 server on demand via DatHost with 10 training modes |
| **MCP Integration** | Model Context Protocol server exposing live DB tools to AI agents |

> **Scope:** Multi-tenant (individual + team). Each user owns their data; teams share a scoped view.

---

## 2. System Architecture

### High-Level Overview (v2 Polyglot)

```
┌──────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js 16)                  │
│   Personal Dashboard | Team Hub | Stratbook | AI Coach   │
└────────────────────────┬─────────────────────────────────┘
                         │ REST + WebSocket + SSE
┌────────────────────────▼─────────────────────────────────┐
│            API GATEWAY (FastAPI — Python)                 │
│   Auth (Clerk JWT), routing, job orchestration           │
└──────┬───────────────────────────────┬────────────────────┘
       │ HTTP/gRPC                     │ HTTP/gRPC
┌──────▼──────────────┐   ┌───────────▼────────────────┐
│  demo-resolver (Go) │   │  demo-parser (Go)           │
│  FACEIT Data API    │   │  demoinfocs-golang          │
│  Steam GC Bot       │   │  Streams JSON events        │
│  HLTV index         │   │  Sub-1s parse (100MB demo)  │
│  Returns GCS URI    │   │  Writes Postgres + GCS      │
└─────────────────────┘   └────────────────────────────┘
                                       │
              ┌────────────────────────▼──────────────────┐
              │            AI LAYER (Python)               │
              │  great_khan/   — LangGraph orchestrator   │
              │  tactician/    — FCR + positional agents  │
              │  scribe/       — report generator          │
              │  strat_reviewer.py — Dual-RAG critique    │
              │  mcp_server.py — MCP tool server          │
              └────────────────────────────────────────────┘
                                       │
              ┌────────────────────────▼──────────────────┐
              │         DATA LAYER                         │
              │  PostgreSQL (Cloud SQL) — match events     │
              │  Qdrant Cloud — ProPlaybook + Player       │
              │               Tendency vector indexes      │
              │  GCS — raw .dem files + parsed JSON        │
              └────────────────────────────────────────────┘
```

### Auto-Ingestion Flow (Zero-Friction)

```
User links Steam + FACEIT (one-time, /onboarding)
         │
         ▼
Auto-Discovery Engine (runs on link + daily cron)
         │
    ┌────┴───────────────────────────────────┐
    │  1. FACEIT linked?                      │
    │     GET /players/{id}/history          │
    │     → queue all matches not in DB      │
    │  2. Steam linked?                       │
    │     Steam GC Bot → sharecode → .dem   │
    │  3. Match already in DB?               │
    │     → return instantly (⚡ cached)     │
    │  4. Nothing found                       │
    │     → show manual upload               │
    └────────────────────────────────────────┘
         │
         ▼
demo-resolver (Go) → fetches + pushes to GCS
         │
         ▼
demo-parser (Go) → parses → writes Postgres + GCS
         │
         ▼
AI Layer → Great Khan → Tactician → Scribe → Report ready
```

---

## 3. Agent Definitions (The Horde)

### 🏰 The Great Khan — Orchestrator
- **Role:** Central LangGraph supervisor. Routes user queries, fans out to workers, synthesizes final coaching output.
- **LLM:** `gemini-2.5-pro`
- **Responsibilities:** Intent routing (stat query / tactical / server / general), session state, hallucination guardrails, confidence scoring.
- **Refactor Target:** Extract from monolithic `great_khan.py` (1010 lines) into `agents/khan/` submodule:
  ```
  agents/khan/
    __init__.py   # exports the compiled graph
    graph.py      # LangGraph graph construction only
    nodes.py      # individual node functions
    prompts.py    # all prompt templates
    rag.py        # Dual-RAG retrieval (Qdrant)
    stats.py      # match stat aggregation helpers
  ```

---

### 🛰️ The Scout — Demo Parser (Go Microservice)
- **Role:** Parse CS2 `.dem` files into structured JSON events and write to Postgres.
- **Runtime:** Go binary (`demo-parser` microservice), called by API Gateway via HTTP.
- **Library:** `demoinfocs-golang` (battle-tested; used by HLTV, Leetify, scope.gg)
- **Performance Target:** Parse a 100MB demo in < 2 seconds (vs. ~60s current Python)
- **LLM:** None — pure deterministic parsing
- **Outputs:**
  - Kill events (weapon, distance, headshot, 3D positions)
  - Grenade/utility events (throw X/Y/Z, land position, type, timing)
  - Player trajectories per round (sampled every 8 ticks)
  - Round metadata (economy, outcome, site)
  - First Contact events (first duel per round)
- **Streaming:** Parser streams events as JSON to avoid memory spikes on large demos

---

### 🗺️ The Demo Resolver — Auto-Ingestion (Go Microservice)
- **Role:** Resolve match identifiers to `.dem` download URLs without user intervention.
- **Runtime:** Go binary (`demo-resolver` microservice)
- **Resolution Priority:**
  1. FACEIT Match ID → FACEIT Data API → Downloads API signed URL
  2. CS2 Sharecode → Steam GC Bot → `.dem` URL
  3. Match already in DB → return `match_id`, skip download
  4. Fail → prompt manual upload
- **Steam GC Bot:** Single dedicated burner Steam account. Go service maintains persistent GC connection. Resolves sharecode in ~200ms.
- **FACEIT Webhook:** Subscribes to `match.demo_ready` event for instant trigger (no polling).

---

### 🛡️ The Tactician — Agentic Analyst
- **Role:** Evaluate tactical decisions using structured demo data + Dual-RAG context
- **LLM:** `gemini-2.5-flash` (thinking mode enabled)
- **Analysis Modules:**
  - **FCR (First Contact Resolution):** Did the first duel win or lose the round?
  - **Rotation Efficiency:** Are rotations timed correctly relative to site pressure?
  - **Utility Sequencing:** Is utility thrown in a tactically sound order?
  - **Economy Coherence:** Are force-buys justified? Is saving optimal?
  - **Positional Patterns:** Over-peeking, passive-play, default tendencies
- **Output:** Structured JSON per player per round with severity scores

---

### 📚 Khan's Library — Dual-RAG Knowledge Layer
- **Role:** Provide pro context (HLTV) and player-specific context (individual tendencies) simultaneously
- **Storage:** **Qdrant Cloud** — two separate collections:
  - `pro_playbook` — HLTV pro match embeddings (map, team, round context)
  - `player_tendency` — Per-player tactical profile embeddings (keyed by `steam_id + map_name`)
- **Embeddings Model:** `text-embedding-004`
- **Summarization:** `gemini-2.0-flash` (nightly batch)
- **Quota Warning:** Nightly cron alerts admin at **8M vectors** — see Section 8.3
- **Retrieval Pattern (Dual-RAG):**
  ```
  User query
      │
      ├── Query 1 → pro_playbook index  → "What do pros do here?"
      └── Query 2 → player_tendency     → "What does THIS player do here?"
                        │
                        ▼
               Gemini synthesis: "Pros throw window smoke early.
               You typically peek without it — dying to the same
               AWP in 7 of your last 10 rounds on this site."
  ```
- **Namespace Isolation:** Every Qdrant payload includes `scope` (public/team/individual), `user_id`, `team_id` — queries are always filtered by scope to prevent cross-user data leaks.

---

### 🎙️ The Comms Analyst — Communication Coach
- **LLM:** `gemini-2.5-flash` (native audio input)
- **Pipeline:** `.mp3/.wav/.ogg` upload → Flash transcription → pyannote diarization → round clock alignment → NLP evaluation (callout accuracy, IGL clarity, tilt detection)
- **Output:** Per-round communication score + flagged moments with clip timestamps

---

### 📜 The Scribe — Report Generator
- **LLM:** `gemini-2.0-flash`
- **Report Types:** Player Report (private), Coach Report (aggregate), Strat Card (team-shareable), JSON summary for dashboard
- **Delivery:** Streamed via SSE — user sees tokens appear in real-time

---

### ⚔️ The Warlord — Practice Server Manager
- **LLM:** `gemini-2.0-flash` (intent extraction)
- **Backend:** DatHost API, 128-tick, 10 training modes
- **See Section 7 for full spec**

---

### 🎯 Strat Reviewer — AI Tactical Critique
- **Role:** Critiques user-drawn Stratbook strategies against Qdrant pro playbook
- **LLM:** `gemini-2.5-flash`
- **Input:** Canvas JSON (lines, markers, map name) from CS2PlanningBoard
- **Flow:** Fetch `pro_playbook` Qdrant context for map → synthesize critique → return Markdown

---

### 💰 Model Cost Strategy

| Agent | Model | Rationale |
| :--- | :--- | :--- |
| Great Khan | `gemini-2.5-pro` | Orchestration + synthesis; once per session |
| Scout (Go) | **None** | Pure deterministic parsing |
| Tactician | `gemini-2.5-flash` + thinking | 30 rounds × N players = high-volume reasoning |
| Comms Analyst | `gemini-2.5-flash` | Native audio input, no Whisper service |
| Library (embed) | `text-embedding-004` | Cheapest embedding for Qdrant batch jobs |
| Library (summarize) | `gemini-2.0-flash` | Nightly batch meta snapshots |
| Scribe | `gemini-2.0-flash` | Template-driven prose, streamed |
| Warlord | `gemini-2.0-flash` | Low-latency tool dispatch |
| Strat Reviewer | `gemini-2.5-flash` | RAG + critique; interactive latency |

---

## 4. AI Reasoning & Knowledge Layer

### 4.1 Domain Knowledge Injection

| Layer | Content | Format |
| :--- | :--- | :--- |
| **CS2 Game Rules Corpus** | Economy, map callouts, round timing | Markdown → Qdrant |
| **Pro Match Library** | HLTV demos: positions, utility, execute patterns | Structured JSON → Qdrant `pro_playbook` |
| **Player Tendency Profiles** | Per-player aggregated positional + weapon patterns | Structured JSON → Qdrant `player_tendency` |
| **Team Strategy Book** | Discord-ingested + Stratbook-drawn team strats | Markdown → Qdrant (team-scoped) |
| **Meta Snapshots** | Weekly summaries of current competitive meta | Auto-generated → Qdrant |

### 4.2 Chain-of-Thought Prompting
Tactician uses explicit step-by-step reasoning:
```
Given: economy=[data], first_contact=[data], utility=[data], pro_ref=[Qdrant result]

Step 1: Evaluate economic context. Was a force-buy correct?
Step 2: Assess the first contact — was the duel taken at a disadvantage?
Step 3: Compare utility usage against pro reference. What was missing?
Step 4: Identify the root cause of the round loss/win.
Step 5: State 1 specific improvement + 1 positive observation.
```

### 4.3 Hallucination Guardrails
- All tactical claims validated against demo-parsed structured data
- Ungrounded claims withheld and flagged by Great Khan
- Agent outputs include `confidence_score` — low-confidence output disclosed to user
- Pro match citations include source match ID + round number

### 4.4 Gemini Context Caching
Static RAG corpora (CS2 rules, meta snapshots, Discord strategies) are cached via Gemini's **Context Caching API** with a 30-60 minute TTL. Reduces TTFT by ~75% and token cost by 50-70% on repeated queries.

### 4.5 Incremental Re-runs
When a user edits notes (not demo data), the LangGraph graph uses **Node Bypass Rules** to skip RAG/Scout analysis and go straight to Scribe, reducing re-run latency from ~25s to <5s.

### 4.6 Streaming Response Protocol
All coaching endpoints use **Server-Sent Events (SSE)** to stream tokens to the frontend in real-time. Users see the AI "type" rather than wait for a spinner.

---

## 5. Data Pipelines

### 5.1 Auto-Ingestion Pipeline (v2 — Zero-Upload Default)

```
User submits match identifier (or cron triggers for linked accounts)
         │
         ▼
demo-resolver (Go)
  ├── FACEIT API → signed .dem URL
  ├── Steam GC Bot → .dem URL from sharecode
  ├── Already in DB → skip (return match_id)
  └── All failed → prompt manual upload
         │
         ▼
Download .dem → upload to GCS
         │
         ▼
Cloud Tasks → demo-parser (Go) triggered
  → Streams parsed events as JSON
  → Writes kills / grenades / rounds / trajectories / first_contacts to Postgres
  → Uploads parsed JSON to GCS (Parquet format for analytics)
         │
         ▼
Cloud Tasks → AI Layer triggered
  → Great Khan → Tactician + Comms Analyst (parallel)
  → Khan's Library (Dual-RAG context)
  → Scribe (report, streamed via SSE)
         │
         ▼
Match status → COMPLETE
User sees report (WebSocket notification)
```

### 5.2 Manual Upload Pipeline (Fallback)
```
POST /api/upload/presign → presigned GCS URL
Browser → direct chunked upload to GCS (bypasses Vercel 4.5MB limit)
POST /api/upload/compose → trigger Cloud Tasks → same pipeline as above
```

### 5.3 Audio Pipeline
```
POST /api/upload/audio
  → Accept .mp3 / .wav / .ogg (max 2GB)
  → Gemini 2.5 Flash transcription (native audio)
  → pyannote diarization (speaker separation)
  → Timestamps aligned to demo round clock
  → Comms Analyst NLP evaluation
  → Merged with Tactician output in Scribe
```

### 5.4 HLTV Ingestion Pipeline (Nightly)
```
GitHub Action (cron: 0 2 * * *)
  → Trigger Apify HLTV actor
  → Receive new match results as structured JSON
  → Queue demo-parser jobs for each new demo
  → Tactician extracts tactical patterns
  → Embed → Qdrant pro_playbook collection updated
  → Meta snapshot refreshed
```

### 5.5 Player Tendency Indexing
```
After every match parse completes:
  → Aggregate player events (positions, weapon choices, utility patterns)
  → Embed per-player summary (keyed: steam_id + map_name)
  → Upsert into Qdrant player_tendency collection
```

---

## 6. Integrations

### 6.1 Steam Integration (OpenID 2.0)
- **Auth Flow:** Steam OpenID 2.0 redirect → server-side validation → store `steam_id` in user record
- **Demo Fetch:** Steam Web API `GetMatchHistory` → extract sharecodes → Steam GC Bot → `.dem` URL
- **GC Bot:** Dedicated burner Steam account, Go service, permanent GC connection
- **Auto-Sync:** Runs on account link + daily cron per linked user

### 6.2 FACEIT Integration (OAuth2 + PKCE)
- **Auth Flow:** Authorization Code + PKCE → `faceit_access_token` stored server-side (encrypted)
- **Match History:** `GET /players/{player_id}/history` — fetches last 30 days on link
- **Webhook:** `match.demo_ready` → instant trigger (no polling needed)
- **Demo Download:** FACEIT Downloads API signed URL → GCS
- **Player Stats:** `GET /players/{player_id}/stats/cs2` — Elo, map win rates

### 6.3 Discord Integration
- **Webhook Receiver:** `POST /api/discord/webhook` (HMAC-verified)
- **Strategy Ingestion:** Unstructured Discord messages → `gemini-2.0-flash` → structured strategy card → Qdrant (team-scoped)
- **Strategy Chat:** Team-specific semantic search via Great Khan

### 6.4 Stripe Integration
- **Plans:** Free (2 demos/mo), Basic $5 (10/mo), Pro $20 (unlimited)
- **Flow:** Stripe checkout → webhook → Clerk `publicMetadata` plan update
- **Enforcement:** Server-side quota check on every upload

---

## 7. Practice Server System

### 7.1 Architecture
- **Hosting:** DatHost on-demand CS2 server provisioning (`multipart/form-data` API)
- **Tickrate:** 128-tick on all servers
- **Lifecycle:** 2-hour TTL; cron auto-terminates expired servers
- **Update Guard:** Steam News API detects live CS2 updates → blocks provisioning for 2h; fails open if Steam API unreachable

### 7.2 Training Modes (10 Modes Implemented)

| Mode | Game Mode | Key Commands |
| :--- | :--- | :--- |
| `practice` | competitive | sv_cheats 1, infinite ammo, bot_kick, $60k start |
| `prefire` | competitive | sv_cheats 1, infinite ammo, 60min rounds |
| `defense` | competitive | sv_cheats 1, infinite ammo, 3s freeze |
| `tradefire` | deathmatch | sv_cheats 1, infinite ammo |
| `spray` | deathmatch | sv_cheats 1, clip-only ammo, recoil scale 2 |
| `awp` | deathmatch | sv_cheats 1, AWP-only infinite ammo |
| `aimtrainer` | deathmatch | sv_cheats 1, hard bots |
| `promode` | competitive | sv_cheats 0, real economy |
| `grenade` | competitive | sv_cheats 1, trajectory on, 15s display |
| `retake` | competitive | sv_cheats 1, $4k start, short rounds |

### 7.3 Server Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| POST | `/api/teams/{id}/servers` | Provision server |
| GET | `/api/teams/{id}/servers` | List active servers |
| DELETE | `/api/servers/{id}` | Terminate server |
| GET | `/api/servers/modes` | List modes + update status |
| POST | `/api/servers/webhook` | DatHost ready callback |
| POST | `/api/servers/cron/cleanup` | Destroy expired servers |

---

## 8. MCP Server

### 8.1 Overview
`agents/mcp_server.py` runs as a **sidecar process** alongside the FastAPI API. It is never exposed to the internet — communicates via stdio or local Unix socket. Any MCP-compatible client (Antigravity, Claude Desktop, Cursor) can connect to query live DemoSage data autonomously.

### 8.2 Exposed Tools

```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("DemoSage")

@mcp.tool()
def get_player_tendencies(steam_id: str, map_name: str) -> dict:
    """Returns aggregated positional patterns + weapon preferences for a player."""

@mcp.tool()
def get_pro_playbook(map_name: str) -> dict:
    """Returns the pro baseline playbook for a given CS2 map from Qdrant."""

@mcp.tool()
def get_recent_matches(user_id: str, limit: int = 10) -> list[dict]:
    """Returns recent match metadata + coaching summary for a user."""

@mcp.tool()
def get_match_fcr(match_id: str) -> dict:
    """Returns first contact resolution data for a specific match."""

@mcp.tool()
def request_reanalysis(match_id: str) -> dict:
    """Triggers a fresh AI coaching run on an already-parsed match."""

@mcp.resource("demosage://schema")
def get_schema() -> str:
    """Returns the current DB schema for AI context."""
```

### 8.3 Qdrant Vector Quota Warning System
```python
# Runs nightly via GitHub Actions cron
async def check_vector_quota():
    for collection in ["pro_playbook", "player_tendency"]:
        info = qdrant_client.get_collection(collection)
        if info.points_count >= 8_000_000:
            await send_admin_alert(
                subject="⚠️ Qdrant approaching tier limit",
                body=f"Collection '{collection}' has {info.points_count:,} vectors. "
                     f"Upgrade Qdrant Cloud tier immediately."
            )
            # Also sets a DB flag to show banner in /admin
```

---

## 9. Design System

### 9.1 Component Framework
- **Library:** `shadcn/ui` — composable, accessible, unstyled base
- **Design Tool:** `v0.dev` — generates working React + shadcn components from text prompts
- **CSS:** Tailwind v4 + CSS custom properties for theme tokens
- **Icons:** Lucide React
- **Animations:** Framer Motion
- **Fonts:** Inter (UI), JetBrains Mono (data/code), display font for section headers

### 9.2 Themes (User-Selectable in `/profile`)

#### Theme A — The Great Khan 🏹
*Eternal Blue Sky, gold authority, Mongolian steppe at dusk.*

| Token | Value |
| :--- | :--- |
| `--bg-base` | `#0D1117` |
| `--bg-surface` | `#131C2B` |
| `--bg-elevated` | `#1A2744` |
| `--accent-primary` | `#2A6F97` (Tengri blue) |
| `--accent-secondary` | `#D4A300` (Sun gold) |
| `--accent-danger` | `#9B1B30` (Warrior red) |
| `--text-primary` | `#E8EDF5` |
| `--border` | `#1E3A5F` |

*Subtle texture: Low-opacity Mongolian geometric knot pattern. Steppe horizon gradient in header.*

#### Theme B — Purple Void 💜
*Deep space violet. Otherworldly. Like the void before a decisive round.*

| Token | Value |
| :--- | :--- |
| `--bg-base` | `#0A0612` |
| `--bg-surface` | `#110A1F` |
| `--bg-elevated` | `#1A0F30` |
| `--accent-primary` | `#A855F7` (Electric violet) |
| `--accent-bright` | `#C084FC` (Bright purple) |
| `--accent-secondary` | `#EC4899` (Magenta-pink — alerts only) |
| `--text-primary` | `#EDE9FE` |
| `--border` | `rgba(168,85,247,0.35)` |
| `--glow` | `0 0 20px rgba(168,85,247,0.4)` |

*Subtle texture: Faint purple grid lines. Neon glow on active elements. Radial gradient from center.*

#### Theme C — Tactical Command 🎯
*Olive gunmetal. Disciplined. Feels like a real IGL briefing room.*

| Token | Value |
| :--- | :--- |
| `--bg-base` | `#12150F` |
| `--bg-surface` | `#1C2118` |
| `--bg-elevated` | `#252E20` |
| `--accent-primary` | `#4A7C59` (Tactical green) |
| `--accent-secondary` | `#E8A838` (Amber — comms active) |
| `--accent-danger` | `#C0392B` (Red alert) |
| `--text-primary` | `#D4D8CF` |
| `--border` | `#3A4A35` |

*Subtle texture: Topographic map lines. JetBrains Mono for data readouts. Radar sweep animation.*

---

## 10. Frontend — Page Architecture

### 10.1 Full Route Map

```
PERSONAL EXPERIENCE
──────────────────────────────────────────────
/onboarding             NEW — one-time setup, Steam + FACEIT connect
/dashboard              Personal hub: recent matches, trends, map win rates
/matches/[id]           Match analysis: round timeline, FCR, AI report, heatmap
/matches/[id]/replay    Full-screen Three.js 3D replay viewer
/stratbook              Personal strategy board (CS2PlanningBoard + AI critique)
/coach                  AI chat (context-aware via MCP tools)
/profile                Steam/FACEIT links, theme switcher, settings

TEAM EXPERIENCE
──────────────────────────────────────────────
/team                   Team list / create team
/team/[id]              Team dashboard: win rate, map pool, recent matches
/team/[id]/matches      Shared match history
/team/[id]/matches/[id] Per-match IGL view
/team/[id]/playbook     Shared stratbook (IGL can lock strats)
/team/[id]/roster       Player tendency cards, radar charts
/team/[id]/practice     DatHost server provisioning + mode launcher

SHARED / UTILITY
──────────────────────────────────────────────
/                       Landing + marketing (public)
/sign-in                Clerk auth
/sign-up                Clerk auth
/billing                Stripe checkout + plan management
/admin                  Admin: LLM configs, Qdrant quota, system health
```

### 10.2 Page Dependency Map

| Route | Hard Dependencies | Soft Dependencies |
| :--- | :--- | :--- |
| `/onboarding` | Clerk session | — |
| `/dashboard` | Clerk session | Steam/FACEIT linked accounts |
| `/matches/[id]` | `match.status == COMPLETE` | `coaching_notes` (spinner if null) |
| `/matches/[id]/replay` | `trajectories` rows exist | — |
| `/stratbook` | Auth | Saved strategies in DB |
| `/coach` | Auth + ≥1 COMPLETE match | MCP server running |
| `/team/[id]` | Team membership | Team logo |
| `/team/[id]/roster` | ≥1 COMPLETE team match | Qdrant `player_tendency` data |
| `/team/[id]/practice` | Team owner/admin role | CS2 update status |
| `/admin` | Admin Clerk role | Qdrant quota data |

### 10.3 Key UX Behaviors
- **Match source badge:** `⚡ FACEIT` / `⚡ Steam MM` / `📤 Manual` on every match card
- **Deduplication banner:** "⚡ Cached — analysis already available" when match is found instantly
- **WebSocket progress bar:** Real-time parse job progress (0% → Downloading → Parsing → Analyzing → Done)
- **Streaming AI output:** SSE — coaching notes stream token-by-token as they generate
- **Dependency gates:** Pages gracefully degrade — spinner + message if dependency not met

---

## 11. Tech Stack

### Backend

| Component | Technology | Notes |
| :--- | :--- | :--- |
| **API Gateway** | FastAPI 0.115 + Uvicorn | Python; routes, auth, orchestration |
| **Demo Parser** | Go + `demoinfocs-golang` | `demo-parser` microservice |
| **Demo Resolver** | Go | `demo-resolver` microservice |
| **Agent Framework** | LangGraph + LangChain | Supervisor pattern, stateful handoffs |
| **LLM Provider** | Google Gemini API | Unified GCP billing |
| **Demo Parsing Lib** | `demoinfocs-golang` | Industry standard; used by HLTV + Leetify |
| **Audio Transcription** | Gemini 2.5 Flash (native audio) | No Whisper service needed |
| **Speaker Diarization** | pyannote.audio | Speaker separation |
| **Vector DB** | **Qdrant Cloud** | Dual-index: `pro_playbook` + `player_tendency` |
| **Relational DB** | PostgreSQL (Cloud SQL) + Alembic | Schema migrations, not raw ALTER TABLE |
| **LLM Cache** | Postgres-backed LangChain cache | Replaces SQLiteCache (works in Cloud Run) |
| **File Storage** | Google Cloud Storage | `.dem`, audio, parsed JSON (Parquet) |
| **Task Queue** | Google Cloud Tasks | Async jobs; 1M/mo free |
| **Compute** | Google Cloud Run | Serverless; scales to zero |
| **Auth** | Clerk (JWT validated server-side) | Never trust client-supplied user_id |
| **Payments** | Stripe | 3-tier plan system |
| **Observability** | LangSmith + Cloud Logging | Agent traces + infra logs |
| **MCP** | `mcp` Python SDK | Sidecar process, stdio transport |
| **Practice Servers** | DatHost API | On-demand CS2 servers |
| **CI/CD** | GitHub Actions | See Section 12 |
| **Migrations** | Alembic | No more raw ALTER TABLE on startup |

### Frontend

| Component | Technology |
| :--- | :--- |
| **Framework** | Next.js 16 + React 19 |
| **Auth** | Clerk Next.js SDK |
| **Component Library** | shadcn/ui |
| **Styling** | Tailwind v4 + CSS custom properties (theme tokens) |
| **3D Rendering** | Three.js + @react-three/fiber + @react-three/drei |
| **Data Fetching** | TanStack React Query v5 |
| **State** | Zustand 5.0 |
| **Animations** | Framer Motion |
| **Icons** | Lucide React |
| **Payments** | Stripe + @stripe/stripe-js |
| **Real-time** | WebSocket (parse progress) + SSE (streaming AI) |
| **Deployment** | Vercel |

### Infrastructure

| Layer | Service |
| :--- | :--- |
| **API** | Google Cloud Run |
| **Go services** | Google Cloud Run (separate containers) |
| **Scout/Parser** | Cloud Run Jobs (triggered by Cloud Tasks) |
| **DB** | GCP Cloud SQL (PostgreSQL 15) |
| **Storage** | Google Cloud Storage |
| **Vector DB** | Qdrant Cloud |
| **Frontend** | Vercel |

---

## 12. GitHub Actions Plan

| Action | Trigger | Purpose |
| :--- | :--- | :--- |
| `ci.yml` | Push / PR | Lint (ruff), type-check (mypy), unit tests, Go tests |
| `hltv-ingest.yml` | Nightly 02:00 UTC | Scrape HLTV, queue parse jobs, update Qdrant |
| `qdrant-quota-check.yml` | Nightly 03:00 UTC | Check vector counts, alert at 8M threshold |
| `meta-snapshot.yml` | Weekly Mon 06:00 UTC | Generate weekly meta summary from pro matches |
| `docker-build.yml` | Push to `main` | Build and push Go microservice images |
| `deploy-staging.yml` | Push to `staging` | Deploy full stack to staging |
| `deploy-prod.yml` | Release tag | Deploy to production with smoke tests |

---

## 13. Security Model

### 13.1 Authentication
- **Clerk JWT** validated server-side on every protected route using `python-jose`
- `user_id` is **always** extracted from the validated JWT claim — never from request body/params
- Current `verify_shared_secret` shared-secret auth is replaced with JWT middleware

### 13.2 Database Session Management
- All routes use `Depends(get_db)` FastAPI dependency with `yield` pattern
- `SessionLocal()` inline calls are eliminated — sessions always closed on request teardown

### 13.3 Background Jobs
- All background coaching jobs routed through **Cloud Tasks** — no bare `threading.Thread` calls
- Job durability: Cloud Tasks retries failed jobs automatically with exponential backoff

### 13.4 CORS
- `allow_origins=["*"]` replaced with explicit domain whitelist in production

### 13.5 Webhook Security
- Discord webhook: HMAC signature verification (currently missing — to be added)
- FACEIT webhook: signature verified (already implemented)
- DatHost webhook: IP allowlist + shared secret

### 13.6 Vector Namespace Isolation
Every Qdrant payload includes:
```json
{ "scope": "public|team|individual", "user_id": "...", "team_id": "..." }
```
All retrieval queries filter by scope — prevents cross-user data leaks in coaching context.

---

## 14. Progress Tracker

### Phase 0: Foundation (Complete ✅)
- [x] Monorepo structure
- [x] GCP project + APIs enabled
- [x] Cloud SQL + GCS + Cloud Tasks configured
- [x] FastAPI scaffold deployed to Cloud Run
- [x] SQLAlchemy ORM schema
- [x] GitHub Actions CI/CD pipeline

### Phase 1: Scout (Complete ✅)
- [x] `demoparser2` parsing (kills, grenades, rounds, trajectories, FCR)
- [x] Cloud Tasks trigger on GCS upload
- [x] Warmup round filtering
- [x] KAST calculation

### Phase 2: Great Khan (Complete ✅)
- [x] LangGraph supervisor with tool-calling handoffs
- [x] Intent routing
- [x] Hallucination guardrails
- [x] Confidence scoring

### Phase 3: Khan's Library RAG (Complete ✅)
- [x] CS2 game rules corpus
- [x] Embedding pipeline
- [x] HLTV Apify actor
- [x] Nightly GitHub Action
- [x] Discord strategy ingestion
- [x] RAG tactics chatboard

### Phase 4: Tactician (Partial)
- [x] FCR module
- [ ] Rotation efficiency
- [ ] Utility sequencing
- [ ] Economy coherence
- [ ] Positional pattern detection

### Phase 5: Comms Analyst
- [ ] Gemini audio pipeline
- [ ] pyannote diarization
- [ ] Round clock alignment
- [ ] NLP evaluation modules

### Phase 6: Scribe
- [ ] Report schema
- [ ] Per-player + coach + strat card generators
- [ ] SSE streaming delivery

### Phase A: Frontend Beta (Complete ✅)
- [x] Next.js scaffold
- [x] Mongol Empire design tokens
- [x] Upload + analysis pages
- [x] Deployed to Vercel

### Phase B: Accounts & Billing (Complete ✅)
- [x] Clerk auth
- [x] Stripe 3-tier plans
- [x] Upload quota enforcement
- [x] Team system

### Phase C: Training Servers (Complete ✅)
- [x] DatHost provisioning
- [x] 10 training modes
- [x] CS2 update detection
- [x] Training modes UI

### Phase D: Stratbook (Complete ✅)
- [x] CS2PlanningBoard HTML5 Canvas
- [x] `UserStrategy` + `TeamPlaybook` DB models
- [x] REST API routes
- [x] `strat_reviewer.py` AI critique agent

### Phase V2-0: Security & Debt (TODO — Do First)
- [ ] Clerk JWT server-side validation on all routes
- [ ] `Depends(get_db)` across all routes (remove inline SessionLocal)
- [ ] All background jobs → Cloud Tasks (remove bare threads)
- [ ] Alembic setup + first migration
- [ ] CORS whitelist
- [ ] Discord webhook HMAC
- [ ] Postgres-backed LLM cache (replace SQLiteCache)

### Phase V2-1: Steam + FACEIT OAuth + Auto-Ingestion
- [ ] Steam OpenID 2.0 login endpoint
- [ ] FACEIT OAuth2 + PKCE flow
- [ ] `/onboarding` page
- [ ] Auto-discovery cron (daily per linked user)
- [ ] FACEIT match history fetch
- [ ] Demo deduplication (is_cached check)
- [ ] Match source badge in UI

### Phase V2-2: Go Microservices
- [ ] `demo-resolver` Go service (FACEIT + Steam GC)
- [ ] Steam GC bot account setup
- [ ] `demo-parser` Go service (`demoinfocs-golang`)
- [ ] Replace Python Scout parser with Go HTTP call
- [ ] Benchmark: <2s parse for 100MB demo

### Phase V2-3: Qdrant Cloud + Dual-RAG
- [ ] Qdrant Cloud cluster provisioned
- [ ] `pro_playbook` collection + HLTV embeddings migrated from pgvector
- [ ] `player_tendency` collection
- [ ] 8M vector nightly warning cron
- [ ] Update `strat_reviewer.py` to Dual-RAG Qdrant queries
- [ ] Vector namespace isolation filters

### Phase V2-4: MCP Server
- [ ] `pip install mcp`
- [ ] `agents/mcp_server.py` with 5 tools + 1 resource
- [ ] Launcher in `pyproject.toml`
- [ ] Antigravity + Claude Desktop config documented

### Phase V2-5: Frontend Redesign
- [ ] shadcn/ui setup
- [ ] 3-theme CSS token system (Khan / Purple Void / Tactical)
- [ ] Theme switcher in `/profile`
- [ ] `/onboarding` flow
- [ ] All 14 routes implemented with dependency gates
- [ ] WebSocket parse progress bar
- [ ] SSE streaming coaching output
- [ ] Match source badges

### Phase V2-6: Great Khan Refactor
- [ ] Extract `agents/khan/` submodule (graph / nodes / prompts / rag / stats)
- [ ] Unit tests per node
- [ ] Postgres-backed LangChain cache

---

## 15. Decisions Made

| Decision | Choice | Notes |
| :--- | :--- | :--- |
| **Demo Parser Runtime** | Go (`demoinfocs-golang`) | Replaces Python `demoparser2`; 30× faster; used by HLTV + Leetify |
| **Vector DB** | Qdrant Cloud (managed) | Replaces pgvector; serverless; no self-hosting |
| **Vector Quota Threshold** | 8M vectors → admin alert | Nightly cron + admin banner |
| **Demo Ingestion** | Auto-fetch first, upload as last resort | Zero-friction UX priority |
| **Steam Auth** | OpenID 2.0 | Valve's only public web login protocol |
| **FACEIT Auth** | OAuth2 Authorization Code + PKCE | Standard; server-side token exchange |
| **Background Jobs** | Cloud Tasks (no bare threads) | Durability + observability |
| **LLM Cache** | Postgres-backed (not SQLiteCache) | SQLiteCache wipes on Cloud Run cold start |
| **DB Migrations** | Alembic | No more raw ALTER TABLE on startup |
| **Auth** | Clerk JWT validated server-side | Never trust client-supplied user_id |
| **API Sessions** | `Depends(get_db)` with yield | Prevents session leaks |
| **Themes** | 3 CSS token sets (Khan, Purple Void, Tactical) | User-selectable in /profile |
| **Default Theme** | TBD (pending user decision) | — |
| **Design Tool** | v0.dev + shadcn/ui | AI-generated React components; no Figma export needed |
| **Polyglot** | Go (parsing) + Python (AI) | Best tool per job; avoid full rewrite |
| **App Infrastructure** | Google Cloud Platform | Unified billing with Gemini API |
| **Database** | Cloud SQL for PostgreSQL 15 | Managed; no self-hosting |
| **File Storage** | Google Cloud Storage | Demo + audio; 5GB free tier |
| **Task Queue** | Cloud Tasks (serverless) | 1M tasks/mo free |
| **Compute** | Cloud Run (serverless) | Scales to zero; separate containers per service |
| **Practice Servers** | DatHost API | Sub-10-second provisioning |
| **DatHost API Format** | `multipart/form-data` | JSON gives 500 error |
| **Server Tickrate** | 128-tick | Competitive standard |
| **CS2 Update Guard** | Steam News API (live detection) | No API key needed; 10-min cache; fails open |
| **HLTV Scraping** | Apify actor | Managed; no proxy/maintenance overhead |
| **Payments** | Stripe | 3-tier: Free / Basic $5 / Pro $20 |

---

## 16. Future Planned Features

- **Discord Bot** — In-server commands for analysis, reports, practice server management
- **Opponent Tendency Reports** — Pre-match intel on upcoming opponents from HLTV history
- **VOD / Clip Export** — Auto-clip flagged moments from demo for player review
- **Historical Trend Tracking** — Week-over-week improvement graphs; regression detection
- **Player Rating System** — Internal Elo-style rating per player per role
- **Training Session Stats** — Per-player stats per training mode; personal records
- **CounterStrikeSharp Plugins** — OpenPrefirePrac + CS2PracticeMod for in-server drills
- **Mobile Dashboard** — Responsive companion view
- **SCL Integration** — Per-match auto-coaching + pre-match opponent reports via SCL
- **Multi-language Support** — Coaching reports in player's native language

---

*This document is the single source of truth for the DemoSage platform. Update Progress Tracker checkboxes as work completes. All architectural decisions are logged in Section 15.*
