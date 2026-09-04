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

_TELEMETRY_V2_SOURCE = "bootstrap default, replace with pro round_features distributions"

# Halftime boundary (MR12) — same assumption as agents/khan/stats.py round mapping.
_HALFTIME_ROUND = 12

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

# Telemetry-v2 baselines (round_features aggregates, DATA_ARCHITECTURE §4).
# Bootstrap guesses until compute_pro_baselines can derive them from pro demos.
_TELEMETRY_V2_BASELINES = [
    {
        "metric": "util_damage_per_round",
        "map_name": "any",
        "side": "any",
        "value": 85.0,
        "unit": "hp",
        "detail": "Typical HE/molly damage a pro side deals per round.",
    },
    {
        "metric": "enemy_blind_seconds_per_flash",
        "map_name": "any",
        "side": "any",
        "value": 1.6,
        "unit": "seconds",
        "detail": "Enemy blind time a well-thrown pro flash buys.",
    },
    {
        "metric": "team_flash_seconds_per_round",
        "map_name": "any",
        "side": "any",
        "value": 0.4,
        "unit": "seconds",
        "detail": "Teammate blind time pro sides tolerate per round — more is a flash-timing problem.",
    },
    {
        "metric": "trade_window_s",
        "map_name": "any",
        "side": "any",
        "value": 2.8,
        "unit": "seconds",
        "detail": "Average time a pro teammate needs to refrag after a death.",
    },
    {
        "metric": "trade_success_rate",
        "map_name": "any",
        "side": "any",
        "value": 0.55,
        "unit": "ratio",
        "detail": "Share of pro deaths answered by a trade kill.",
    },
    {
        "metric": "exec_sync_score",
        "map_name": "any",
        "side": "any",
        "value": 0.75,
        "unit": "ratio",
        "detail": "Execute-sync score (1.0 = utility and entries perfectly simultaneous) for pro executes.",
    },
    {
        "metric": "opening_flash_assist_rate",
        "map_name": "any",
        "side": "any",
        "value": 0.35,
        "unit": "ratio",
        "detail": "Fraction of pro opening duels taken with flash assistance.",
    },
]


def seed_default_baselines(db) -> int:
    """Idempotently insert bootstrap pro baselines. Returns the number inserted."""
    from db.models import ProBaseline  # noqa: PLC0415

    inserted = 0
    for source, specs in (
        (_BOOTSTRAP_SOURCE, _DEFAULT_BASELINES),
        (_TELEMETRY_V2_SOURCE, _TELEMETRY_V2_BASELINES),
    ):
        for spec in specs:
            exists = (
                db.query(ProBaseline)
                .filter_by(metric=spec["metric"], map_name=spec["map_name"], side=spec["side"])
                .first()
            )
            if exists:
                continue
            db.add(ProBaseline(source=source, **spec))
            inserted += 1
    if inserted:
        db.commit()
    logger.info(f"[Evidence] Seeded {inserted} default pro baselines.")
    return inserted


def compute_pro_baselines(db) -> int:
    """Upgrade the telemetry-v2 bootstrap baselines from pro round_features distributions.

    Today no pro-side RoundFeature data exists (the ingestion pipeline only writes
    round_features for uploaded amateur demos), so this is a documented stub that
    returns 0. Once pro demos flow through the same extraction pass, this should
    replace the `_TELEMETRY_V2_SOURCE` rows with measured distributions rather
    than bootstrap guesses. Do NOT fabricate numbers here.

    Query shape once pro round_features exist (rows joined to pro matches):
        SELECT AVG(util_damage),                 -- -> util_damage_per_round
               AVG(enemy_blind_seconds),          -- -> enemy_blind_seconds_per_flash (÷ flashes)
               AVG(team_blind_seconds),           -- -> team_flash_seconds_per_round
               AVG(avg_trade_window_s),           -- -> trade_window_s
               AVG(trade_success_rate),           -- -> trade_success_rate
               AVG(exec_sync_score),              -- -> exec_sync_score
               AVG(CASE WHEN opening_flash_assist THEN 1.0 ELSE 0.0 END)
                                                  -- -> opening_flash_assist_rate
        FROM round_features rf JOIN matches m USING (match_id)
        WHERE m.is_pro  -- however pro provenance ends up flagged
        GROUP BY m.map_name, rf.side_focus;      -- per-map/side rows, 'any' from the global agg
    Returns the number of baseline rows upgraded.
    """
    return 0


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


def _focus_round_features(rows, scout_out: dict[str, Any]):
    """Restrict RoundFeature rows to the uploader's side each round.

    Team mode keeps both sides (macro coaching covers the whole half swap);
    otherwise, when the uploader's starting side is known, keep only the rows
    whose side_focus matches the side the uploader played that round
    (halftime swap at _HALFTIME_ROUND). Unknown side, or a filter that would
    drop everything, falls back to all rows rather than losing the data.
    """
    from agents.scribe.modes import AnalysisMode, derive_mode  # noqa: PLC0415

    if derive_mode(scout_out) == AnalysisMode.TEAM_ANALYSIS:
        return rows
    start = scout_out.get("user_team")
    if start == "TERRORIST":
        start = "T"
    if start not in ("CT", "T"):
        return rows
    flip = {"CT": "T", "T": "CT"}
    focused = [
        r
        for r in rows
        if r.side_focus == (start if r.round_num <= _HALFTIME_ROUND else flip[start])
    ]
    return focused or rows


def _add_round_feature_facts(db, match_id: str, scout_out: dict[str, Any], add_fact):
    """Facts from the telemetry-v2 round_features aggregates (DATA_ARCHITECTURE §4).

    Returns the (metric, side) baseline requests for whichever facts were added,
    so they pair with baselines exactly like the tactician-derived facts.
    Zero RoundFeature rows for the match → adds nothing, requests nothing.
    """
    from collections import Counter  # noqa: PLC0415

    from db.models import RoundFeature, demo_id_for  # noqa: PLC0415

    metric_requests: list[tuple[str, str]] = []
    try:
        rows = (
            db.query(RoundFeature)
            .filter(RoundFeature.demo_id == demo_id_for(db, match_id))
            .order_by(RoundFeature.round_num)
            .all()
        )
    except Exception as e:
        logger.warning(f"Could not load round features: {e}")
        return metric_requests
    rows = _focus_round_features(rows, scout_out)
    if not rows:
        return metric_requests

    all_rounds = [r.round_num for r in rows]

    # Opening duels: flash-assist rate on the rounds where an opening duel exists
    flash_rows = [r for r in rows if r.opening_flash_assist is not None]
    if flash_rows:
        assisted = sum(1 for r in flash_rows if r.opening_flash_assist)
        rate = assisted / len(flash_rows)
        add_fact(
            "opening_flash",
            f"{assisted} of {len(flash_rows)} opening duels taken with flash assistance "
            f"({rate:.0%}).",
            rounds=[r.round_num for r in flash_rows],
            value=round(rate, 4),
        )
        metric_requests.append(("opening_flash_assist_rate", "any"))

    # Opening zones: where the opening fight keeps getting lost
    lost = [r for r in rows if r.opening_duel_won is False and r.opening_zone]
    if lost:
        zone, count = Counter(r.opening_zone for r in lost).most_common(1)[0]
        add_fact(
            "opening_zone",
            f"Keep losing the opening fight at {zone} "
            f"({count} of {len(lost)} lost opening duels).",
            rounds=[r.round_num for r in lost if r.opening_zone == zone],
            value=float(count),
        )

    # Utility effectiveness: HE/molly damage and flash blind time
    avg_util = sum(r.util_damage for r in rows) / len(rows)
    add_fact(
        "util_damage",
        f"Average utility damage {avg_util:.0f} HP per round (HE grenades and mollies).",
        rounds=all_rounds,
        value=round(avg_util, 4),
    )
    metric_requests.append(("util_damage_per_round", "any"))

    team_flash_total = sum(r.team_blind_seconds for r in rows)
    enemy_blind_avg = sum(r.enemy_blind_seconds for r in rows) / len(rows)
    if team_flash_total > 0 or enemy_blind_avg > 0:
        add_fact(
            "team_flash",
            f"Flashes blinded enemies for {enemy_blind_avg:.1f}s per round on average; "
            f"blinded teammates for {team_flash_total:.1f}s total.",
            rounds=[r.round_num for r in rows if r.team_blind_seconds > 0],
            value=round(team_flash_total, 4),
        )
        metric_requests.extend(
            [("enemy_blind_seconds_per_flash", "any"), ("team_flash_seconds_per_round", "any")]
        )

    # Trade discipline: only rounds with deaths carry a trade_success_rate
    traded = [r for r in rows if r.trade_success_rate is not None]
    if traded:
        mean_rate = sum(r.trade_success_rate for r in traded) / len(traded)
        windows = [r.avg_trade_window_s for r in traded if r.avg_trade_window_s is not None]
        window_part = (
            f"; average trade window {sum(windows) / len(windows):.1f}s" if windows else ""
        )
        worst = sorted(traded, key=lambda r: r.trade_success_rate)[:3]
        add_fact(
            "trade_spacing",
            f"Deaths were traded at a {mean_rate:.0%} rate on average{window_part}.",
            rounds=[r.round_num for r in worst],
            value=round(mean_rate, 4),
        )
        metric_requests.append(("trade_success_rate", "any"))
        if windows:
            metric_requests.append(("trade_window_s", "any"))

    # Execution sync: simultaneity of utility and site entries on executes
    synced = [r for r in rows if r.exec_sync_score is not None]
    if synced:
        mean_sync = sum(r.exec_sync_score for r in synced) / len(synced)
        worst = sorted(synced, key=lambda r: r.exec_sync_score)[:2]
        add_fact(
            "exec_sync",
            f"Execute sync score {mean_sync:.2f} on average "
            f"(1.0 = utility and entries perfectly synchronized).",
            rounds=[r.round_num for r in worst],
            value=round(mean_sync, 4),
        )
        metric_requests.append(("exec_sync_score", "any"))

    return metric_requests


def _add_uploader_facts(db, match_id: str, scout_out: dict[str, Any], add_fact):
    """Facts scoped to the uploader's Steam ID — PERSONAL_IMPROVEMENT mode only.

    The mode instruction tells the LLM to coach only the uploader; these facts
    are what make that possible: their opening duels, whether their deaths got
    traded, their flash quality, their utility damage, and their headshot rate,
    all computed straight from the event tables keyed on the linked Steam ID.

    If the linked Steam ID never appears in the demo's events, an 'identity'
    fact says so explicitly, so the report can tell the user instead of
    silently coaching the whole lobby. Returns (metric, side) baseline
    requests like _add_round_feature_facts.
    """
    from agents.scribe.modes import AnalysisMode, derive_mode  # noqa: PLC0415
    from db.models import Damage, FlashEventRow, Kill, demo_id_for  # noqa: PLC0415
    from services.tactician.features_v2 import TRADE_WINDOW_S  # noqa: PLC0415

    metric_requests: list[tuple[str, str]] = []
    if derive_mode(scout_out) != AnalysisMode.PERSONAL_IMPROVEMENT:
        return metric_requests
    sid = scout_out.get("uploader_steam_id")
    if not sid:
        add_fact(
            "identity",
            "No Steam ID is linked to the uploader's account, so the coach cannot tell "
            "which player they are. Coaching below is team-level; link a Steam ID on the "
            "profile page for personal analysis.",
            severity="warning",
        )
        return metric_requests

    did = demo_id_for(db, match_id)
    try:
        kills = (
            db.query(Kill)
            .filter(Kill.demo_id == did)
            .order_by(Kill.round_num, Kill.tick)
            .all()
        )
    except Exception as e:
        logger.warning(f"Could not load kills for uploader facts: {e}")
        return metric_requests

    my_kills = [k for k in kills if k.attacker_steamid == sid]
    my_deaths = [k for k in kills if k.victim_steamid == sid]
    if not my_kills and not my_deaths:
        add_fact(
            "identity",
            f"The linked Steam ID {sid} does not appear in this demo's kill feed — the "
            "uploader may not be playing in this match (or the wrong account is linked). "
            "Coaching below is team-level, not personal.",
            severity="warning",
        )
        return metric_requests

    tickrate = 64
    try:
        from db.models import Match  # noqa: PLC0415

        m = db.query(Match).filter(Match.match_id == match_id).first()
        if m is not None and m.tickrate:
            tickrate = int(m.tickrate)
    except Exception:
        pass

    # Opening duels the uploader personally took (first kill of the round).
    first_by_round: dict[int, Any] = {}
    for k in kills:
        if k.round_num not in first_by_round or k.tick < first_by_round[k.round_num].tick:
            first_by_round[k.round_num] = k
    my_openers = [
        fc for fc in first_by_round.values() if sid in (fc.attacker_steamid, fc.victim_steamid)
    ]
    if my_openers:
        won = sum(1 for fc in my_openers if fc.attacker_steamid == sid)
        add_fact(
            "you_opening",
            f"You personally took the opening duel in {len(my_openers)} rounds: "
            f"{won} first kills vs {len(my_openers) - won} first deaths.",
            rounds=[fc.round_num for fc in my_openers],
            player=sid,
            value=round(won / len(my_openers), 4),
        )

    # Were the uploader's deaths traded? (teammate refrags the killer in time)
    if my_deaths:
        window_ticks = TRADE_WINDOW_S * tickrate
        untraded_rounds: list[int] = []
        traded = 0
        for d in my_deaths:
            killer = d.attacker_steamid
            was_traded = any(
                k.victim_steamid == killer
                and k.round_num == d.round_num
                and d.tick < k.tick <= d.tick + window_ticks
                for k in kills
            )
            if was_traded:
                traded += 1
            else:
                untraded_rounds.append(d.round_num)
        add_fact(
            "you_traded",
            f"You died {len(my_deaths)} times; {traded} of those deaths were traded by a "
            f"teammate within {TRADE_WINDOW_S:.0f}s ({traded / len(my_deaths):.0%}).",
            rounds=untraded_rounds,
            player=sid,
            value=round(traded / len(my_deaths), 4),
        )
        metric_requests.append(("trade_success_rate", "any"))

    # Headshot rate as a crosshair-placement proxy.
    if my_kills:
        hs = sum(1 for k in my_kills if k.headshot)
        add_fact(
            "you_crosshair",
            f"You got {len(my_kills)} kills, {hs} by headshot ({hs / len(my_kills):.0%} "
            "headshot rate — a crosshair-placement proxy).",
            rounds=[k.round_num for k in my_kills],
            player=sid,
            value=round(hs / len(my_kills), 4),
        )

    # Flash quality: enemy blind time bought vs teammates blinded.
    try:
        my_flashes = (
            db.query(FlashEventRow)
            .filter(FlashEventRow.demo_id == did, FlashEventRow.thrower_steamid == sid)
            .all()
        )
    except Exception as e:
        logger.warning(f"Could not load flash events for uploader facts: {e}")
        my_flashes = []
    if my_flashes:
        enemy_s = sum(f.blind_duration for f in my_flashes if not f.is_teammate)
        team_s = sum(f.blind_duration for f in my_flashes if f.is_teammate)
        add_fact(
            "you_flash",
            f"Your flashes blinded enemies for {enemy_s:.1f}s total and teammates for "
            f"{team_s:.1f}s total across {len(my_flashes)} blind events.",
            rounds=sorted({f.round_num for f in my_flashes}),
            player=sid,
            value=round(enemy_s, 4),
        )
        metric_requests.extend(
            [("enemy_blind_seconds_per_flash", "any"), ("team_flash_seconds_per_round", "any")]
        )

    # Personal utility damage (HE / molly).
    try:
        my_util = (
            db.query(Damage)
            .filter(
                Damage.demo_id == did,
                Damage.attacker_steamid == sid,
                Damage.is_utility.is_(True),
            )
            .all()
        )
    except Exception as e:
        logger.warning(f"Could not load damage events for uploader facts: {e}")
        my_util = []
    if my_util:
        total_hp = sum(d.hp_damage for d in my_util)
        add_fact(
            "you_util_damage",
            f"Your HE grenades and mollies dealt {total_hp} HP damage total.",
            rounds=sorted({d.round_num for d in my_util}),
            player=sid,
            value=float(total_hp),
        )
        metric_requests.append(("util_damage_per_round", "any"))

    return metric_requests


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

    # Telemetry v2 — round_features aggregates (opening duels, utility, trades,
    # execution sync). No rows for the match → adds nothing.
    rf_metric_requests = _add_round_feature_facts(db, match_id, scout_out, add_fact)

    # Personal mode: facts scoped to the uploader's own Steam ID, so the coach
    # can talk about *this player* instead of the whole lobby.
    rf_metric_requests.extend(_add_uploader_facts(db, match_id, scout_out, add_fact))

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
    metric_requests.extend(rf_metric_requests)

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
                # Hybrid retrieval returns "text"; the legacy path returns "content".
                "detail": chunk.get("text") or chunk.get("content", ""),
                "source": chunk.get("source") or "hltv_pro_match",
                # Attribution for the citation contract — present on archetype
                # chunks from the rag_engine, None on legacy corpus chunks.
                "pro_match_id": chunk.get("pro_match_id"),
            }
        )

    from db.rag import retrieve_similar_chunks  # noqa: PLC0415
    from services.rag_engine.retrieval import retrieve_pro_comps  # noqa: PLC0415

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

        # Primary: hybrid (BM25 + dense, strict metadata filters) over the pro
        # archetype library — returns attributed chunks with pro_match_id.
        chunks: list[dict[str, Any]] = []
        try:
            chunks = retrieve_pro_comps(
                db,
                query,
                map_name=map_name if map_name != "unknown" else None,
                side=side if side in ("CT", "T") else None,
                buy_type=buy_tier,
                top_k=CHUNKS_PER_ROUND,
            )
        except Exception as e:
            logger.error(f"Hybrid retrieval failed for round {rn}: {e}")
        # Fallback: legacy corpus search, so coaching keeps pro context while
        # the archetype library is still empty.
        if not chunks:
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

    # Representative tick per round (the round's first contact) so report
    # findings can carry a real tick — joined deterministically downstream,
    # never invented by the LLM.
    round_ticks: dict[int, int] = {}
    try:
        from db.models import FirstContact, demo_id_for  # noqa: PLC0415

        did = demo_id_for(db, match_id)
        for fc in db.query(FirstContact).filter(FirstContact.demo_id == did).all():
            round_ticks[fc.round_num] = fc.tick
    except Exception as e:
        logger.warning(f"Could not load round ticks: {e}")

    pack = {
        "facts": facts,
        "baselines": baselines,
        "pro_examples": pro_examples,
        "flagged_rounds": flagged_rounds,
        "round_ticks": round_ticks,
    }
    logger.info(
        f"[Evidence] match={match_id} facts={len(facts)} baselines={len(baselines)} "
        f"pro_examples={len(pro_examples)} flagged_rounds={flagged_rounds}"
    )
    return pack
