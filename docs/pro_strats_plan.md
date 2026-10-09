# Pro strats: from pro demos to gated, callable strats

Plan of record for the pro-strat workstream. Written 2026-10-07 against
`main` = `05ff374`. Owner decisions are in §6; nothing below starts until
D1 and D2 are answered.

## 1. Where things stand

What exists in code, end to end: HLTV delta monitor → demo parse → archetype
extractor → `ProStratArchetype` rows + Qdrant vectors → hybrid retrieval →
the debrief's evidence pack (`pro_examples` with `pro_match_id`).

What exists in production: nothing. `pro_tournaments`, `pro_matches`,
`pro_rounds`, `pro_strat_archetypes`, `pro_baselines` and `map_playbooks` all
have zero rows. The nightly crawler is manual-only and skips without
`DATABASE_URL` and `GEMINI_API_KEY` as Actions secrets. No Qdrant URL or key is
configured anywhere, so retrieval would run on its BM25 leg alone. The
debrief's "Benchmark" values come from `_DEFAULT_BASELINES` seeded in code, and
the stratbook critique compares against an empty `MapPlaybook`.

What the new rules module expects versus what the extractor produces:

| `gate_archetype_draft` needs | Today's `ArchetypeDraft` has |
|---|---|
| players coordinating ("Player 1 … Player 2", roles) | none: a label like "Mirage A-Execute with 3 Smokes" and metric prose |
| a contingency ("if X, then Y") | none: aggregates of observed rounds |
| optionally a `StratTemplate` (roles, timing, utility, steps, counters) | none |

So wired as-is, the gate rejects every draft as a tip. The gate is right; the
drafts are not strats yet. They are **patterns**: evidence that a team ran an
A-execute with three smokes eleven times and won seven. The work is to turn
patterns into template-shaped strats with evidence attached, gate those, and
keep the patterns as the citations behind them.

## 2. Target

```
pro demo ──parse──▶ ParseResult
   │
   ▼ extractor (deterministic)
ArchetypeDraft  = pattern: label, metrics, round list            ── stays as is
   │
   ▼ NEW template writer (deterministic fields + one Gemini call)
StratTemplate   = roles, timing, utility ownership, steps,
                  contingencies, counters, each field citing rounds
   │
   ▼ gate_archetype_draft (services/pro_strats/rules.py)
ACCEPT ──▶ ProStratArchetype.template_json + gate_status='accepted'
NEEDS_REVIEW ─▶ gate_status='review' (visible to admin, not to users)
REJECT ──▶ gate_status='pattern' (kept for retrieval and baselines only)
   │
   ├──▶ MapPlaybook per map, regenerated from accepted strats    (critique)
   ├──▶ evidence pack pro_examples with round numbers + ticks   (debrief)
   ├──▶ ProBaseline measured from ProRound metrics               (benchmarks)
   └──▶ Team Hub → Stratbook → "Pro library" tab                 (users)
```

Rule that keeps the zero-hallucination contract: every template field the
writer produces must name the round numbers it came from, and the writer only
sees that archetype's rounds. A field without a citation fails validation.

## 3. Phases

Each phase is one branch, one PR-sized change, shippable on its own. Sizes
are working sessions, not hours.

### Phase 0: turn the pipeline on (owner + 1 session)

Exit: `pro_strat_archetypes` has rows for at least three maps from real pro
demos, and the nightly crawler runs.

1. Decide the demo source (D1) and the team/tier scope (D2).
2. Add `DATABASE_URL` and `GEMINI_API_KEY` as Actions secrets; re-add the
   cron to `hltv-crawler.yml`. Optionally provision Qdrant (D3) and add
   `QDRANT_URL` / `QDRANT_API_KEY` to the API and worker secrets.
3. Seed: `scripts/seed_pro_matches.py --limit-per-team N` once, then let the
   delta monitor keep up.
4. Verify with a read-only script (new, `scripts/pro_meta_doctor.py`, same
   shape as the Discord doctor): row counts per map, latest `ingested_at`,
   archetypes per map, retrieval smoke query returning attributed chunks.

Risk: the extractor only labels four maps (`MAP_GEOMETRY`); Anubis, Dust2 and
Vertigo zones are listed but their labels are unvalidated. Phase 0 proves the
four; Phase 1 extends.

### Phase 1: richer patterns, deterministically (2 sessions)

Exit: an `ArchetypeDraft` carries enough structure that a human could write
the template from it without opening the demo.

Add to `services/rag_engine/extractor.py`, all from telemetry already in
`ParseResult` (kills carry attacker/victim and positions; grenades carry
thrower, type, tick, landing point; rounds carry economy and winner):

- **Roles per round**: entry (first kill or first death on the attacking
  side), trader (killed the entry's killer within the trade window), lurker
  (farthest from the pack at first contact), support (most utility thrown
  before first contact), AWPer (weapon). Stored per round as
  `{steamid → role}` and aggregated per archetype as role stability (how
  often the same player holds the role).
- **Timing**: trigger tick (first grenade of the execute), first contact
  tick, plant tick, as seconds from round start; medians per archetype.
- **Utility ownership**: per grenade, thrower role, type, landing zone,
  seconds before first contact; grouped into the archetype's utility set with
  frequency (a smoke thrown in 9 of 11 rounds is part of the strat; 2 of 11 is
  noise).
- **Branches observed**: for the same archetype, rounds split by what the
  defence did at first contact (stack on the target site, rotate early, push
  out) and the outcome of each branch. These are the raw material for
  contingencies: "when they stacked A (3 rounds), the team went B (won 2)".
- **Citations**: every aggregate keeps `(pro_match_id, round_num,
  tick_range)` for the rounds behind it. This also closes backlog 3.3's
  `tick_range` item.

Extend `MAP_GEOMETRY` labels to Anubis, Dust2 and Vertigo, validated the same
way the four were (one demo each, labels eyeballed against the radar in the
replay lab).

Tests: `tests/test_extractor_roles.py` with a hand-built `ParseResult` for
one round of each shape (execute, split, default, hold) asserting roles,
timing, utility ownership and branch assignment.

### Phase 2: template writer and gate (2 sessions)

Exit: accepted strats exist in the database with citations, and nothing is
accepted that the gate would reject.

- `services/pro_strats/writer.py`: `write_template(draft) -> StratTemplate`.
  Deterministic fields first (identity, buy, roles from Phase 1, timing,
  utility, execution steps in tick order). One schema-constrained Gemini call
  (`gemini-2.5-flash`, `response_schema` = `StratTemplate`, temperature 0.2,
  metered as `purpose="pro_strat"`) fills only the prose fields:
  `contingencies` from the observed branches, `what_beats_it` and
  `when_not_to_call` from the losing rounds. The prompt contains only that
  archetype's rounds and metrics; the output must cite round numbers in each
  prose field, checked by regex after the call; a field without a citation is
  blanked, which fails the template and routes the draft to review rather
  than accepting it.
- Gate order in `services/rag_engine/worker.py`: extractor → `vectorize_archetypes`
  (unchanged, the pattern row and its vector) → writer → `gate_archetype_draft`
  with `summary_text` = the writer's prose and `template` = the template →
  store `template_json`, `gate_status`, `gate_reasons` on the row.
- Schema: `pro_strat_archetypes` gains `template_json TEXT`, `gate_status
  VARCHAR(16) DEFAULT 'pattern'`, `gate_reasons TEXT`, `citations_json TEXT`
  (migration + the deploy job's `ADD COLUMN IF NOT EXISTS` line).
- Idempotent: re-running the cycle on the same match re-gates; a status never
  goes from `accepted` back to `pattern` without a changed template.
- Budget: one Gemini call per archetype per ingestion, roughly 8–15
  archetypes per match. At flash prices that is cents per match; the admin
  metering page shows it under `pro_strat`.

Tests: writer with a fake Gemini (fixed JSON) proving citation checking,
blanking and routing; gate integration proving `accepted` rows pass
`validate_template` 8/8; a rerun test for idempotence.

### Phase 3: consumers (2 sessions)

Exit: the three places that cite "pro play" today read measured data, and say
so.

- **Baselines**: implement `compute_pro_baselines()` in
  `agents/scribe/evidence.py` from `ProRound.metrics_json` (median and IQR per
  metric, map, side), writing `ProBaseline` rows with `source='measured:
  <n> pro rounds, <date>'`. The bootstrap rows stay as fallback for metrics
  with fewer than 30 pro rounds. The debrief's `FindingCard` shows
  "Benchmark" for measured values and "Estimated benchmark" for bootstrap
  ones, which settles TASKS.md §3.4 by making the label honest in both cases.
- **MapPlaybook**: `services/pro_strats/playbook.py` regenerates each map's
  `playbook_json` from accepted archetypes (top strats per side and buy,
  with their citations) at the end of every ingestion cycle. The strat
  reviewer then critiques against real pro strats; `scripts/seed_playbooks.py`
  becomes a fallback for an empty table.
- **Evidence pack**: `pro_examples` carry `round_nums` and `tick_range` from
  `citations_json`; the citation contract in `report_generator.py` requires
  them for a pro example to count as grounded.

Tests: baseline computation on a seeded `ProRound` set; playbook generation;
an evidence-pack test asserting the new citation fields.

### Phase 4: users see it (1–2 sessions)

Exit: a Team-plan user can browse accepted pro strats for a map and start
their own strat from one.

- `GET /api/pro-strats?map=&side=&buy=` (Team entitlement, 402 otherwise):
  accepted archetypes with template, team, patch, win rate, round citations.
- Team Hub → Stratbook → **Pro library** tab: filters by map and side, a card
  per strat showing the eight sections, "Start from this" creates a DRAFT
  strat in the team's stratbook with the template as its description and the
  median positions at first contact as the first canvas step (`canvasToBoard`
  already renders that shape). Discord sync then applies unchanged.
- The personal stratbook's critique panel shows "compared against N pro strats
  on this map" so the user knows what the critique is grounded in.

Tests: route gating and shape; a Playwright capture of the tab with mocked
data in the existing team-shots suite.

## 4. Order and dependencies

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
 (owner)   (extractor)  (writer+gate) (consumers)  (UI)
```

Phase 1 can start before Phase 0 finishes, since its tests use hand-built
parse results, but it cannot be validated on real labels without Phase 0.
Phase 3's baseline work only needs Phase 0 (pro rounds), not Phase 2, so it
can run in parallel with Phase 2 if the benchmark label is the priority.

## 5. What this does not do

- Live Discord listening or any change to the stratbook state machine.
- Canvas drawings of pro strats beyond the first-contact positions; full
  animated reconstructions are a later product decision.
- Personal (non-Team) access to the pro library; it is a Team feature by the
  pricing decision in TASKS.md §1.

## 6. Owner decisions needed first

- **D1. Demo source.** `scripts/seed_pro_matches.py` scrapes HLTV with
  Playwright and downloads demo archives. HLTV's terms restrict automated
  access and demo links expire; a nightly scraper from a Cloud Run job is the
  most likely thing to break or be blocked. Alternatives: a manual monthly
  download by you into the GCS bucket (the delta monitor can read a bucket
  listing instead of HLTV), or a paid demo API. The pipeline is the same
  after the download step.
- **D2. Scope.** Which teams and tiers (the seed script names six teams), how
  many months back, and which maps. Fewer, deeper is better for Phase 1's
  branch analysis: thirty rounds of one team's A-execute beat three rounds
  each from ten teams.
- **D3. Qdrant.** Retrieval works on BM25 alone over `summary_text`; dense
  retrieval helps once there are hundreds of archetypes. Provisioning Qdrant
  Cloud (free tier is enough to start) can wait until Phase 3 shows BM25
  falling short.
- **D4. Review surface.** `NEEDS_REVIEW` archetypes need somewhere to be
  reviewed. Cheapest: a table on `/settings/admin` with accept/reject that
  edits `gate_status`. That is a small Phase 2 add-on if you want it.

## 7. Tracking

Rows in `TASKS.md` §4: P0 (activate), P1 (extractor), P2 (writer + gate),
P3 (consumers; closes backlog 3.3 and the §3.4 benchmark decision), P4 (UI).
This file is the detail; `services/pro_strats/rules.py`'s docstring is the
contract the gate enforces.
