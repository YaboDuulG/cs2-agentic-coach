"""
The Scribe — Evidence Pack Builder
===================================
Builds the per-match evidence pack that grounds every coaching claim:

    facts        F1..Fn  deterministic numbers from the tactician output
    baselines    B1..Bn  numeric pro reference values from the pro_baselines table
    pro_examples P1..Pn  situation-keyed RAG chunks for flagged rounds

The LLM narrates these IDs; it never measures anything itself.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Retrieval caps: only flagged rounds get situation-keyed retrieval.
MAX_FLAGGED_ROUNDS = 8
CHUNKS_PER_ROUND = 2

_BAD_SEVERITIES = ("warning", "critical")

_BOOTSTRAP_SOURCE = "bootstrap default, replace with HLTV aggregates"

_DEFAULT_BASELINES = [
    {
        "metric": "fcr_win_rate",
        "map_name": "any",
        "side": "any",
        "value": 0.50,
        "unit": "ratio",
        "detail": "Share of rounds won by the team that wins the opening duel (tier-1 average).",
    },
    {
        "metric": "fcr_win_rate",
        "map_name": "any",
        "side": "CT",
        "value": 0.53,
        "unit": "ratio",
        "detail": "CT-side round-win rate after winning the opening duel.",
    },
    {
        "metric": "fcr_win_rate",
        "map_name": "any",
        "side": "T",
        "value": 0.47,
        "unit": "ratio",
        "detail": "T-side round-win rate after winning the opening duel.",
    },
    {
        "metric": "eco_save_threshold",
        "map_name": "any",
        "side": "any",
        "value": 2000.0,
        "unit": "currency",
        "detail": "Pro teams full-save below this bank unless closing out map point.",
    },
    {
        "metric": "force_buy_winrate",
        "map_name": "any",
        "side": "any",
        "value": 0.22,
        "unit": "ratio",
        "detail": "Round-win rate of a force buy into an opponent full buy.",
    },
    {
        "metric": "util_before_entry",
        "map_name": "any",
        "side": "any",
        "value": 0.70,
        "unit": "ratio",
        "detail": "Fraction of pro site executes with smoke + flash support thrown before entry.",
    },
    {
        "metric": "economy_coherence",
        "map_name": "any",
        "side": "any",
        "value": 0.80,
        "unit": "ratio",
        "detail": "Typical economy-coherence score (1.0 = no flagged buy decisions).",
    },
    {
        "metric": "util_efficiency",
        "map_name": "any",
        "side": "any",
        "value": 0.75,
        "unit": "ratio",
        "detail": "Typical utility-efficiency score for structured teams.",
    },
]


def seed_default_baselines(db) -> int:
    """Idempotently insert bootstrap pro baselines. Returns the number inserted."""
    from db.models import ProBaseline  # noqa: PLC0415

    inserted = 0
    for spec in _DEFAULT_BASELINES:
        exists = (
            db.query(ProBaseline)
            .filter_by(metric=spec["metric"], map_name=spec["map_name"], side=spec["side"])
            .first()
        )
        if exists:
            continue
        db.add(ProBaseline(source=_BOOTSTRAP_SOURCE, **spec))
        inserted += 1
    if inserted:
        db.commit()
    logger.info(f"[Evidence] Seeded {inserted} default pro baselines.")
    return inserted


def _lookup_baseline(db, metric: str, map_name: str, side: str):
    """Find the most specific baseline row for (metric, map, side), falling back to 'any'."""
    from db.models import ProBaseline  # noqa: PLC0415

    rows = db.query(ProBaseline).filter(ProBaseline.metric == metric).all()
    if not rows:
        return None

    map_variants = [map_name]
    if map_name.startswith("de_"):
        map_variants.append(map_name[3:])
    else:
        map_variants.append(f"de_{map_name}")

    candidates: list[tuple[str, str]] = []
    for m in map_variants:
        candidates.extend([(m, side), (m, "any")])
    candidates.extend([("any", side), ("any", "any")])

    for m, s in candidates:
        for row in rows:
            if row.map_name == m and row.side == s:
                return row
    return None


def build_evidence_pack(
    db,
    match_id: str,
    scout_out: dict[str, Any],
    tactical_analysis: dict[str, Any],
    rag_context: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Build the {facts, baselines, pro_examples} evidence pack for one match.

    Facts come from the tactician output, baselines from the pro_baselines table
    (with 'any' fallback), and pro_examples from situation-keyed retrieval for
    flagged rounds plus the match-level rag_context.
    """
    scout_out = scout_out or {}
    tactical_analysis = tactical_analysis or {}
    rag_context = rag_context or []

    fcr = tactical_analysis.get("fcr") or {}
    economy = tactical_analysis.get("economy") or {}
    rotations = tactical_analysis.get("rotations") or {}
    positions = tactical_analysis.get("positions") or {}
    utility = tactical_analysis.get("utility") or {}

    map_name = scout_out.get("map_name") or fcr.get("map_name") or "unknown"

    # ------------------------------------------------------------------ facts
    facts: list[dict[str, Any]] = []

    def add_fact(
        kind: str,
        detail: str,
        rounds: list[int] | None = None,
        player: str | None = None,
        value: float | None = None,
        severity: str | None = None,
    ) -> None:
        fact: dict[str, Any] = {
            "id": f"F{len(facts) + 1}",
            "kind": kind,
            "detail": detail,
            "rounds": sorted({r for r in (rounds or []) if r is not None}),
        }
        if player:
            fact["player"] = player
        if value is not None:
            fact["value"] = value
        if severity:
            fact["severity"] = severity
        facts.append(fact)

    # FCR — match-level rate, per-player duel stats, and coaching flags
    fcr_rounds = fcr.get("rounds") or []
    if fcr.get("fcr_match_rate") is not None and fcr_rounds:
        rate = float(fcr["fcr_match_rate"])
        add_fact(
            "fcr",
            f"First-contact winner also won the round in {rate:.0%} of rounds "
            f"(CT first kills: {fcr.get('ct_fcr_wins', 0)}, T first kills: {fcr.get('t_fcr_wins', 0)}).",
            rounds=[r.get("round_num") for r in fcr_rounds],
            value=round(rate, 4),
        )
    for name, ps in (fcr.get("player_stats") or {}).items():
        first_kills = ps.get("first_kills", 0)
        first_deaths = ps.get("first_deaths", 0)
        if first_kills + first_deaths < 3:
            continue
        player_rounds = [
            r.get("round_num")
            for r in fcr_rounds
            if r.get("attacker") == name or r.get("victim") == name
        ]
        add_fact(
            "fcr",
            f"{name} took first contact in {first_kills + first_deaths} rounds: "
            f"{first_kills} first kills vs {first_deaths} first deaths "
            f"(first-kill rate {ps.get('first_kill_rate', 0):.0%}, "
            f"conversion rate {ps.get('conversion_rate', 0):.0%}).",
            rounds=player_rounds,
            player=name,
            value=ps.get("first_kill_rate"),
        )
    for flag in fcr.get("flags") or []:
        add_fact(
            "fcr",
            flag.get("message", ""),
            player=flag.get("player"),
            severity=flag.get("severity"),
        )

    # Economy — coherence score and per-round buy flags
    eco_rounds_by_num = {r.get("round_num"): r for r in economy.get("rounds") or []}
    if economy.get("overall_coherence_score") is not None:
        score = float(economy["overall_coherence_score"])
        add_fact(
            "economy",
            f"Economy coherence score {score:.2f} (1.0 = no flagged buy decisions).",
            value=round(score, 4),
        )
    for flag in economy.get("flags") or []:
        rn = flag.get("round_num")
        team = flag.get("team")
        eco_r = eco_rounds_by_num.get(rn) or {}
        val = eco_r.get("ct_eq_val") if team == "CT" else eco_r.get("t_eq_val")
        add_fact(
            "economy",
            f"Round {rn}: {flag.get('message', '')}",
            rounds=[rn],
            value=val,
            severity=flag.get("severity"),
        )

    # Utility — efficiency score and sequencing flags
    if utility.get("overall_efficiency") is not None:
        eff = float(utility["overall_efficiency"])
        add_fact("utility", f"Utility efficiency score {eff:.2f}.", value=round(eff, 4))
    for flag in utility.get("flags") or []:
        rn = flag.get("round_num")
        player = flag.get("player")
        add_fact(
            "utility",
            f"Round {rn}: {flag.get('message', '')}",
            rounds=[rn],
            player=player if player and player != "Team" else None,
            severity=flag.get("severity"),
        )

    # Rotations — late-rotation flags and consistently slow rotators
    for flag in rotations.get("flags") or []:
        rn = flag.get("round_num")
        add_fact(
            "rotation",
            f"Round {rn}: {flag.get('message', '')}",
            rounds=[rn],
            player=flag.get("player"),
            severity=flag.get("severity"),
        )
    for ps in rotations.get("player_scores") or []:
        score = ps.get("rotation_score")
        if score is not None and score < 0.3:
            add_fact(
                "rotation",
                f"{ps.get('player')} rotation score {score:.2f} "
                f"(avg velocity {ps.get('avg_velocity', 0):.0f}) — consistently slow repositioning.",
                player=ps.get("player"),
                value=score,
            )

    # Positional pattern tags (no round linkage — match-level tendencies)
    for tag in positions.get("tags") or []:
        add_fact(
            "positioning",
            f"{tag.get('tag')}: {tag.get('description', '')}",
            player=tag.get("player"),
            severity=tag.get("severity"),
        )

    # -------------------------------------------------------------- baselines
    baselines: list[dict[str, Any]] = []
    seen_baselines: set[tuple[str, str, str]] = set()

    def add_baseline(row) -> None:
        if row is None:
            return
        key = (row.metric, row.map_name, row.side)
        if key in seen_baselines:
            return
        seen_baselines.add(key)
        baselines.append(
            {
                "id": f"B{len(baselines) + 1}",
                "metric": row.metric,
                "map_name": row.map_name,
                "side": row.side,
                "value": row.value,
                "unit": row.unit,
                "detail": row.detail,
                "source": row.source,
            }
        )

    metric_requests: list[tuple[str, str]] = []
    if fcr:
        metric_requests.extend(
            [("fcr_win_rate", "any"), ("fcr_win_rate", "CT"), ("fcr_win_rate", "T")]
        )
    if economy:
        metric_requests.extend(
            [
                ("eco_save_threshold", "any"),
                ("force_buy_winrate", "any"),
                ("economy_coherence", "any"),
            ]
        )
    if utility:
        metric_requests.extend([("util_before_entry", "any"), ("util_efficiency", "any")])

    for metric, side in metric_requests:
        try:
            add_baseline(_lookup_baseline(db, metric, map_name, side))
        except Exception as e:
            logger.error(f"Baseline lookup failed for {metric}/{side}: {e}")

    # ----------------------------------------------------------- pro_examples
    # Flagged rounds: any round a tactician flag (warning/critical) points at.
    flagged: set[int] = set()
    flag_side_by_round: dict[int, str] = {}
    for flag in economy.get("flags") or []:
        rn = flag.get("round_num")
        if rn is not None and flag.get("severity") in _BAD_SEVERITIES:
            flagged.add(rn)
            if flag.get("team"):
                flag_side_by_round.setdefault(rn, flag["team"])
    for source_flags in (utility.get("flags") or [], rotations.get("flags") or []):
        for flag in source_flags:
            rn = flag.get("round_num")
            if rn is not None and flag.get("severity") in _BAD_SEVERITIES:
                flagged.add(rn)
    flagged_rounds = sorted(flagged)[:MAX_FLAGGED_ROUNDS]

    round_history = {r.get("round_num"): r for r in scout_out.get("round_history") or []}

    pro_examples: list[dict[str, Any]] = []

    def add_example(round_ref: int | None, chunk: dict[str, Any]) -> None:
        pro_examples.append(
            {
                "id": f"P{len(pro_examples) + 1}",
                "round_ref": round_ref,
                "detail": chunk.get("content", ""),
                "source": chunk.get("source") or "hltv_pro_match",
            }
        )

    from db.rag import retrieve_similar_chunks  # noqa: PLC0415

    for rn in flagged_rounds:
        hist = round_history.get(rn) or {}
        winner = hist.get("winner_side")
        side = flag_side_by_round.get(rn)
        if not side:
            # Default focus to the side that lost the round — that's where the error was.
            side = {"CT": "T", "T": "CT"}.get(winner, "any")
        eco_r = eco_rounds_by_num.get(rn) or {}
        buy_tier = eco_r.get("ct_type") if side == "CT" else eco_r.get("t_type")
        outcome = "won" if winner and side == winner else "lost"
        query = f"pro CS2 {map_name} {side} side {buy_tier or 'unknown buy'} round {outcome} tactics"
        try:
            chunks = retrieve_similar_chunks(
                db, query=query, limit=CHUNKS_PER_ROUND, source="hltv_pro_match"
            )
        except Exception as e:
            logger.error(f"Situation retrieval failed for round {rn}: {e}")
            chunks = []
        for chunk in chunks:
            add_example(rn, chunk)

    # Reuse the match-level rag_context as additional (round-agnostic) examples.
    for chunk in rag_context:
        add_example(None, chunk)

    pack = {
        "facts": facts,
        "baselines": baselines,
        "pro_examples": pro_examples,
        "flagged_rounds": flagged_rounds,
    }
    logger.info(
        f"[Evidence] match={match_id} facts={len(facts)} baselines={len(baselines)} "
        f"pro_examples={len(pro_examples)} flagged_rounds={flagged_rounds}"
    )
    return pack
