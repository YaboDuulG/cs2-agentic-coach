# Architecture Refactor Plan — Domain-Driven Consolidation

Executes the architect prompt in CLAUDE.md against the *actual* codebase. Every section
maps current files to target modules; nothing here is greenfield scaffolding. Deviations
from the prompt's letter are listed at the end with reasons — per TECHNICAL_SPEC §15,
shipped decisions are reconciled deliberately, not silently rewritten.

## 1. Target directory tree (move map)

```
services/
├── parser/                      # ← services/demo-parser (Go) — already a pure function
│   ├── cmd/                     #   main.go
│   ├── parser/                  #   parse.go, events.go (+ subtick_offset, weapon_fire)
│   └── Dockerfile
├── ingestion/                   # ← services/worker (parse side) + api/routes/presign.py glue
│   ├── queue.py                 #   ← db/jobs.py (SKIP LOCKED claim/enqueue — stays Postgres)
│   ├── parse_worker.py          #   ← services/worker/parse_handler.py
│   └── persistence.py           #   batch-insert repository (COPY on Postgres)
├── rag_engine/                  # ← db/rag.py + db/qdrant_client.py + services/hltv_watcher
│   ├── retriever.py             #   Retriever protocol; situation-keyed + batched queries
│   ├── embeddings.py            #   Gemini embed client + fixed-query cache
│   ├── stores/                  #   qdrant.py (primary), sqlite_fallback.py (local mock)
│   ├── hltv_delta.py            #   ← hltv_watcher crawler (S/A-tier delta scrape via Actions)
│   └── baselines.py             #   pro_baselines numeric lookups (NOT vector search)
├── coaching_ai/                 # ← agents/khan + agents/scribe + services/tactician
│   ├── orchestrator/            #   ← agents/khan (graph, nodes)
│   ├── heuristics/              #   ← services/tactician (pure, no DB imports — see §3)
│   ├── evidence.py              #   ← agents/scribe/evidence.py
│   ├── modes.py                 #   AnalysisMode strategy table (see §4)
│   ├── scribe.py                #   ← agents/scribe/report_generator.py
│   └── coach_worker.py          #   ← services/worker coach side
├── stratbook/                   # ← agents/strat_reviewer.py + stratbook routes + models
│   ├── models.py                #   Strat, StratRevision, StratStatus state machine
│   ├── service.py               #   propose/approve/mutate transitions
│   └── review.py                #   Dual-RAG critique (calls coaching_ai + rag_engine)
├── discord_bot/                 # ← api/routes/discord.py webhook + NEW interaction bot
│   ├── bot.py                   #   slash commands: /strat propose|approve|list
│   ├── sync.py                  #   thread ↔ StratRevision bidirectional sync
│   └── outbound.py              #   webhook pushes on strat mutations
├── billing/                     # ← frontend/app/api/billing/* logic moves server-side
│   ├── entitlements.py          #   tier → capability matrix, require_entitlement guard
│   ├── redaction.py             #   preview-payload builders for unentitled tiers
│   └── stripe_webhooks.py       #   subscription lifecycle → user_entitlements rows
└── warlord/                     # unchanged (RCON/practice servers)

api/                             # stays the FastAPI edge: routing + auth only.
                                 # Routes import services/*; they contain no domain logic.
db/                              # engine/session + alembic only; domain models migrate
                                 # into their owning service's models.py over phases 3-4.
agents/                          # deleted at end of phase 2 (contents absorbed above)
```

Rule enforced by CI (`ruff` isort sections + a small import-linter contract): `api/*` may
import `services/*`; services may import `db.database` and each other's *published
interfaces* only; `heuristics/` and `stratbook/models.py` import neither `sqlalchemy`
sessions nor `httpx` (pure domain).

## 2. Interface definitions (the seams)

```python
# services/rag_engine/retriever.py
class RetrievedChunk(TypedDict):
    id: str; text: str; score: float
    source: str                    # 'hltv_pro_match' | 'game_rules' | 'player_tendency'
    pro_match_id: str | None       # HLTV match id — REQUIRED for pro chunks (guardrail §5)
    round_ref: int | None

class Retriever(Protocol):
    def retrieve(self, queries: list[SituationQuery], *, per_query: int = 2,
                 team_id: str | None = None, user_id: str | None = None
                 ) -> list[RetrievedChunk]: ...
    # Batched: one embed round-trip for N situation queries (kills the
    # sequential-retrieval latency in today's rag_node/evidence builder).

# services/coaching_ai/heuristics/__init__.py — pure domain
@dataclass(frozen=True)
class RoundTelemetry:              # built by ingestion, consumed by heuristics
    round_num: int; winner: Side; economy: EconomyState
    kills: tuple[KillEvent, ...]; grenades: tuple[GrenadeEvent, ...]
    trajectories: Mapping[SteamId, tuple[Pos, ...]]

class Heuristic(Protocol):
    key: str                       # 'fcr', 'economy', 'utility', 'rotation', 'trade_timing'
    modes: frozenset[AnalysisMode] # which modes run this heuristic
    def evaluate(self, rounds: Sequence[RoundTelemetry]) -> HeuristicResult: ...

# services/billing/entitlements.py
class Entitlement(StrEnum):
    BASIC_ANALYSIS = "basic_analysis"        # Free
    FULL_COACHING = "full_coaching"          # Solo Pro
    TEAM_ANALYSIS = "team_analysis"          # Team
    TEAM_SCOUTING = "team_scouting"          # Team (opposition research)
    STRATBOOK_SYNC = "stratbook_sync"        # Team (Discord)

def require_entitlement(ent: Entitlement, *, preview: PreviewBuilder | None = None):
    """FastAPI dependency. Entitled → passthrough. Unentitled + preview → the
    route returns preview(payload) with HTTP 200 and {"locked": true, "tier_needed": ...}.
    Unentitled without preview → 402 with an upgrade pointer. Never a 500."""
```

## 3. Database migrations (Alembic, in order)

```
0007_user_entitlements.py
    user_entitlements(user_id PK-part, entitlement PK-part, source['stripe'|'grant'],
                      stripe_subscription_id NULL, expires_at NULL)
    -- replaces reading Clerk publicMetadata.plan in Next.js routes; Clerk metadata
    -- becomes a display cache, this table is the authority checked by the guard.

0008_strat_versioning.py
    strats(id, team_id FK, map_name, title, status['draft'|'proposed'|'approved'|
           'archived'], current_revision_id)
    strat_revisions(id, strat_id FK, revision_no, canvas_json, author_id,
                    discord_thread_id NULL, created_at)
    -- UserStrategy/TeamPlaybook rows backfill as revision_no=1 approved strats.

0009_subtick_and_tradetiming.py
    kills += subtick_offset FLOAT NULL, is_trade BOOL, trade_window_ms INT NULL
    grenades += detonate_tick BIGINT NULL, effect_json TEXT  -- utility impact (flash
    -- durations / molly denial seconds) once the parser emits them.

0010_pro_match_registry.py
    pro_matches(hltv_match_id PK, event_tier['S'|'A'], teams, map_name, played_at,
                demo_gcs_uri NULL, ingested_at)
    -- every RAG chunk with source='hltv_pro_match' must FK-reference this table;
    -- the citation contract (§5) resolves display strings from here.
```

## 4. Context-aware analysis modes

Today: `is_recon` flag + individual/team toggle, applied only as prompt seasoning.
Target: a first-class strategy table consumed by orchestrator, heuristics, and scribe.

```python
class AnalysisMode(StrEnum):
    SELF_IMPROVEMENT = "self"      # micro: duels, crosshair proxy (kill angles), utility ROI
    TEAM_ANALYSIS = "team"         # macro: trade spacing, defaults, retakes, utility stacks
    OPPOSITION_RESEARCH = "recon"  # tendencies: heatmaps, buy behavior, default setups

MODE_SPEC: dict[AnalysisMode, ModeSpec] = {
    SELF_IMPROVEMENT: ModeSpec(
        heuristics={'fcr', 'utility', 'trade_timing'},
        evidence_focus='player', report_audiences=('individual',),
        entitlement=Entitlement.BASIC_ANALYSIS),
    TEAM_ANALYSIS: ModeSpec(
        heuristics={'fcr', 'economy', 'utility', 'rotation', 'trade_timing'},
        evidence_focus='team', report_audiences=('team', 'player:*', 'coach'),
        entitlement=Entitlement.TEAM_ANALYSIS),
    OPPOSITION_RESEARCH: ModeSpec(
        heuristics={'economy', 'rotation', 'tendencies'},
        evidence_focus='opponent', report_audiences=('scout',),
        entitlement=Entitlement.TEAM_SCOUTING),
}
```

The coach worker resolves the mode once, and it flows through evidence-pack building
(which facts/baselines/examples are gathered), retrieval queries, prompt contract
selection (`prompt_scribe_{mode}` config keys), and the entitlement gate.

## 5. Zero-hallucination guardrails (extension of the shipped contract)

Already shipped: evidence pack (F/B/P ids), citation-bracket contract, schema-enforced
findings, verification pass with logged drop-rate. This refactor adds the prompt's
missing citation dimensions:

- `pro_examples` entries gain `pro_match_id` (FK to `pro_matches`) and `tick_range`
  where the chunk was cut from a parsed pro demo. The evidence builder REFUSES chunks
  with `source='hltv_pro_match'` and no `pro_match_id` — unattributable pro claims
  can't enter the pack at all.
- Findings schema gains `citations: [{evidence_id, pro_match_id?, rounds, tick_range?}]`
  (superset of today's `evidence_ids`), and the verification pass checks pro_match_id
  presence for any finding whose claim references pro play.
- Grounding metrics dashboarded from logs: verification drop-rate + citation coverage
  (% findings with ≥1 evidence id) + pro-attribution rate.

## 6. Access gating (worked example)

```python
# api/routes/coaching.py (after)
@router.get("/{match_id}")
async def get_coaching(
    match_id: str,
    payload: CoachingPayload = Depends(load_coaching),
    gate: GateResult = Depends(require_entitlement(
        Entitlement.FULL_COACHING, preview=coaching_preview)),
):
    return gate.apply(payload)   # entitled → full findings; free tier → summary +
                                 # top finding with citations, drills redacted,
                                 # {"locked": true, "tier_needed": "solo_pro"}
```

`coaching_preview` builds the redacted body from the same findings JSON (summary, one
high-severity claim, no drills, no per-player reports) — a real taste of the product,
never a 500, per the constraint. The frontend renders `locked` as the upgrade card.

## 7. Async execution (deviation, justified)

The prompt names BullMQ/Celery/Redis Streams. This repo deliberately replaced
Cloud Tasks + Pub/Sub + BackgroundTasks with a Postgres `jobs` table claimed via
`FOR UPDATE SKIP LOCKED` (TECHNICAL_SPEC §15, load-tested design in
BACKEND_DESIGN_PLAN §1.2). It satisfies the actual constraint — parsing and coaching
run asynchronously in workers, retried, horizontally scalable — with one fewer
stateful dependency. **Keep it.** The refactor only moves it to
`services/ingestion/queue.py` and adds a `queue_depth` metrics endpoint for
autoscaling. Revisit Redis Streams only if job throughput outgrows Postgres
(>~1k jobs/s, far beyond current scale).

Other deviations: parser persistence stays in the Python worker (Go parser remains a
pure function; ORM models live in Python — §15); vector store stays Qdrant with the
SQLite fallback as the local mock (no Pinecone — third store adds nothing).

## 8. Phased execution (each phase ships green through cleanup branch → staging → main)

| Phase | Work | Risk |
|---|---|---|
| 1 | Mechanical moves with import shims (`agents/khan` → `services/coaching_ai/orchestrator` etc.); import-linter contract in CI | Low — no behavior change |
| 2 | `rag_engine` consolidation + batched Retriever; delete shims | Low |
| 3 | Migrations 0007/0010; `billing/entitlements.py` + guard on coaching/jobs/stratbook routes with previews; Stripe webhooks server-side | Medium — touches auth paths |
| 4 | `AnalysisMode` table + mode-aware evidence/prompts; migration 0009 + parser sub-tick/trade fields | Medium |
| 5 | Stratbook state machine + migration 0008 + backfill; Discord interaction bot + sync | Medium — new surface |

Verification per phase: full pytest suite + new per-service contract tests (heuristics
run against fixture `RoundTelemetry` with zero DB), `ruff`/`mypy`/import-linter, Go
build+vet, frontend tsc/lint/build — same gates CI enforces today.
