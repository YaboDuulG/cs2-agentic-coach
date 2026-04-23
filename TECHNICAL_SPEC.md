# 🏹 DemoSage — Technical Specification & Progress Tracker
> **Version:** 0.2.0-spec | **Status:** Pre-Development | **Last Updated:** 2026-04-17

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

Inspired by **Pracc** and **SCL practice modes**. Users can ask the chatbot to spin up a server, and the Warlord agent provisions it automatically.

### 7.1 Architecture

- **Base:** CS2 Dedicated Server (Linux, Docker container per session)
- **Plugin Framework:** MetaMod:Source + CounterStrikeSharp
- **Provisioning:** Warlord agent calls server management API (custom FastAPI service)
- **Hosting:** **Hetzner Cloud** (CX21 or CX31 instances) — cheapest reliable European cloud (~€5–12/mo per server, on-demand spin-up/teardown via Hetzner API)
- **Lifecycle:** Auto-shutdown after 2h of inactivity; server destroyed after session to avoid idle costs

### 7.2 Practice Modes

| Mode | Description | Key Features |
| :--- | :--- | :--- |
| **Prefire** | Train common prefire angles on any map | OpenPrefirePrac plugin, difficulty settings, multiplayer support |
| **Nades** | Grenade lineup practice with guided hints | CS2PracticeMod, grenade trajectory display, position save/load |
| **Retakes** | Planted bomb retake scenarios | Custom round spawns, random site selection |
| **Executes** | Full team execute practice with bots | Coordinate execute timing, bot CT behavior |
| **Deathmatch** | Warm-up/aim training | Respawn on death, custom weapon rules |
| **1v1 Arena** | Head-to-head duels | Auto-generated arenas, Elo tracking |
| **Free Prac** | Open practice with all tools enabled | Noclip, infinite money, save/load positions |

### 7.3 Server Chat Commands

```
!mode prefire [map]     - Start prefire practice
!mode nades [map]       - Start nade practice  
!mode retakes [map]     - Start retake scenarios
!mode exec [map]        - Execute practice
!mode dm                - Deathmatch
!mode 1v1               - 1v1 arena
!save [name]            - Save current position
!load [name]            - Load saved position
!noclip                 - Toggle noclip
!rethrow                - Rethrow last grenade
!help                   - Show all commands
```

### 7.4 Chatbot Commands (via DemoSage UI)

```
"Spin up a prefire server on Mirage"
"Start a nades server, dust2"
"Give me a retakes server for my team (5 slots)"
"Shut down my practice server"
"What servers do I have running?"
```

### 7.5 Utility Auto-Updater

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
| **Practice Server** | CS2 Dedicated + CounterStrikeSharp | Hetzner Cloud VMs (game servers need cheap raw compute) |
| **CS2 Plugins** | OpenPrefirePrac, CS2PracticeMod | MIT licensed, open source |
| **CI/CD** | GitHub Actions | See Section 8 |
| **Frontend** | Next.js 15 → Cloud Run | Chat UI + Dashboard |

---

## 10. Progress Tracker

### Phase 0: Foundation & Scaffolding
- [ ] Initialize monorepo structure (`/agents`, `/services`, `/plugins`, `/frontend`, `/infra`)
- [ ] Create GCP project + enable billing
- [ ] Enable APIs: Cloud SQL, Cloud Storage, Cloud Tasks, Cloud Run, Vertex AI
- [ ] Provision Cloud SQL instance (PostgreSQL 15, Enterprise shared-core) + enable pgvector extension
- [ ] Create GCS bucket (`cs2-demosage`) for demo and audio file storage
- [ ] Set up Cloud Tasks queue for async job dispatch
- [ ] Configure local `.env` with GCP credentials (Application Default Credentials)
- [ ] Set up Docker Compose for **local dev only** (mirrors Cloud SQL schema locally with PostgreSQL)
- [ ] Set up LangSmith project + connect API key
- [ ] Scaffold FastAPI app with health check endpoint → deploy to Cloud Run
- [ ] Create base GitHub Actions (CI lint/test + Cloud Run deploy on push to `main`)

### Phase 1: The Scout — Demo Pipeline
- [ ] Set up awpy + demoparser2 Docker image
- [ ] Implement kill event extraction
- [ ] Implement player coordinate streaming
- [ ] Implement utility event extraction (grenade throws, lands, type)
- [ ] Implement round metadata extraction (economy, outcome)
- [ ] Implement "First Contact" event detection
- [ ] Validate output against FACEIT and Matchmaking demos
- [ ] Expose Scout as internal service with queue interface

### Phase 2: The Great Khan — Orchestrator
- [ ] Define global LangGraph state schema
- [ ] Implement supervisor node with tool-calling handoffs
- [ ] Implement router logic (stat query vs. tactical vs. server request)
- [ ] Integrate PostgresSaver for persistent state
- [ ] Add hallucination guardrail layer
- [ ] Implement confidence scoring on agent outputs

### Phase 3: Khan's Library — RAG Knowledge Base
- [ ] Author CS2 game rules corpus (economy, map callouts, round timing)
- [ ] Build embedding pipeline (chunk → embed → store in pgvector)
- [ ] Set up Apify account + configure HLTV actor
- [ ] Build pro match parse → embed pipeline
- [ ] Set up nightly GitHub Action for HLTV ingestion
- [ ] Implement semantic retrieval for Tactician queries

### Phase 4: The Tactician — Tactical Analysis
- [ ] Implement FCR (First Contact Resolution) module
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

### Phase 8: Practice Server System
- [ ] Build CS2 dedicated server Docker image (MetaMod + CounterStrikeSharp)
- [ ] Integrate OpenPrefirePrac plugin
- [ ] Integrate CS2PracticeMod plugin
- [ ] Build Warlord agent (server provisioning via FastAPI)
- [ ] Implement all 7 practice modes
- [ ] Implement chat command parser in DemoSage UI
- [ ] Build utility auto-updater pipeline
- [ ] Set up CS2 update detection GitHub Action

### Phase 9: Frontend
- [ ] Next.js 15 project scaffold
- [ ] Chat interface (WebSocket to Great Khan)
- [ ] Demo + audio upload portal
- [ ] Coaching report dashboard
- [ ] Practice server control panel
- [ ] FACEIT/SCL account linking UI
- [ ] Real-time report streaming (SSE)

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
| **Practice Server Hosting** | Hetzner Cloud (on-demand VMs) | Game servers need raw compute; cheaper than GCP VMs |
| **LLM Provider** | Google Gemini API (Vertex AI) | See Section 3 for per-agent model breakdown |
| **Audio Transcription** | Gemini 2.5 Flash (native audio) | Eliminates Whisper; no separate service needed |
| **SCL Integration** | Future feature | No current API access; deferred to Phase 11+ |
| **Multi-team Support** | Single team (v1) | Login system + multi-tenant deferred to future |
| **HLTV Scraping** | Apify actor | Managed service; no proxy/maintenance overhead |
| **Audio Recording Workflow** | Manual file upload | Record externally (Craig, OBS, etc.), upload post-match |
| **Player Report Visibility** | Player-only (private) | Coach gets a separate aggregate report of all players |

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

---

*This document is the single source of truth for project planning. Update the Progress Tracker checkboxes as work completes. Create GitHub Issues directly from Phase items.*
