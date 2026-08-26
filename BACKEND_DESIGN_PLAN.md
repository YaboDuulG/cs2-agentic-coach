# DemoSage Backend Design Plan

Scale target: **hundreds of users uploading simultaneously.** Quality target: **coaching
reports grounded in the parsed data and compared against the pro library — no freestyle.**

Skill research verdict: the widely-adopted, substantive backend skill is
**`supabase-postgres-best-practices`** (github.com/supabase/agent-skills, vendor-maintained,
34 prioritized rule files with incorrect/correct SQL and EXPLAIN evidence — applies to any
Postgres, not just Supabase). The popular-looking `senior-backend` skill from
claude-code-templates is generic boilerplate and was discarded. For the grounding design,
the reference is Anthropic's contextual-retrieval + citations guidance (platform docs),
applied to the existing Gemini pipeline. Rules from the Postgres skill are cited inline
below as `[pg:<rule>]`.

---

## Part 0 — Preconditions (from the architecture audit)

The pipeline is currently severed in three places; no scale or prompting work matters until
these land (see the audit in the session summary for file:line evidence):

1. `/compose` (and single-chunk confirm) must trigger the parse — direct enqueue, no Pub/Sub.
2. The Go parser must gunzip, **persist** results, set `status=COMPLETE`, and trigger coaching.
3. Coaching must run in a worker context, not a FastAPI `BackgroundTask` on throttled CPU.

---

## Part 1 — Backend at hundreds of concurrent uploads

### 1.1 The load profile

A "simultaneous upload" costs almost nothing on our servers — the browser PUTs directly to
GCS via presigned URLs (this design is already right; keep it). What actually scales with
users is:

| Load source | Per match | At 300 concurrent |
|---|---|---|
| Parse jobs | 1 CPU-bound job, ~5–10s | 300 queued jobs |
| DB writes | ~5–10k rows (kills, rounds, grenades, trajectories) | ~2–3M rows in minutes |
| Coaching jobs | ~25 LLM calls (24 flash + 1 synthesis) | ~7,500 LLM calls |
| Status polling | 1 req/3s per open tab | ~100 req/s against the API + DB |

The bottlenecks are therefore: **job orchestration, DB write path, DB connections, LLM
throughput** — in that order.

### 1.2 Job queue: Postgres, not more GCP services

Replace the Pub/Sub + Cloud Tasks + BackgroundTasks trio with **one `jobs` table in the
Postgres we already run**, claimed by workers with `FOR UPDATE SKIP LOCKED`
[pg:lock-skip-locked — "10x throughput for worker queues"]:

```sql
create table jobs (
  id bigint generated always as identity primary key,
  match_id uuid not null,
  kind text not null check (kind in ('parse', 'coach')),
  status text not null default 'pending',      -- pending|running|done|failed
  attempts int not null default 0,
  claimed_by text, claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on jobs (kind, status, created_at) where status = 'pending';  -- [pg:query-partial-indexes]
```

Worker loop (parse workers = Go parser service; coach workers = slim Python service):

```sql
begin;
select * from jobs where kind = $1 and status = 'pending'
order by created_at limit 1 for update skip locked;
update jobs set status='running', claimed_by=$worker, claimed_at=now(), attempts=attempts+1 ...;
commit;  -- keep the claim transaction short [pg:lock-short-transactions]
```

Why this over Cloud Tasks: one moving part, free, transactional with the data it describes
(a parse job and its match row commit together), trivially observable (`select * from jobs`),
and workers on Cloud Run autoscale off queue depth via a tiny `/metrics` endpoint or
scheduled scaler. Cloud Tasks remains a reasonable alternative if you'd rather not run
pollers — but don't run both.

Stuck-job recovery: the existing 15-min server-side timeout survives as
`update jobs set status='pending' where status='running' and claimed_at < now() - interval '10 min'`.

### 1.3 DB write path

- **Parser inserts via COPY / multi-row batches, never row-by-row**
  [pg:data-batch-inserts — "10–50x faster bulk inserts"]. In Go: `pgx.CopyFrom` for kills,
  grenades, trajectories; one transaction per match.
- **Partition the fat tables by match age** once volume is real: `player_trajectories` and
  `kills` are append-only time-series; monthly range partitions make retention (drop
  partition) and vacuums cheap [pg:schema-partitioning]. Not needed on day one — schema
  them `partition by range` now so it's a no-op later.
- **Trajectory JSON stays out of hot queries.** The tactician currently loads every
  `positions_json` blob into memory; select only the columns and rounds each module needs
  [pg:data-n-plus-one adjacent — fetch what you use].

### 1.4 Connections — the thing that actually falls over first

Postgres connections cost 1–3MB each; 300 pollers + N workers each opening sessions
exhausts any small instance [pg:conn-pooling — CRITICAL, "500 concurrent users = 500
connections = crashed database"]. Design:

- **PgBouncer (or Neon/Supabase's built-in pooler) in transaction mode** between every
  service and Postgres. App-side SQLAlchemy pools stay small (workers: pool_size ≈ cores×2).
- **Polling never touches Postgres.** Status polls are ~100 req/s of pure reads; serve them
  from an in-memory/Redis-free path: the API keeps job status in a 5s TTL LRU, or better —
  **replace polling with SSE**: the worker PATCHes status to the API, the API holds open
  event streams. One connection per viewer, zero DB reads. (The frontend's two-phase
  stats-then-coaching rendering already fits this.)
- The done-state poll currently re-fetches kills/rounds on every 3s tick after completion —
  return light status until the client explicitly fetches the payload once.

### 1.5 LLM throughput and cost control

7,500 concurrent Gemini calls will hit rate limits long before quota. Put a **global
concurrency gate in the coach worker** (e.g. `asyncio.Semaphore(50)` per worker × capped
worker count), and make the flash wave per-match sequentialize gracefully under pressure —
a match taking 40s instead of 15s under peak load is fine; 429 cascades are not.

- Per-user quotas already exist at presign time (429 path) — keep as admission control.
- Cache the three static RAG query embeddings (they're fixed strings per map — recomputing
  them per match is pure waste).
- Batch/cached pro-baseline blocks (see Part 2) are shared across all matches on the same
  map — cache by `(map, patch-version)`.
- Slim the coach worker image (no torch/playwright/celery) so it scales to zero and cold
  starts in seconds.

### 1.6 Sizing sketch (300 simultaneous uploads)

Uploads hit GCS directly (no server cost) → parse queue drains at
(workers × 6/min): 10 parse workers ≈ 5 min to drain 300; 20 ≈ 2.5 min. Coach queue:
25 calls/match ÷ 50-concurrency workers ≈ 20–40 matches in flight per worker; 5–10 coach
workers clears 300 matches in ~10–15 min with everyone's **stats visible within ~2 min of
their own upload**. All of it scale-to-zero when idle.

---

## Part 2 — Grounded coaching: from vibes to evidence

### 2.1 What's wrong today (evidence in code)

1. **The tactician's numbers never reach the LLM.** `tactical_analysis` (FCR, economy
   coherence, utility sequencing, rotations — real computed metrics) is passed into
   `async_generate_reports(...)` and then **never referenced in either prompt**
   (`agents/scribe/report_generator.py:92-115`). The synthesis sees only 24 concatenated
   2–3 sentence blurbs.
2. **Retrieval is match-generic, not situation-specific.** Seven chunks are fetched once
   per match with static queries ("CS2 tactical guidelines map X", "economy buy thresholds",
   "pro match de_X tactics" — `agents/khan/nodes.py:69-99`) and the same blob is pasted
   into all 24 round prompts. No round is ever compared against pro play *in its own
   situation*.
3. **No grounding contract.** Prompts never say "cite only events in the data"; output is
   free markdown at temperature 0.4; nothing links a claim to a round or a metric. This is
   the recipe for plausible-sounding invented coaching.
4. **Pro library is prose, not baselines.** Chunks are text summaries; you can't compare a
   player's 43% opening-duel rate against a paragraph.

### 2.2 Design principle: the LLM narrates, it does not measure

Everything numeric is computed deterministically (tactician) or retrieved (pro baselines).
The LLM's only job is selection, explanation, and drill prescription — and every sentence
it produces must point at an evidence ID it was given.

### 2.3 The evidence pack (per match, built before any LLM call)

```jsonc
{
  "facts": [   // from tactician + parser — deterministic
    {"id": "F1", "kind": "fcr", "player": "s1mple2024", "value": 0.31,
     "detail": "won 4/13 opening duels as T on de_mirage", "rounds": [1,3,5,8,...]},
    {"id": "F2", "kind": "economy", "round": 7, "value": -1,
     "detail": "force-bought $2150 after losing pistol+antieco, team broke on round 9"},
    {"id": "F3", "kind": "utility", "round": 12,
     "detail": "A execute: no CT smoke, jungle flash 2.1s after entry began"}
  ],
  "baselines": [  // from pro library — structured stats, not prose
    {"id": "B1", "kind": "fcr", "context": "T-side de_mirage, tier-1 2025-26",
     "value": 0.50, "source": "hltv aggregate, n=214 maps"},
    {"id": "B2", "kind": "econ_rule", "detail": "pro teams full-save at <$2000 unless
      closing map point", "source": "game_rules/economy.md#save-thresholds"}
  ],
  "pro_examples": [  // retrieved per-situation, round-keyed (see 2.4)
    {"id": "P1", "round_ref": 12, "detail": "Vitality A-execute smoke set on mirage:
      CT+jungle+stairs before entry", "source": "hltv_pro_match:vitality-faze-m2-r14"}
  ]
}
```

### 2.4 Situation-keyed retrieval (replaces the 3 static queries)

For each *interesting* round (the tactician already flags errors — retrieve only for
those, ~6–10 rounds, not 24):

- Build the query from the round's actual state: side, site hit, man-advantage,
  buy tier, outcome — e.g. `"T A-site execute mirage full-buy failed entry"`.
- Retrieve top-2 pro chunks per flagged round; attach as `pro_examples` with the
  `round_ref` link.
- Index the pro library with **contextual chunk headers** (map, side, situation,
  score-state prepended to each chunk before embedding) — this is Anthropic's contextual
  retrieval pattern and is the single biggest retrieval-quality lever.
- Store numeric pro aggregates (FCR by map/side, buy thresholds, utility timing) as a
  **`pro_baselines` table**, not vectors — baselines are lookups, not searches.

### 2.5 The prompt contract

Round-analysis calls (flash) get: that round's data + only the facts/baselines/examples
whose IDs touch that round. Synthesis (pro or flash) gets the full evidence pack + the
round analyses, and this contract:

```
You are writing a coaching report. You may ONLY make claims supported by the
evidence blocks above. Rules:
- Every finding must cite evidence IDs in square brackets: "Your opening-duel
  win rate was 31% [F1] against a tier-1 baseline of 50% [B1]."
- Compare player values to baselines wherever both exist; state the gap as a number.
- If the evidence doesn't cover something, write nothing about it. Do not
  speculate about events not in the data.
- Each finding: what happened (with round numbers), why it matters (baseline gap),
  one specific drill or rule to fix it.
```

Output is **schema-constrained JSON** (Gemini `response_schema`, not just
`response_mime_type`), so structure is enforced, not requested:

```jsonc
{"findings": [{
    "claim": "...", "evidence_ids": ["F1","B1"], "rounds": [1,3,8],
    "severity": "high", "drill": "...", "audience": "individual|team|player:<name>"
}], "summary": "..."}
```

Markdown for the UI is rendered *from* this JSON (frontend or a cheap template pass), which
also lets the report page deep-link each finding to its rounds in the 3D viewer.

### 2.6 Verification pass (cheap, optional but recommended)

One flash call per report: "For each finding, do the cited evidence IDs actually support
the claim? Answer per finding: supported / unsupported." Drop unsupported findings.
Cost: ~1 extra flash call; kills the residual hallucination tail. Log the drop-rate as
your grounding metric — if >10% of findings fail verification, the prompt or evidence
pack needs work, and you'll see it in a dashboard instead of a user complaint.

### 2.7 Model tiering at scale

- Flash for round analyses and verification (volume).
- Synthesis: start with pro; A/B flash — with the evidence pack doing the heavy lifting,
  flash quality may be sufficient, which changes coaching cost by ~10x at scale.
- The existing DB-backed prompt config (`db/config.py`) is good — keep prompts there so
  the contract is tunable without deploys; add the schema version to the config key.

---

## Part 3 — Build order

| # | Work | Unblocks |
|---|---|---|
| 1 | Rewire pipeline (Part 0) + jobs table with SKIP LOCKED | everything |
| 2 | Parser COPY inserts + status transitions | correctness at any scale |
| 3 | PgBouncer/pooler + SSE (or cached) status path | 100s of viewers |
| 4 | Evidence pack builder (facts from tactician, baselines table) | grounded prompts |
| 5 | Prompt contract + schema-constrained synthesis + citation rendering | the actual product |
| 6 | Situation-keyed retrieval + contextual chunk headers | comparison quality |
| 7 | Verification pass + grounding metrics | trust |
| 8 | Concurrency gates, embedding/baseline caches, worker autoscaling | 300-user bursts |

Verification for each phase: load-test the queue with `k6`/`hey` against a seeded 300-job
backlog; for grounding, a golden-demo eval set (5 demos with hand-checked expected
findings) run on every prompt change — the finding-verification drop-rate and
citation-coverage (% of sentences with an evidence ID) are the two numbers to watch.
