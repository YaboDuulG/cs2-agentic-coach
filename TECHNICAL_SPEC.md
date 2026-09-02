# 🏹 DemoSage — Technical Specification
> **Version:** 3.0.0 | **Status:** v3 Architecture — Implemented & Deployed (pipeline, grounded coaching, RAG engine, stratbook+Discord, billing, full frontend flow) | **Last Updated:** 2026-09-02

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
│  demo-resolver (Node)│   │  demo-parser (Go)           │
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
demo-resolver (Node) → fetches + pushes to GCS
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
- **Runtime:** Node.js (`demo-resolver` microservice)
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

### 4.3 Evidence-Grounded Coaching (implemented 2026-08)

Principle: **the LLM narrates, it never measures.** Everything numeric is computed
deterministically (Tactician) or looked up (pro baselines); the Scribe's only job is
selection, explanation, and drill prescription — with citations.

- **Evidence pack** (`agents/scribe/evidence.py`), built before any LLM call:
  - `facts` (IDs `F*`) — Tactician metrics with values and round lists (FCR rates,
    economy coherence flags, utility sequencing, rotation scores)
  - `baselines` (IDs `B*`) — numeric pro reference values from the `pro_baselines`
    table (metric + map + side lookup with `any` fallback). Baselines are **lookups,
    not vector searches** — you can't compare a 31% opening-duel rate to a paragraph.
  - `pro_examples` (IDs `P*`) — retrieved per *flagged* round (≤8 rounds × 2 chunks)
    with situation-keyed queries built from the round's real state (side, buy tier,
    outcome), not one static match-level query
- **Prompt contract** (versioned in `system_configs`): every claim must cite evidence
  IDs in square brackets; baseline gaps stated as numbers; "if the evidence doesn't
  cover it, write nothing." Synthesis output is **schema-enforced JSON**
  (`findings[]{claim, evidence_ids, rounds, severity, drill, audience}`), from which
  the legacy markdown reports are rendered — the raw findings are cached too, enabling
  future deep-links from finding → rounds in the 3D viewer.
- **Verification pass**: one flash call re-checks each finding against its cited
  evidence; unsupported findings are dropped and the drop count logged — this is the
  ongoing grounding metric (a rising drop-rate means the prompt or pack regressed).
- Round-analysis calls receive only their own round's data + round-scoped evidence.
- Global LLM concurrency gate (`SCRIBE_LLM_CONCURRENCY`, default 8) bounds Gemini
  fan-out under concurrent match load — no 429 cascades at hundreds of users.

Bootstrap baselines are seeded defaults marked for replacement by HLTV aggregates
(§5.4 nightly ingestion is the intended source).

### 4.4 Gemini Context Caching
Static RAG corpora (CS2 rules, meta snapshots, Discord strategies) are cached via Gemini's **Context Caching API** with a 30-60 minute TTL. Reduces TTFT by ~75% and token cost by 50-70% on repeated queries.

### 4.5 Incremental Re-runs
When a user edits notes (not demo data), the LangGraph graph uses **Node Bypass Rules** to skip RAG/Scout analysis and go straight to Scribe, reducing re-run latency from ~25s to <5s.

### 4.6 Streaming Response Protocol
All coaching endpoints use **Server-Sent Events (SSE)** to stream tokens to the frontend in real-time. Users see the AI "type" rather than wait for a spinner.

---

## 5. Data Pipelines

### 5.1 Upload → Parse → Coach Pipeline (v3 — DB job queue, implemented 2026-08)

```
POST /api/upload/presign
  → match row created (status PENDING, gcs_demo_uri stored up front)
  → browser PUTs .dem.gz directly to GCS via presigned URL(s)
         │
         ▼
POST /api/upload/compose  (chunked)          POST /api/upload/complete  (single chunk)
  → GCS compose, temp parts deleted             → confirms the object is final
  → enqueue_job(match_id, PARSE)                → enqueue_job(match_id, PARSE)
         │
         ▼
jobs table (Postgres) — claimed by services/worker with
SELECT ... FOR UPDATE SKIP LOCKED; retries with attempt cap; stuck-job sweep
         │
         ▼
Worker: POST demo-parser /parse (Go, gunzips .gz, streams from GCS)
  → batch-inserts kills / rounds / grenades to Postgres (multi-row inserts)
  → derives first_contacts (earliest kill per round), groups trajectories
  → match status → COMPLETE  ← stats visible to the user HERE (~60s)
  → enqueue_job(match_id, COACH)
         │
         ▼
Worker (bounded pool, COACH_CONCURRENCY): Great Khan LangGraph run
  → scout ∥ rag → tactician → scribe with evidence pack (see §4)
  → verified findings + legacy reports cached in coaching_notes
         │
         ▼
Frontend polls /api/jobs/{id}?light=true (status-only ticks; full payload
fetched once on done) and /api/coaching/{id} (20-min cap, self-heal enqueue)
```

**Why a DB job queue** (replaces GCS→Pub/Sub→Scout push *and* Cloud Tasks *and*
FastAPI BackgroundTasks): the v2 trio left the pipeline severed — compose never
enqueued anything, the Go parser's JSON response went back to Cloud Tasks and was
discarded, and coaching only started when a poll happened to arrive on an
already-COMPLETE match. One `jobs` table is transactional with the match rows it
describes, free, observable with plain SQL, safe for horizontal workers via
SKIP LOCKED, and works identically in LOCAL_MODE.

**Retired Architecture (V1/V2):**
*Python `demoparser2` scout: deprecated, container deleted. Pub/Sub OBJECT_FINALIZE
push subscription and Cloud Tasks parse-trigger: superseded by the jobs table.
SSE delivery and Parquet analytics export: not yet implemented (future).*

### 5.2 Auto-Ingestion (Zero-Upload Default — planned)
Auto-fetch from Steam/FACEIT match history remains the target default UX; it will
enqueue the same PARSE jobs as manual upload once ingestion lands.

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
| **Demo Resolver** | Node.js | `demo-resolver` microservice |
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
| `ci.yml` | Push / PR | Lint (ruff), type-check (mypy — non-blocking in CI, run locally for truth), unit tests, Go build+vet (parser job), frontend lint+tsc+build |
| `hltv-crawler.yml` | Manual (workflow_dispatch) | Pro-meta ingestion — schedule returns when Qdrant/crawler secrets are provisioned |
| `meta-snapshot.yml` | Weekly Mon 06:00 UTC | Generate weekly meta summary from pro matches |
| `docker-build.yml` | Push to `main` | Build and push Go microservice images |
| `deploy-staging.yml` | Push to `main` | Deploy full stack to the staging Cloud Run env (staging *branch* retired 2026-09) |
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

### Phase 4: Tactician (Complete ✅)
- [x] FCR module
- [x] Rotation efficiency
- [x] Utility sequencing
- [x] Economy coherence
- [x] Positional pattern detection

### Phase 5: Comms Analyst
- [ ] Gemini audio pipeline
- [ ] pyannote diarization
- [ ] Round clock alignment
- [ ] NLP evaluation modules

### Phase 6: Scribe (Complete ✅)
- [x] Report schema
- [x] Per-player + coach + strat card generators
- [x] SSE streaming delivery

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

### Phase V2-0: Security & Debt (Complete ✅)
- [x] Clerk JWT server-side validation on all routes
- [x] `Depends(get_db)` across all routes (remove inline SessionLocal)
- [x] All background jobs → Cloud Tasks (remove bare threads)
- [x] Alembic setup + first migration
- [x] CORS whitelist
- [x] Discord webhook HMAC
- [x] Postgres-backed LLM cache (replace SQLiteCache)

### Phase V2-1: Steam + FACEIT OAuth + Auto-Ingestion (Complete ✅)
- [x] Steam OpenID 2.0 login endpoint
- [x] FACEIT OAuth2 + PKCE flow (Redis backed)
- [x] `LinkedAccount` DB model + Alembic migration
- [x] `/api/oauth/status` endpoint
- [x] `/onboarding` frontend page
- [x] FACEIT Webhook ingestion (`match_status_finished`)
- [x] FACEIT match history fetch (`faceit_crawler.py`)
- [x] Demo deduplication (`is_cached` check)
- [x] Match source badge in UI

### Phase V2-2: Go Microservices (Complete ✅)
- [x] `services/demo-resolver/` — FACEIT + Steam GC resolver
- [x] `services/demo-parser/` — demoinfocs-golang wrapper
- [x] Internal REST API design for Go services
- [x] Dockerfile scaffolds for both services
- [x] GitHub Actions CI workflow for Go builds
- [x] Steam GC bot account setup & integration
- [x] GCS download implementation in `parse.go`
- [x] Replace Python Scout parser with Go HTTP call

### Phase V2-3: Qdrant Cloud + Dual-RAG (Complete ✅)
- [x] `db/qdrant_client.py` — singleton client, `@lru_cache`
- [x] `pro_playbook` collection schema + helpers
- [x] `player_tendency` collection schema + helpers
- [x] 8M vector nightly warning cron (GitHub Action)
- [x] Vector namespace isolation filters
- [x] Migrate HLTV embeddings from pgvector → Qdrant
- [x] Update `strat_reviewer.py` to Dual-RAG Qdrant queries

### Phase V2-4: MCP Server (Complete ✅)
- [x] `mcp>=1.0.0` added to requirements
- [x] `agents/mcp_server.py` — 5 tools + 1 resource (stdio transport)
- [x] `demosage-mcp` launcher in `pyproject.toml`
- [x] `docs/mcp_setup.md` — Antigravity + Claude Desktop config

### Phase V2-5: Frontend Redesign (Complete ✅)
- [x] 3-theme CSS token system (Khan / Purple Void / Tactical) in `globals.css`
- [x] `ThemeSwitcher` component
- [x] `/onboarding` page with Steam + FACEIT connect flow
- [x] `suppressHydrationWarning` on `<body>` for theme SSR safety
- [x] shadcn/ui `components.json` init
- [x] Theme switcher wired into `/profile` page
- [x] `/matches/[id]` match details page
- [x] `/coach` AI chat page
- [x] `/team/[id]` hub page
- [x] `/admin` dashboard with Qdrant quota widget
- [x] Match source badges (`⚡ FACEIT` / `⚡ Steam MM` / `📤 Manual`)

### Phase V2-6: Great Khan Refactor (Complete ✅)
- [x] Extract `agents/khan/` submodule (graph / nodes / prompts / rag / stats)
- [x] Unit tests per node
- [x] Postgres-backed LangChain cache

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
| **Background Jobs** | ~~Cloud Tasks~~ → **Postgres `jobs` table + SKIP LOCKED workers** (2026-08) | One queue, transactional with match rows, observable via SQL, horizontal workers safe; Cloud Tasks path was never wired to the real upload flow |
| **LLM Cache** | Postgres-backed (not SQLiteCache) | SQLiteCache wipes on Cloud Run cold start |
| **DB Migrations** | Alembic | No more raw ALTER TABLE on startup |
| **Auth** | Clerk JWT validated server-side | Never trust client-supplied user_id |
| **API Sessions** | `Depends(get_db)` with yield | Prevents session leaks |
| **Themes** | 3 CSS token sets (Khan, Purple Void, Tactical) | User-selectable in /profile |
| **Default Theme** | **The Great Khan** | Eternal Blue Sky, gold authority — applied on first sign-up |
| **Design Tool** | v0.dev + shadcn/ui | AI-generated React components; no Figma export needed |
| **Polyglot** | Go (parsing) + Python (AI) | Best tool per job; avoid full rewrite |
| **App Infrastructure** | Google Cloud Platform | Unified billing with Gemini API |
| **Database** | Cloud SQL for PostgreSQL 15 | Managed; no self-hosting |
| **File Storage** | Google Cloud Storage | Demo + audio; 5GB free tier |
| **Task Queue** | ~~Cloud Tasks~~ → **DB job queue** (2026-08) | See Background Jobs; `api/queue.py` retained only for non-pipeline tasks |
| **Compute** | Cloud Run (serverless) | Scales to zero; separate containers per service |
| **Practice Servers** | DatHost API | Sub-10-second provisioning |
| **DatHost API Format** | `multipart/form-data` | JSON gives 500 error |
| **Server Tickrate** | 128-tick | Competitive standard |
| **CS2 Update Guard** | Steam News API (live detection) | No API key needed; 10-min cache; fails open |
| **HLTV Scraping** | Apify actor | Managed; no proxy/maintenance overhead |
| **Payments** | Stripe | 3-tier: Free / Basic $5 / Pro $20 |
| **Parse persistence** | Python worker persists; Go parser stays a pure function (2026-08) | Parser JSON was previously discarded by Cloud Tasks; ORM models live in Python; batch multi-row inserts (10-50x vs row-by-row); parser gained gunzip for browser `.dem.gz` uploads |
| **First contacts / trajectories** | Derived in the worker from the kill feed / position samples (2026-08) | Earliest kill per round; positions grouped per (round, player) — no extra parser work |
| **Coaching execution** | Worker pool, not FastAPI BackgroundTasks (2026-08) | Cloud Run throttles CPU after the response is sent — background coaching was silently starved; `COACH_CONCURRENCY` bounds per-worker load |
| **Coaching grounding** | Evidence pack + citation contract + schema-enforced findings + verification pass (2026-08) | Tactician metrics previously never reached the prompts; see §4.3. Drop-rate of unverified findings is the grounding metric |
| **Pro baselines** | `pro_baselines` table (numeric lookups), not vectors (2026-08) | Comparisons need numbers; vector search reserved for situation-keyed pro examples |
| **LLM throughput** | Global semaphore `SCRIBE_LLM_CONCURRENCY` (2026-08) | ~25 Gemini calls/match × hundreds of users needs admission control, not 429 cascades |
| **Status polling** | `light=true` poll ticks + one full fetch on done; coaching cap 5→20 min (2026-08) | 3s polls were re-reading kill/round tables after completion; 5-min cap showed false errors under load |
| **Frontend design system** | CSS tokens + theme registry with `motifs` flag; ui primitives (2026-08) | Great Khan identity is one swappable theme; Emil Kowalski motion rules (sub-300ms, ease-out, reduced-motion floor) enforced in primitives |
| **CI Go coverage** | `parser` job: go build + go vet (2026-08) | The Go parser is load-bearing; nothing previously compiled it in CI |
| **Serving image deps** | `requirements-api.txt` in Dockerfile.api (2026-08) | Full requirements.txt pulled torch (pyannote), playwright, celery, vertexai into the Cloud Run image — multi-GB, 30-60s cold starts. Slim set = only what api/agents/db/worker import; verified by importing api.main + services.worker under it. Worker reuses the image with CMD `python -m services.worker` |
| **Demo phase gating** | GameStateGate in the Go parser (2026-09) | CS2 demos are all-or-nothing; kills/rounds/grenades were recorded ungated. Warmup/knife/postgame stripped; restarts discard prior segments; pauses = extended freezetime (no pause event in demoinfocs v4); strip report persisted to matches.phase_summary_json; zero-live-round demos fail loudly |
| **Pro-meta RAG** | services/rag_engine: S/A delta monitor → archetype extractor → hybrid retrieval (2026-09) | Hybrid = dense Qdrant + in-module BM25 fused by RRF; either leg degrades, never raises. Evidence builder retrieves hybrid-first with metadata filters; pro examples carry pro_match_id. Pro demos parse inline in the nightly cycle (jobs table FKs user matches; nightly volume doesn't need SKIP LOCKED) |
| **Analysis modes** | PERSONAL_IMPROVEMENT / TEAM_ANALYSIS / OPPOSITION_RESEARCH derived from match facts (2026-09) | Mode shifts synthesis focus + audiences; derived from is_recon/team context, never LLM-guessed |
| **Coaching Report Schema (report_v2)** | mode + summary{score,grade,headline} + key_findings{round,tick,category,severity,observation,benchmark,drill} (2026-09) | Score/grade computed from tactician metrics, ticks joined from first-contact evidence, benchmarks composed from cited B*/P* items — the LLM never grades or invents ticks |
| **Tier gating** | services/billing: read-time redaction, FREE = grade+summary+1 broad takeaway (2026-09) | Full report always cached; paywalled data OMITTED server-side (never client-hidden); upgrades unlock instantly. Plan flows via x-user-plan set by the trusted Next.js server route from Clerk; moves to user_entitlements table per refactor plan §3 |
| **Stratbook state machine** | strats + strat_revisions: DRAFT→IN_REVIEW→ACTIVE→ARCHIVED; new revision on ACTIVE re-enters review (2026-09) | Changes to a live strat always pass review before the team runs them; TeamPlaybook rows backfilled as ACTIVE rev-1 |
| **Discord integration** | HTTP Interactions endpoint, not a gateway bot (2026-09) | Slash commands/buttons/modals over signed HTTPS: no discord.js/nextcord dep, no 4th always-on service, Cloud Run scale-to-zero. Ed25519 verify via the cryptography package (fails closed outside LOCAL_MODE). Trade-off: no free-text @mention listening — AI refinement is /strat adapt in-thread |
| **Discord tenancy** | HMAC bind codes: web issues `team_id.hmac12` (DISCORD_WEBHOOK_SECRET); /strat bind ties one guild↔one team (2026-09) | A guild cannot attach to a team without its signed code; every interaction resolves guild→team before touching data |
| **Discord sync transport** | Transactional sync_outbox drained by the worker (SKIP LOCKED) (2026-09) | HTTP handlers only INSERT (same transaction as the strat change) — a Discord outage never blocks a web/interaction response; retries with attempt cap |
| **Subscription authority** | subscriptions table written by the Stripe webhook fan-out (2026-09) | Next.js keeps the Stripe SDK + signature verify, updates Clerk (display) AND POSTs normalized events to /api/billing/sync (shared secret) — DB is the entitlement truth; no Stripe lookups on request paths |
| **Three-tier matrix** | FREE / SOLO_PRO (basic) / TEAM (pro) with a cumulative entitlement matrix (2026-09) | basic_analysis → +full_coaching → +team_analysis/team_scouting/stratbook_sync; TIER_NEEDED drives upgrade metadata in 402s and teasers |
| **Grace periods** | past_due keeps the tier until period_end+7d; canceled until period_end (2026-09) | invoice.payment_failed → past_due sync sets grace_until; expiry mid-analysis just changes what the next read returns (reports are gated at read time) |
| **Team seats** | members inherit team-scoped entitlements from a TEAM-tier owner (2026-09) | team_analysis/scouting/stratbook only, and only on that team's resources; personal full_coaching is not inherited |
| **Entitlement cache** | in-process TTL (60s) invalidated by the sync endpoint — deliberately no Redis (2026-09) | The constraint's intent (no Stripe per request) is met by DB authority; a second stateful service isn't warranted, and TTL bounds cross-instance staleness |
| **Teaser payloads** | Team/Oppo reports without the tier return mode+grade+category histogram only (2026-09) | Tactical specifics (observations, rounds, ticks, drills) are omitted server-side, never client-filtered; upgrade metadata included |
| **Qdrant deferred** | Not provisioned; retrieval runs BM25-only until activated (2026-09) | The hybrid retriever degrades to its keyword leg by design, so semantic search is an upgrade, not a dependency. The 8M-vector quota-check workflow was deleted (monitored a cluster that didn't exist, at a scale six orders of magnitude away). Activation: create a free-tier cluster, set QDRANT_URL/QDRANT_API_KEY in Secret Manager + the deploy secrets list, re-add the hltv-crawler cron — no code changes |
| **Frontend flow (v3)** | One journey: landing → Command Center → SoyomboProgress wait → debrief → Team Hub (2026-09) | Emil Kowalski frequency-gated motion budget; SoyomboProgress is the single delight-budget moment (replaced a stock video background); every page shares one skeleton + one entrance; findings deep-link into the 2D replay; paywall appears as enticement (server-driven teasers, plan-aware upsell) |
| **Error surfaces** | House toast system replaces browser alert() (2026-09) | Nine call sites migrated; fixing them exposed that stratbook saves were 404ing (no proxy route + hardcoded test user) — both repaired |
| **Mode-scoped lists** | /api/analyses scope=personal\|team follows the coaching-mode toggle (2026-09) | Team scope joins through team_members; Command Center relabels + refetches on toggle; profile gains an opposition-research filter |
| **Data architecture blueprint** | DATA_ARCHITECTURE.md — hybrid relational/vector/blob design + SFT/DPO fine-tuning data engine (2026-09) | Blueprint-first per module 6: canonical map_zones abstraction (no raw coords in LLM context), damages/flash_events partitioned tables, round_features aggregates, training_samples with match-level splits and amateur-blunder DPO rejected samples (anonymized), explicit HLTV delta state machine. Deviations logged in its §7 (no TimescaleDB/Pinecone; GCS over S3) |
| **Frontend data layer** | Zustand (playback) + TanStack Query (server cache) added; shadcn/ui rejected (2026-09) | Playback tick state must not re-render analytics UI — canvas reads the store in a rAF loop with zero React state; Query replaces hand-rolled poll loops. shadcn would fork the existing token-native ui primitives |
| **2D demo viewer** | components/minimap + /rounds/{n}/telemetry endpoint (2026-09) | Radar canvas at 60fps isolation, interpolated 2s-sampled trails; documented approximations: bounding-box map projection (pending per-map radar calibration), motion-derived vision cones (no view angles in telemetry) |
| **Mode dashboard + paywall UX** | Personal/Team/OppoResearch views + GatedInsightCard driven ONLY by server payload state (2026-09) | Components visualize what the server already omitted (full / FREE-redacted / teaser shapes from services/billing); no client-side gating. Recharts (specific imports only) for the category radar |
| **Side colors** | Semantic --color-ct / --color-t tokens per theme (2026-09) | Khan maps them to its own blue/gold; other themes use the module-5 palette (#4A90E2/#E58E26). Prompt's slate/zinc repaint rejected — the token system stays |
| **Route groups** | (auth)/(dashboard) regrouping deferred (2026-09) | URL-neutral cosmetic move; deferred as a mechanical pass rather than churning a 3k-line page mid-feature. New pages (/scouting) added flat to match |

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
