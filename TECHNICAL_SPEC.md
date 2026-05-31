# 🏹 DemoSage — Technical Specification & Progress Tracker
> **Version:** 0.5.0-beta | **Status:** Phase C Active — Training Server System | **Last Updated:** 2026-05-27

---

## 📋 Table of Contents
1. [Project Vision](#1-project-vision)
2. [System Architecture](#2-system-architecture)
3. [Agent Definitions (The Horde)](#3-agent-definitions-the-horde)
4. [AI Reasoning & Knowledge Layer](#4-ai-reasoning--knowledge-layer)
5. [Data Pipelines](#5-data-pipelines)
6. [Integrations](#6-integrations)
7. [Practice Server System](#7-practice-server-system)
8. [GitHub Actions Plan](#8-github-actions-plan)
9. [Tech Stack](#9-tech-stack)
10. [Progress Tracker](#10-progress-tracker)
11. [Decisions Made](#11-decisions-made)
12. [Future Planned Features](#12-future-planned-features)

---

## 1. Project Vision

**DemoSage** is an AI-powered CS2 coaching ecosystem that ingests match demos, team communications, and live competitive intelligence to deliver actionable, context-aware coaching feedback — covering both individual and team-level performance.

### Core Pillars

| Pillar | Description |
| :--- | :--- |
| **Match Analysis** | Parse `.dem` files from FACEIT/Matchmaking and generate detailed round-by-round breakdowns |
| **Communication Coaching** | Transcribe and analyze uploaded team audio for callout quality, IGL clarity, and morale patterns |
| **Pro Intelligence Feed** | Continuously ingest HLTV pro match data to inform agent reasoning with current meta |
| **Platform Integrations** | Connect to FACEIT API for automatic per-match coaching sessions |
| **Practice Server** | Spin up a CounterStrikeSharp-powered practice server on demand with multiple modes |

> **Scope:** Single team. Multi-team / multi-tenant support is a future planned feature.

---

## 2. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│              Chat UI + Dashboard + Upload Portal                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                  THE GREAT KHAN (Orchestrator)                  │
│           LangGraph Supervisor — Routes & synthesizes           │
└──┬───────────┬──────────────┬──────────────┬────────────────────┘
   │           │              │              │
   ▼           ▼              ▼              ▼
[Scout]   [Tactician]   [Comms Analyst]  [Khan's Library]
Demo       Round/map      Audio upload     Pro match RAG
parser     analysis       & NLP           knowledge base
   │           │              │              │
   └───────────┴──────────────┴──────────────┘
                            │
               ┌────────────▼────────────┐
               │      [The Scribe]        │
               │  Report + Strat Card    │
               │      Generator          │
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │    [The Warlord]         │
               │  Practice Server Mgr    │
               └─────────────────────────┘
```

### LangGraph Topology

- **Pattern:** Hierarchical Supervisor with parallel fan-out
- **State Store:** PostgresSaver (persistent across sessions)
- **Observability:** LangSmith tracing on all agent nodes
- **Parallelism:** Scout + Comms Analyst run concurrently via LangGraph `Send` API
- **Routing:** Supervisor uses tool-calling handoffs (not library-based) for clean context engineering

### Execution Flow (Match Upload)

```
Upload .dem + audio
      │
      ├──► Scout (demo parse) ──────────────────────────┐
      │                                                  │
      └──► Comms Analyst (audio transcribe + NLP) ───── ┤
                                                         │
                                          Khan's Library (RAG) ─► Tactician
                                                         │
                                                    Great Khan (synthesize)
                                                         │
                                                     The Scribe
                                                         │
                                              Final Coaching Report
```

---

## 3. Agent Definitions (The Horde)

### 🏰 The Great Khan — Orchestrator
- **Role:** Central supervisor. Receives user queries, routes to appropriate agents, synthesizes final output.
- **LLM:** `gemini-2.5-pro` — *Rationale: Orchestration requires the strongest reasoning to handle ambiguous routing decisions, synthesize multi-agent outputs into coherent coaching, and enforce guardrails. Runs once per user session (not per round), so the cost premium is justified.*
- **Responsibilities:**
  - Parse intent: is this a stat query, tactical question, or server request?
  - Fan out tasks to workers in parallel where possible
  - Maintain session state and conversation history
  - Enforce hallucination guardrails (cross-check agent outputs against structured data)
- **Guardrails:** All tactical claims must be grounded in parsed demo data or RAG-retrieved pro match context. Ungrounded claims are flagged and withheld.

---

### 🛰️ The Scout — Demo Parser
- **Role:** Extract raw structured data from CS2 `.dem` files
- **Runtime:** Dockerized Python environment (awpy + demoparser2)
- **LLM:** **None** — *Rationale: Demo parsing is deterministic code (awpy + demoparser2). No LLM needed. If anomaly flagging is added later (e.g., detecting corrupted rounds), use `gemini-2.0-flash-lite` at minimal cost.*
- **Outputs (JSON):**
  - Kill events (weapon, distance, head/body, attacker position, victim position)
  - Grenade/utility events (throw position, landing position, type, timing)
  - Player trajectories per round (heatmap-ready coordinate streams)
  - Round metadata (economy, outcome, site contested, CT/T side)
  - "First Contact" events — first engagement per round per player
- **Trigger:** File upload OR FACEIT/SCL webhook → auto-queued

---

### 🛡️ The Tactician — Agentic Analyst
- **Role:** Evaluate tactical decisions using structured demo data + pro match knowledge
- **LLM:** `gemini-2.5-flash` (thinking mode enabled) — *Rationale: Chain-of-thought tactical reasoning per round is high-volume (30 rounds × N players per match). Flash with thinking retains deep reasoning capability at ~10× lower cost than 2.5 Pro. Thinking mode is critical for multi-step cause-effect analysis (e.g., "the force-buy caused the rotation gap that lost the round").*
- **Analysis Modules:**
  - **FCR (First Contact Resolution):** Did the first duel win or lose the round? Was it avoidable?
  - **Rotation Efficiency:** Are rotations timed correctly relative to site pressure?
  - **Utility Sequencing:** Is utility thrown in a tactically sound order? Compare vs. pro patterns.
  - **Economy Coherence:** Are force-buys justified? Is saving optimal given round context?
  - **Positional Patterns:** Identify over-peeking, passive-play imbalances, default tendencies
- **Output:** Structured JSON per player per round with severity scores (critical/warning/positive)
- **Tone:** Reports always include **positives** alongside suggestions — coaching is constructive

---

### 🎙️ The Comms Analyst — Communication Coach
- **Role:** Transcribe team audio and evaluate communication quality
- **LLM:** `gemini-2.5-flash` — *Rationale: NLP pattern classification (tilt detection, IGL clarity scoring, callout accuracy) requires solid language understanding but not the full reasoning depth of 2.5 Pro. Flash handles structured classification well at high volume (one call per round per match).*
- **Pipeline:**
  1. Accept `.mp3`/`.wav`/`.ogg` audio upload (team recording)
  2. Transcribe via **Gemini 2.5 Flash** (native audio input — eliminates need for separate Whisper service)
  3. Diarize speakers (identify who is talking) via **pyannote.audio**
  4. Align transcript timestamps to demo round clock
  5. Analyze with NLP agent:
     - Callout accuracy (did callout match actual kill location?)
     - IGL clarity (clear, concise calls vs. rambling/contradictory)
     - Tilt/morale patterns (negative language, shouting, silence after deaths)
     - Missing comms (critical round events with no audio callout)
- **Output:** Per-round communication score + flagged moments with clip timestamps

---

### 📚 Khan's Library — Pro Intelligence RAG
- **Role:** Provide the Tactician with up-to-date pro-level tactical knowledge
- **LLM (Embeddings):** `text-embedding-004` — *Rationale: Google's dedicated embedding model. Cheapest and most efficient for generating pgvector embeddings at scale (thousands of pro rounds nightly).*
- **LLM (Summarization):** `gemini-2.0-flash` — *Rationale: Generating meta snapshots and tactical pattern summaries from parsed JSON is a structured summarization task, not deep reasoning. 2.0 Flash is fast and cost-effective for nightly batch jobs.*
- **Knowledge Sources:**
  - HLTV match demos (auto-ingested — see Section 5.3)
  - Parsed pro round data: utility lineups, default positions, execute timings
  - Team-specific tendency profiles (e.g., "NaVi B-site setups on Mirage")
- **Storage:** Vector embeddings in **pgvector** (PostgreSQL extension)
- **Retrieval:** Semantic search — Tactician queries "what do top teams do in this situation?"
- **Update Frequency:** Nightly GitHub Action (see Section 8)

---

### 💬 Discord Integration & Strategy Playbook
- **Role:** Allow real-time ingestion of team-written strategies from Discord and interactive refinement on the web application dashboard.
- **Webhook Receiver:** Public FastAPI route (`POST /api/discord/webhook`) backed by a Next.js proxy route.
- **LLM parsing:** Converts unstructured Discord messages into a structured strategy card (`title`, `map_name`, `side`, `summary`, `steps`) using `gemini-2.0-flash` with JSON response mode.
- **RAG Storage:** Generates a 768d vector via `models/text-embedding-004` and stores the strategy under the source `"team_strategy"`.
- **Strategy Chat:** Interactive web client chat queries this team-specific strategy collection using semantic search and cosine similarity, powered by the Great Khan bot.

---

### 📜 The Scribe — Report Generator
- **Role:** Compile all agent outputs into a polished, human-readable coaching report
- **LLM:** `gemini-2.0-flash` — *Rationale: Report generation is a structured writing task — it assembles pre-analyzed JSON into readable prose using a fixed template. No chain-of-thought reasoning needed. 2.0 Flash produces high-quality prose quickly and cheaply.*
- **Report Types:**
  - **Player Report** *(private — visible to that player only)*: Individual performance, personal drills, personal positives/issues
  - **Coach Report** *(separate aggregate — visible to coach only)*: All 5 players summarised in one view, cross-player patterns, team-level tactical notes
  - **Strat Card** *(team-level, shareable)*: Markdown summary for team prep, no individual criticism
  - **JSON summary** for frontend dashboard rendering
- **Report Sections (each report type):**
  - 🟢 **What You Did Well** (always first — constructive framing)
  - 🟡 **Areas to Improve** (tactical + communication)
  - 🔴 **Critical Issues** (high-severity patterns, repeated mistakes)
  - 📋 **Suggested Drills** (links to practice server modes)
  - 🎯 **Pro Reference** (relevant pro match examples from RAG)

---

### ⚔️ The Warlord — Practice Server Manager
- **Role:** Provision, configure, and manage CS2 practice servers on demand
- **LLM:** `gemini-2.0-flash` — *Rationale: Intent parsing for server commands (map name, mode, slot count) is a simple extraction task. 2.0 Flash handles structured tool-call dispatch with low latency, which matters here since the user expects an instant response.*
- **Trigger:** User chat command e.g. "spin up a prefire server on Mirage"
- **See Section 7 for full spec**

---

### 💰 Gemini Model Cost Strategy Summary

| Agent | Model | Why |
| :--- | :--- | :--- |
| Great Khan | `gemini-2.5-pro` | Highest reasoning for orchestration & synthesis; runs once per session |
| The Scout | **None** | Pure deterministic code (awpy); no LLM cost |
| The Tactician | `gemini-2.5-flash` + thinking | Deep per-round reasoning at high volume; ~10× cheaper than 2.5 Pro |
| The Comms Analyst | `gemini-2.5-flash` | Structured NLP classification at per-round volume; native audio input |
| Khan's Library (embed) | `text-embedding-004` | Cheapest embedding model for nightly batch vector generation |
| Khan's Library (summarize) | `gemini-2.0-flash` | Batch meta-snapshot generation; no reasoning depth needed |
| The Scribe | `gemini-2.0-flash` | Template-driven prose generation; fast and cheap |
| The Warlord | `gemini-2.0-flash` | Simple intent extraction + tool dispatch; needs low latency |

---

## 4. AI Reasoning & Knowledge Layer

This is the core challenge: **teaching the AI to reason like a CS2 coach, not just report statistics.**

### 4.1 Strategy: Structured Domain Knowledge Injection

Rather than relying solely on LLM priors, all agents are grounded by a curated, continuously updated knowledge base:

| Layer | Content | Format |
| :--- | :--- | :--- |
| **CS2 Game Rules Corpus** | Economy rules, map callouts, grenade physics, round timing | Markdown docs → embedded |
| **Pro Match Library** | Parsed HLTV demos: positions, utility, execute patterns | Structured JSON → pgvector |
| **Tactical Playbook** | Authored strats, anti-strat concepts, mid-round adjustments | Markdown → embedded |
| **Meta Snapshots** | Weekly summaries of current competitive meta (which maps, which setups) | Auto-generated by Meta Agent |

### 4.2 Chain-of-Thought Prompting

Tactician agent uses explicit **step-by-step reasoning prompts**:

```
Given:
- Round economy: [data]
- First contact outcome: [data]  
- Utility thrown: [data]
- Pro match reference: [RAG result]

Step 1: Evaluate the economic context. Was a force-buy correct?
Step 2: Assess the first contact — was the duel taken at a disadvantage?
Step 3: Compare utility usage against pro reference. What was missing?
Step 4: Identify the root cause of the round loss/win.
Step 5: State 1 specific improvement and 1 positive observation.
```

### 4.3 Hallucination Guardrails

- All tactical claims validated against demo-parsed structured data
- If a claim cannot be grounded in data, the Great Khan withholds it and flags it
- Agent outputs include a `confidence_score` field — low-confidence outputs are disclosed to the user
- Pro match citations always include source match ID and round number

### 4.4 HLTV Pro Match Reasoning Pipeline

```
HLTV scraper detects new match
        │
        ▼
Download .dem if available / scrape scoreboard & stats
        │
        ▼
Scout parses demo → structured JSON
        │
        ▼
Tactician extracts: utility lineups, positions, execute patterns
        │
        ▼
Embeddings generated → stored in pgvector with metadata:
  { team, opponent, map, date, tournament, round_context }
        │
        ▼
Khan's Library updated — available for next Tactician query
```

---

## 5. Data Pipelines

### 5.1 Demo Upload Pipeline

```
POST /api/upload/demo
  → Validate file (must be .dem, CS2 format)
  → Queue in Redis task queue (Celery worker)
  → Scout agent triggered in Docker container
  → Structured JSON written to PostgreSQL
  → Great Khan notified → Tactician + Comms Analyst triggered
  → Scribe generates report
  → User notified via webhook/UI
```

### 5.2 Audio Upload Pipeline

> **Audio workflow:** Manual file upload (`.mp3`/`.wav`/`.ogg`). Record team comms externally (e.g. Craig bot in Discord, OBS, or any screen recorder) and upload after the match.

```
POST /api/upload/audio
  → Accept .mp3 / .wav / .ogg (max 2GB)
  → Gemini 2.5 Flash transcription (native audio input — no Whisper needed)
  → pyannote diarization (speaker separation)
  → Timestamps aligned to demo round clock (requires matching demo upload)
  → Comms Analyst NLP evaluation
  → Output merged with Tactician output in Scribe
```

### 5.3 HLTV Ingestion Pipeline (Automated)

> **Approach:** Use **Apify's HLTV scraper actor** — managed scraping service that handles Cloudflare bypass, proxy rotation, and maintenance automatically. No self-managed browser infrastructure needed.

```
GitHub Action: runs nightly (cron: 0 2 * * *)
  → Trigger Apify HLTV actor via REST API
  → Receive new match results as structured JSON (no HTML parsing)
  → For each new match: queue Scout parse job (if demo available)
  → Tactician extracts tactical patterns
  → pgvector embeddings updated
  → Meta snapshot refreshed
```

**Tech:** Apify platform (HLTV actor), Redis dedup queue to avoid re-processing matches

---

## 6. Integrations

### 6.1 FACEIT Integration

| Feature | Implementation |
| :--- | :--- |
| **Auth** | OAuth2 via FACEIT Developer Portal |
| **Match Webhooks** | Register webhook → auto-trigger demo analysis on match end |
| **Player Stats** | `GET /players/{player_id}/stats/{game}` — pull Elo, win rate, map stats |
| **Match History** | `GET /players/{player_id}/history` — last N matches for trend analysis |
| **Demo Download** | FACEIT provides demo URLs in match data — auto-download to Scout queue |
| **Hub/League Data** | Fetch SCL hub roster and match schedule |

**Flow:** Match ends on FACEIT → webhook → auto-download demo → Scout queues parse → full coaching report auto-generated → user notified

### 6.2 Platform Architecture

```
[FACEIT Webhook] ──► API Gateway ──► Redis Queue ──► Worker Pool
[Manual Upload]  ──► API Gateway ──►     │
                                          ▼
                                   Scout / Comms Analyst
                                          │
                                     Great Khan
                                          │
                                       Scribe
                                    ┌────┴─────┐
                             [Player Reports] [Coach Report]
                                          │
                                Report stored in DB
                                          │
                               User Dashboard / Chat UI
```

---

## 7. Practice Server System

Inspired by **SCL practice modes**. The Training Server panel lets team members pick a mode and spin up a DatHost server instantly — fully configured with the correct console commands for that mode.

### 7.1 Architecture

- **Hosting:** **DatHost** — on-demand instant CS2 server provisioning via REST API (`multipart/form-data`)
- **Tickrate:** **128-tick** on all provisioned servers (`cs2_settings.tickrate=128`)
- **Game Mode:** `competitive` (or `deathmatch` for aim/spray modes)
- **Lifecycle:** 2-hour TTL; cron job (`/api/servers/cron/cleanup`) auto-terminates expired servers
- **Mode Config:** Each mode applies a set of RCON console commands after server start (sv_cheats, infinite ammo, grenade trajectory, etc.)
- **Update Guard:** Live CS2 update detection via Steam News API — provisioning is blocked for 2h after a real Valve update is posted; fails open if Steam API is unreachable

### 7.2 Training Modes (Implemented)

| Mode Key | Label | Game Mode | Key Console Commands |
| :--- | :--- | :--- | :--- |
| `practice` | Practice Mode | competitive | sv_cheats 1, infinite ammo, bot_kick, mp_startmoney 60000 |
| `prefire` | Prefire Mode | competitive | sv_cheats 1, infinite ammo, 60min rounds, bot_kick |
| `defense` | Defense Mode | competitive | sv_cheats 1, infinite ammo, mp_freezetime 3 |
| `tradefire` | Tradefire Mode | deathmatch | sv_cheats 1, DM bonus off, infinite ammo |
| `spray` | Spray Transfer/Pattern | deathmatch | sv_cheats 1, ammo clip only (sv_infinite_ammo 2), recoil scale 2 |
| `awp` | AWP Mode | deathmatch | sv_cheats 1, AWP-only infinite ammo, DM |
| `aimtrainer` | Aim Trainer | deathmatch | sv_cheats 1, hard bots (difficulty 3) |
| `promode` | Pro Mode | competitive | sv_cheats 0, real economy (800 start), standard rules |
| `grenade` | Grenade Learner | competitive | sv_cheats 1, trajectory visualization on, 15s display, bot_kick |
| `retake` | Retake Mode | competitive | sv_cheats 1, 4000 start money, short rounds |

### 7.3 Training Modes UI

- **Route:** `/teams/[teamId]/training`
- **Layout:** 2-column image card grid (matching SCL Training Server design)
- **Features:**
  - Click card to select mode → region + map dropdowns → "Start Training Session"
  - Active server banner: copy-to-clipboard connect string + password
  - Live CS2 update warning banner (populated with real Steam News API detail)
  - Search/filter across modes and tags
  - Statistics tab (placeholder for session stats)
- **Team Page:** Practice Server card replaced with Training Server launcher (3-image preview strip linking to `/training`)

### 7.4 CS2 Update Detection (Steam News API)

```python
# services/warlord/dathost_client.py
def check_cs2_update_active() -> tuple[bool, str]:
    # Calls api.steampowered.com/ISteamNews/GetNewsForApp — no API key needed
    # Looks for "release notes" / "cs2 update" in last 5 CS2 announcements
    # Returns (is_active, human-readable detail with time remaining)
    # Cached 10 min in-process; fails open if Steam API unreachable
    # Block window: UPDATE_BLOCK_DURATION_SECONDS (default 7200 = 2h, env-configurable)
```

### 7.5 Server API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/teams/{id}/servers` | POST | Provision server — validates mode, checks update window |
| `/api/teams/{id}/servers` | GET | List active servers for team |
| `/api/servers/{id}` | DELETE | Terminate server |
| `/api/servers/modes` | GET | List training modes + live update status |
| `/api/servers/webhook` | POST | DatHost ping when server is ready |
| `/api/servers/cron/cleanup` | POST | Vercel cron — destroy expired servers |

### 7.6 Utility Auto-Updater (Planned)

> Keeps all grenade lineups and prefire routes current with each CS2 patch.

- **GitHub Action:** Runs after each CS2 update (triggered by Steam DB change detection)
- **Process:**
  - Detect map geometry changes via checksum comparison
  - Pull latest community lineup database (community-contributed JSON)
  - Run validation pass: verify lineups still land correctly (automated bot test)
  - Push validated updates to server plugin config
  - Notify users of updated/removed lineups

---

## 8. GitHub Actions Plan

### Actions Overview

| Action | Trigger | Purpose |
| :--- | :--- | :--- |
| `ci.yml` | Push / PR | Lint, type-check, run unit tests |
| `hltv-ingest.yml` | Nightly cron (02:00 UTC) | Scrape HLTV for new matches, queue parse jobs |
| `utility-updater.yml` | CS2 update detected (SteamDB webhook) | Validate and update grenade/prefire lineups |
| `meta-snapshot.yml` | Weekly (Monday 06:00 UTC) | Generate weekly meta summary from pro match data |
| `docker-build.yml` | Push to `main` | Build and push Scout Docker image to registry |
| `deploy-staging.yml` | Push to `staging` | Deploy full stack to staging environment |
| `deploy-prod.yml` | Release tag | Deploy to production with smoke tests |

### `hltv-ingest.yml` — Key Steps

```yaml
- name: Run HLTV watcher
  run: python services/hltv_watcher/main.py --mode=scheduled

- name: Queue new match demos for parsing
  run: python scripts/queue_demo_jobs.py

- name: Update pgvector embeddings
  run: python scripts/update_knowledge_base.py

- name: Regenerate meta snapshot
  if: steps.hltv.outputs.new_matches > 0
  run: python scripts/generate_meta_snapshot.py
```

### `utility-updater.yml` — Key Steps

```yaml
- name: Detect CS2 map changes
  run: python scripts/detect_map_changes.py

- name: Pull latest community lineups
  run: python scripts/fetch_community_lineups.py

- name: Validate lineups with bot test
  run: python scripts/validate_lineups.py

- name: Push updates to server configs
  run: python scripts/deploy_lineup_configs.py

- name: Notify users of changes
  run: python scripts/notify_lineup_changes.py
```

---

## 9. Tech Stack

| Component | Technology | Notes |
| :--- | :--- | :--- |
| **Language** | Python 3.12+ | Backend and agents |
| **Agent Framework** | LangGraph + LangChain | Supervisor pattern, stateful handoffs |
| **LLM Provider** | Google Gemini API (Vertex AI) | Single provider, unified GCP billing |
| **LLM — Orchestration** | `gemini-2.5-pro` | Great Khan only |
| **LLM — Analysis** | `gemini-2.5-flash` (thinking) | Tactician + Comms Analyst |
| **LLM — Generation** | `gemini-2.0-flash` | Scribe + Warlord + Library summarization |
| **LLM — Embeddings** | `text-embedding-004` | Khan's Library vector store |
| **Demo Parsing** | awpy + demoparser2 | Dockerized, CS2-native; no LLM used |
| **Audio Transcription** | Gemini 2.5 Flash (native audio) | Direct audio → text; no separate service |
| **Speaker Diarization** | pyannote.audio | Speaker separation |
| **Database + pgvector** | **Cloud SQL for PostgreSQL** (Enterprise, shared-core) | ~$10/mo; pgvector extension enabled; LangGraph PostgresSaver |
| **File Storage** (demos, audio) | **Google Cloud Storage (GCS)** | 5GB free, then $0.02/GB; no egress within region |
| **Task Queue** | **Cloud Tasks** | Serverless; 1M tasks/mo free; replaces Celery + Redis |
| **API + Agent Compute** | **Cloud Run** | Serverless containers; 2M req/mo free; scales to zero |
| **Batch Jobs** (HLTV, parsing) | **Cloud Run Jobs** | Pay per execution only; no idle cost |
| **HLTV Scraper** | Apify actor (managed) | No self-hosted browser infra needed |
| **Observability** | LangSmith + Cloud Logging | Agent traces + infra logs |
| **Practice Server** | CS2 Dedicated + CounterStrikeSharp | DatHost API on-demand game servers |
| **CS2 Plugins** | OpenPrefirePrac, CS2PracticeMod | MIT licensed, open source |
| **CI/CD** | GitHub Actions | See Section 8 |
| **Frontend** | Next.js 15 → Cloud Run | Chat UI + Dashboard |

---

## 10. Progress Tracker

### Phase 0: Foundation & Scaffolding
- [x] Initialize monorepo structure (`/agents`, `/services`, `/plugins`, `/frontend`, `/infra`)
- [x] Create GCP project + enable billing
- [x] Enable APIs: Cloud SQL, Cloud Storage, Cloud Tasks, Cloud Run, Vertex AI, Artifact Registry, Secret Manager
- [x] Provision Cloud SQL instance (PostgreSQL 15, db-f1-micro shared-core) + pgvector enabled
- [x] Create GCS bucket (`cs2-demosage`) for demo and audio file storage
- [x] Set up Cloud Tasks queue for async job dispatch
- [x] Configure local `.env` with GCP credentials
- [x] Set up Docker Compose for **local dev only** (mirrors Cloud SQL schema locally with PostgreSQL)
- [ ] Set up LangSmith project + connect API key
- [x] Scaffold FastAPI app with health check endpoint → deployed to Cloud Run (staging)
- [x] Create base GitHub Actions (CI lint/test + Cloud Run deploy on push to `staging`)
- [x] Define full SQLAlchemy ORM schema (`db/models.py`) — Match, Kill, Grenade, Round, FirstContact, PlayerTrajectory
- [x] Create one-shot GCP provisioning script (`scripts/setup_gcp.py`)
- [x] Create local end-to-end pipeline runner (`scripts/run_local.py`)

### Phase 1: The Scout — Demo Pipeline
- [x] Set up demoparser2 Docker image (switched from awpy — Python 3.12 compatible, faster Rust parser)
- [x] Implement kill event extraction
- [x] Implement player coordinate trajectory streaming (sampled per N ticks)
- [x] Implement utility event extraction (grenade throws, lands, type)
- [x] Implement round metadata extraction (economy, outcome)
- [x] Implement "First Contact" event detection
- [x] Expose Scout as internal HTTP service with Cloud Tasks queue interface (`services/scout/service.py`)
- [x] Validate output against local demo — de_nuke 64tick: 26 rounds, 185 kills, 232 grenades ✓
- [x] Scout deployed to Cloud Run staging (internal, no-allow-unauthenticated)
- [x] Pub/Sub push trigger: GCS OBJECT_FINALIZE → `demo-uploaded` topic → Scout `/parse-from-gcs`
- [x] **Warmup round filtering** — two-rule system: `is_warmup_period` flag (primary) + equipment budget fallback (≤$4,500 combined = pistol round or earlier); excludes warmup from kills, grenades, first_contacts, player stats, KAST
- [x] **KAST fix** — survival loop now iterates actual `valid_round_nums` set instead of `range(tot_r)` (was generating incorrect sequential indices)
- [x] `warmup_rounds_excluded` list added to `metadata` output for debugging
- [ ] Validate output against real CS2 FACEIT / Matchmaking demo (pending FACEIT integration)

### Phase 2: The Great Khan — Orchestrator
- [x] Define global LangGraph state schema
- [x] Implement supervisor node with tool-calling handoffs
- [x] Implement router logic (stat query vs. tactical vs. server request)
- [x] Integrate PostgresSaver for persistent state
- [x] Add hallucination guardrail layer
- [x] Implement confidence scoring on agent outputs

### Phase 3: Khan's Library — RAG Knowledge Base
- [x] Author CS2 game rules corpus (economy, map callouts, round timing)
- [x] Build embedding pipeline (chunk → embed → store in pgvector)
- [x] Set up Apify account + configure HLTV actor (code implemented; credentials needed)
- [x] Build pro match parse → embed pipeline
- [x] Set up nightly GitHub Action for HLTV ingestion
- [x] Implement semantic retrieval for Tactician queries
- [x] Implement Discord webhook strategy ingestion (Option 2)
- [x] Build RAG tactics chatboard on the team detail page

### Phase 4: The Tactician — Tactical Analysis
- [x] Implement FCR (First Contact Resolution) module
- [ ] Implement rotation efficiency analysis
- [ ] Implement utility sequencing evaluation
- [ ] Implement economy coherence analysis
- [ ] Implement positional pattern detection
- [ ] Connect to Khan's Library for pro reference retrieval
- [ ] Chain-of-thought prompt engineering for reasoning

### Phase 5: The Comms Analyst — Audio Pipeline
- [ ] Configure Gemini 2.5 Flash audio input pipeline (replaces Whisper)
- [ ] Set up pyannote diarization pipeline
- [ ] Implement demo clock alignment (transcript ↔ round events)
- [ ] Implement callout accuracy analysis
- [ ] Implement IGL clarity scoring
- [ ] Implement morale/tilt pattern detection
- [ ] Build audio upload endpoint

### Phase 6: The Scribe — Report Generation
- [ ] Design report schema (JSON + Markdown templates)
- [ ] Implement Strat Card generator
- [ ] Implement per-player individual report generator
- [ ] Implement constructive framing (positives always first)
- [ ] Implement pro reference citation format
- [ ] Implement suggested drills section (linked to practice modes)

### Phase 7: Integrations
- [ ] FACEIT OAuth2 auth flow
- [ ] FACEIT match webhook receiver
- [ ] FACEIT demo auto-download
- [ ] FACEIT player stats pull
- [ ] SCL match schedule sync (or manual fallback)
- [ ] SCL pre-match opponent analysis report

### Phase C: Training Server System ✅ Core Complete
- [x] DatHost provisioning working (`multipart/form-data` fix)
- [x] 128-tick + `game_mode=competitive` on all provisioned servers
- [x] 10 training mode configs with per-mode RCON commands (`dathost_client.py`)
- [x] Mode validation + 503 response on update window block
- [x] `GET /api/servers/modes` — returns mode list + live update status
- [x] Live CS2 update detection via Steam News API (`check_cs2_update_active`)
  - No API key needed; searches last 5 CS2 announcements for update keywords
  - Blocks provisioning for 2h after real update detected (env-configurable)
  - 10-min in-process cache; fails open if Steam unreachable
- [x] Training Modes page (`/teams/[teamId]/training`) — SCL-style 2-col card grid
- [x] 10 AI-generated training mode images in `/public`
- [x] Team page updated: old spin-up widget → Training Server launcher card
- [x] `/api/servers/modes` Next.js proxy route
- [ ] Integrate CounterStrikeSharp plugins (OpenPrefirePrac, CS2PracticeMod) for deeper in-server functionality
- [ ] Session stats tracking per player per training mode
- [ ] In-game bot management via RCON for retake/execute scenarios
- [ ] Utility auto-updater pipeline (post CS2 patch lineup validation)

### Phase 8: Practice Server System (Legacy — merged into Phase C)
- [ ] Build CS2 dedicated server Docker image (MetaMod + CounterStrikeSharp)
- [ ] Integrate OpenPrefirePrac plugin
- [ ] Integrate CS2PracticeMod plugin
- [ ] Implement chat command parser in DemoSage UI
- [ ] Build utility auto-updater pipeline

### Phase A: Beta Frontend — Path to Beta ✅ COMPLETE
- [x] Next.js 15 scaffold (App Router, TypeScript, Tailwind v4)
- [x] Mongol Empire design system (CSS tokens, Cinzel/Inter/JetBrains Mono fonts)
- [x] Mongolian pattern components: Soyombo icon, Ulzii dividers, cloud motifs
- [x] Landing page: hero with drag-and-drop upload, features grid, CTA, footer
- [x] Presigned GCS URL upload flow (bypasses Vercel 4.5MB limit — browser → GCS direct)
- [x] Analysis results page: real-time job polling, kill feed, economy bar chart
- [x] API proxy routes: `/api/upload` → FastAPI presign, `/api/jobs/{id}` → FastAPI
- [x] Feature flags (`lib/flags.ts`): free/basic/pro plan limits (2 / 10 / unlimited demos/mo)
- [x] Deployed to Vercel (auto-deploys on push to main)
- [ ] End-to-end upload test with real demo on live URL

### Phase B: Accounts & Billing ✅ Complete
- [x] Clerk auth: sign-up, sign-in, session management (`frontend/proxy.ts` + `ClerkProvider`)
- [x] `user_id` (nullable) on Match model — links matches to Clerk users
- [x] "My Analyses" dashboard (`/dashboard`) — per-user match history + usage meter
- [x] Stripe checkout + webhook handler — upgrades/downgrades plan in Clerk `publicMetadata`
- [x] 3-tier plan gates: Free (2/mo), Basic $5 (10/mo), Pro $20 (unlimited)
- [x] Upload quota enforcement server-side — 429 + upgrade URL when limit hit
- [x] Stripe products + prices created: Basic `price_1TZdccK81lqFuAqaUpBtDmvt`, Pro `price_1TZdcdK81lqFuAqa5aXKj8F6`
- [x] Navbar with plan badge, `UserButton`, and `SignInButton`
- [x] Sign-in / Sign-up pages themed to Mongol Empire dark design
- [x] `/billing/success` post-checkout confirmation page

### Phase 10: Production Hardening
- [ ] Kubernetes deployment manifests
- [ ] Production PostgreSQL + Redis setup
- [ ] LangSmith production dashboard
- [ ] Rate limiting + auth middleware
- [ ] Staging and production GitHub Action pipelines
- [ ] Smoke test suite
- [ ] User documentation

---

## 11. Decisions Made

| Decision | Choice | Notes |
| :--- | :--- | :--- |
| **App Infrastructure** | Google Cloud Platform (GCP) | Single cloud; unified billing with Gemini API |
| **Database** | Cloud SQL for PostgreSQL + pgvector | ~$10/mo; managed, no self-hosting |
| **File Storage** | Google Cloud Storage (GCS) | Demo + audio files; 5GB free tier |
| **Task Queue** | Cloud Tasks (serverless) | Replaces Celery + Redis; 1M tasks/mo free |
| **Compute** | Cloud Run (serverless containers) | API + agents; scales to zero |
| **Practice Server Hosting** | DatHost API (on-demand game servers) | Sub-10-second instant server provisioning |
| **DatHost API Format** | `multipart/form-data` (not JSON) | DatHost `POST /game-servers` requires form-data; JSON gives 500 |
| **Server Tickrate** | 128-tick (`cs2_settings.tickrate=128`) | Competitive-standard; applied to all provisioned servers |
| **Server Game Mode** | `competitive` default, `deathmatch` for aim/spray | Per-mode override in `TRAINING_MODE_CONFIGS` dict |
| **CS2 Update Guard** | Live Steam News API (not fixed Tuesday window) | `ISteamNews/GetNewsForApp` appid=730; no API key needed; detects real updates only; 10-min cache; fails open |
| **Update Block Duration** | 2 hours (`UPDATE_BLOCK_DURATION_SECONDS=7200`) | Env-configurable; DatHost typically updates fleet within 30–90 min |
| **Warmup Detection** | Two-rule: `is_warmup_period` flag + equipment budget ≤$4,500 | `is_warmup_period` is primary; budget threshold catches knife rounds and edge cases |
| **KAST Round Iteration** | Iterate `valid_round_nums` set (not `range(tot_r)`) | `range(tot_r)` generated wrong sequential indices; round numbers are non-sequential after filtering |
| **LLM Provider** | Google Gemini API (Vertex AI) | See Section 3 for per-agent model breakdown |
| **Audio Transcription** | Gemini 2.5 Flash (native audio) | Eliminates Whisper; no separate service needed |
| **SCL Integration** | Future feature | No current API access; deferred to Phase 11+ |
| **Multi-team Support** | Single team (v1) | Login system + multi-tenant deferred to future |
| **HLTV Scraping** | Apify actor | Managed service; no proxy/maintenance overhead |
| **Audio Recording Workflow** | Manual file upload | Record externally (Craig, OBS, etc.), upload post-match |
| **Player Report Visibility** | Player-only (private) | Coach gets a separate aggregate report of all players |
| **Project Name** | DemoSage | Renamed from Chinghis Scan on 2026-04-23 |
| **CI Requirements Split** | `requirements-ci.txt` (minimal) + `requirements.txt` (full) | Python 3.14 locally can't build native wheels; CI uses 3.12 |
| **GCP SDK Imports** | Lazy imports (inside functions) | Allows modules to be imported in CI without GCP packages installed |
| **CI/CD Flow** | `feature branch` → `main` (PR) → `staging` branch → prod | Strict staging gate before any production deploy |
| **Commit Convention** | Conventional Commits with full body descriptions | Each commit references the spec phase it belongs to |
| **Import Sort Rule** | `force-sort-within-sections = true` in pyproject.toml | All imports sort purely alphabetically by module name — eliminates `import X` vs `from X import Y` ambiguity |
| **Demo Parser** | `demoparser2` (Rust, direct) replacing `awpy` | `awpy 1.3.1` fails on Python 3.14 (matplotlib→numpy build error); demoparser2 has native 3.14 wheel and is what awpy wraps internally |
| **DB Schema** | SQLAlchemy 2.0 ORM with SQLite fallback for CI | `DATABASE_URL_TEST=sqlite:///:memory:` allows full model tests in CI without PostgreSQL or psycopg2 |
| **Trajectory Sampling** | Every 8 ticks by default (`TRAJECTORY_SAMPLE_TICKS` env var) | ~8 positions/sec at 64tick — good heatmap resolution without excessive storage |
| **GCP Provisioning** | `scripts/setup_gcp.py` one-shot script | Runs all gcloud commands in sequence; billing link step is interactive (cannot be automated) |

---

## 12. Future Planned Features

- **Multi-team / Multi-tenant Support** — Login system with team accounts; each team sees only their own data
- **SCL Integration** — Per-match auto-coaching and pre-match opponent reports via SCL API or scraping
- **Discord Bot** — In-server commands to trigger analysis, view reports, and manage practice servers without leaving Discord
- **Opponent Tendency Reports** — Auto-generate pre-match intel on upcoming opponents from their HLTV demo history
- **Mobile Dashboard** — Responsive companion view for reviewing reports on phone
- **VOD / Clip Export** — Auto-clip flagged moments from the demo for review (kill events, bad rotations, missed utility)
- **Historical Trend Tracking** — Week-over-week player improvement graphs; detect regression early
- **Player Rating System** — Internal Elo-style rating per player per role, tracked across all matches
- **Training Session Stats** — Track kills, accuracy, time-in-server per mode; personal records per player
- **CounterStrikeSharp Plugin Integration** — OpenPrefirePrac + CS2PracticeMod for in-server guided drills and lineup hints
- **Map Selector per Mode** — Override the default map per training mode (currently map picker is present in UI but not forwarded to DatHost)
- **FACEIT Auto-Analysis** — Webhook receiver to auto-download and analyze every FACEIT match on completion

---

*This document is the single source of truth for project planning. Update the Progress Tracker checkboxes as work completes. Create GitHub Issues directly from Phase items.*
