"""
Round-feature extraction v2 (DATA_ARCHITECTURE §4) — pure functions.
=====================================================================
dict/list in, dict out: consumes ParseResult-shaped event dicts (the Go
parser's key names — see services/demo-parser and tests/test_parse_handler.py)
plus derived first contacts, and emits one dict per (round, side) matching
db.models.RoundFeature columns minus id/match_id. No DB imports — persistence
lives in services/worker/parse_handler.

Side assignment mirrors rag_engine/extractor._assign_sides: the kill feed has
no team info, so each round's players are 2-colored via kill edges (attacker
vs victim = opponents) and every component's groups are anchored to T/CT by
which group's earliest observed positions sit closer to the map's T vs CT
spawn (spawn-tagged ZoneBoxes). Callers with real team data can bypass all of
that with the side_of callable.
"""

from collections import defaultdict
import math

from services.tactician.zones import ZoneBox, default_zones_for, resolve_zone

FLASH_ASSIST_MIN_BLIND_S = 0.7
FLASH_ASSIST_WINDOW_S = 1.5  # 96 ticks at 64
TRADE_WINDOW_S = 5.0
EXEC_UTILITY_WINDOW_S = 20.0
SMOKE_WINDOW_S = 10.0
EXEC_SPREAD_NORM_S = 10.0
SIDES = ("T", "CT")


def _group_by_round(events: list[dict]) -> dict[int, list[dict]]:
    """Docstring for _group_by_round."""
    grouped: dict[int, list[dict]] = defaultdict(list)
    for e in events:
        grouped[e.get("round", 0)].append(e)
    return grouped


def _spawn_anchors(
    zones: list[ZoneBox] | None,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """(t_spawn, ct_spawn) box centers from spawn-tagged zones, or None."""
    t_anchor = ct_anchor = None
    for zb in zones or []:
        if zb.tag != "spawn":
            continue
        center = ((zb.min_x + zb.max_x) / 2.0, (zb.min_y + zb.max_y) / 2.0)
        if zb.display_name.upper().startswith("CT"):
            ct_anchor = center
        else:
            t_anchor = center
    if t_anchor is None or ct_anchor is None:
        return None
    return t_anchor, ct_anchor


def _derive_sides(
    round_kills: list[dict],
    t_anchor: tuple[float, float],
    ct_anchor: tuple[float, float],
) -> dict[str, str]:
    """steamid → 'T'|'CT' for one round (see module docstring for the method)."""
    adjacency: dict[str, set[str]] = defaultdict(set)
    first_pos: dict[str, tuple[float, float]] = {}
    for k in sorted(round_kills, key=lambda k: k.get("tick", 0)):
        attacker = k.get("attacker_steam_id") or ""
        victim = k.get("victim_steam_id") or ""
        if attacker and victim and attacker != victim:
            adjacency[attacker].add(victim)
            adjacency[victim].add(attacker)
        if attacker and attacker not in first_pos:
            first_pos[attacker] = (k.get("attacker_x", 0.0), k.get("attacker_y", 0.0))
        if victim and victim not in first_pos:
            first_pos[victim] = (k.get("victim_x", 0.0), k.get("victim_y", 0.0))

    sides: dict[str, str] = {}
    visited: set[str] = set()
    for start in sorted(adjacency):
        if start in visited:
            continue
        color = {start: 0}
        queue = [start]
        while queue:
            node = queue.pop(0)
            for neighbor in sorted(adjacency[node]):
                if neighbor not in color:
                    color[neighbor] = 1 - color[node]
                    queue.append(neighbor)
        visited.update(color)
        groups = ([p for p in color if color[p] == 0], [p for p in color if color[p] == 1])

        def spawn_bias(group: list[str]) -> float:
            # Negative = the group skews toward T spawn.
            return sum(
                math.hypot(first_pos[p][0] - t_anchor[0], first_pos[p][1] - t_anchor[1])
                - math.hypot(first_pos[p][0] - ct_anchor[0], first_pos[p][1] - ct_anchor[1])
                for p in group
            )

        t_group, ct_group = (
            (groups[0], groups[1])
            if spawn_bias(groups[0]) <= spawn_bias(groups[1])
            else (groups[1], groups[0])
        )
        sides.update({p: "T" for p in t_group})
        sides.update({p: "CT" for p in ct_group})
    return sides


def compute_round_features(
    rounds: list[dict],
    kills: list[dict],
    damages: list[dict],
    flashes: list[dict],
    grenades: list[dict],
    first_contacts: list[dict],
    zones_by_map_fn=None,
    *,
    map_name: str = "",
    tickrate: int = 64,
    side_of=None,
) -> list[dict]:
    """
    Per-round, per-side RoundFeature dicts (all columns minus id/match_id).

    - zones_by_map_fn: callable(map_name) → list[ZoneBox]. None means no zone
      resolution: opening_zone and smoke_coverage_score come back None.
    - side_of: callable(steamid, round_num) → 'T'|'CT'|None overriding the
      default kill-graph side derivation. Without it, spawn anchors come from
      the provided zones, falling back to the static DEFAULT_ZONES seed (side
      anchoring is internal bookkeeping, never surfaced text); rounds whose
      sides can't be derived (no kills, or an unseeded map) are skipped.
    """
    zones = list(zones_by_map_fn(map_name)) if zones_by_map_fn is not None else None
    anchors = _spawn_anchors(zones) or _spawn_anchors(default_zones_for(map_name))
    chokes = [zb for zb in zones if zb.tag == "choke"] if zones else []

    kills_by_round = _group_by_round(kills)
    damages_by_round = _group_by_round(damages)
    flashes_by_round = _group_by_round(flashes)
    grenades_by_round = _group_by_round(grenades)
    fc_by_round = {fc.get("round", 0): fc for fc in first_contacts}

    features: list[dict] = []
    for round_event in rounds:
        rn = round_event.get("round_num", 0)
        round_kills = kills_by_round.get(rn, [])

        if side_of is not None:
            def lookup(steamid, _rn=rn):
                return side_of(steamid, _rn) if steamid else None
        else:
            if anchors is None:
                continue  # no spawn anchors → can't tell T from CT: skip, don't guess
            mapping = _derive_sides(round_kills, *anchors)
            if not mapping:
                continue  # no kills to 2-color — nothing side-attributable this round

            def lookup(steamid, _mapping=mapping):
                return _mapping.get(steamid or "")

        fc = fc_by_round.get(rn)
        fc_tick = fc.get("tick", 0) if fc is not None else None
        killer_side = lookup(fc.get("attacker_steam_id")) if fc is not None else None

        # Opening-duel context is a property of the round; won/lost flips per side.
        opening_zone = None
        if fc is not None and zones:
            opening_zone = resolve_zone(
                zones, fc.get("victim_x", 0.0), fc.get("victim_y", 0.0), fc.get("victim_z")
            )
        opening_flash_assist = None
        if fc is not None:
            victim_id = fc.get("victim_steam_id")
            opening_flash_assist = any(
                f.get("blinded_steam_id") == victim_id
                and f.get("blind_duration", 0.0) >= FLASH_ASSIST_MIN_BLIND_S
                and fc_tick - FLASH_ASSIST_WINDOW_S * tickrate <= f.get("tick", 0) <= fc_tick
                and killer_side is not None
                and lookup(f.get("thrower_steam_id")) == killer_side
                for f in flashes_by_round.get(rn, [])
            )

        # Execution sync belongs to the attacking (T) side: 1 − clamp(spread/10)
        # where spread = seconds between the last pre-contact T utility
        # detonation (within 20s of first contact) and the contact itself.
        exec_sync_score = None
        if fc is not None:
            pre_util_ticks = [
                g.get("tick", 0)
                for g in grenades_by_round.get(rn, [])
                if lookup(g.get("thrower_steam_id")) == "T"
                and fc_tick - EXEC_UTILITY_WINDOW_S * tickrate <= g.get("tick", 0) < fc_tick
            ]
            if pre_util_ticks:
                spread_s = (fc_tick - max(pre_util_ticks)) / tickrate
                exec_sync_score = 1.0 - min(max(spread_s / EXEC_SPREAD_NORM_S, 0.0), 1.0)

        for side in SIDES:
            util_damage = sum(
                int(d.get("hp_damage", 0))
                for d in damages_by_round.get(rn, [])
                if d.get("is_utility") and lookup(d.get("attacker_steam_id")) == side
            )

            enemy_blind = team_blind = 0.0
            for f in flashes_by_round.get(rn, []):
                if lookup(f.get("thrower_steam_id")) != side:
                    continue
                if f.get("is_teammate"):
                    team_blind += f.get("blind_duration", 0.0)
                else:
                    enemy_blind += f.get("blind_duration", 0.0)

            # Trade windows: for each of the side's deaths, the earliest revenge
            # kill on the killer within 5s counts as a successful trade.
            deaths = [k for k in round_kills if lookup(k.get("victim_steam_id")) == side]
            windows: list[float] = []
            for death in deaths:
                death_tick = death.get("tick", 0)
                revenge_ticks = [
                    k2.get("tick", 0)
                    for k2 in round_kills
                    if k2.get("victim_steam_id") == death.get("attacker_steam_id")
                    and lookup(k2.get("attacker_steam_id")) == side
                    and death_tick < k2.get("tick", 0) <= death_tick + TRADE_WINDOW_S * tickrate
                ]
                if revenge_ticks:
                    windows.append((min(revenge_ticks) - death_tick) / tickrate)
            trade_success_rate = round(len(windows) / len(deaths), 4) if deaths else None
            avg_trade_window_s = round(sum(windows) / len(windows), 4) if windows else None

            # Smoke coverage: fraction of the map's choke zones holding one of
            # this side's smoke land points in the 10s pre-contact window.
            smoke_coverage_score = None
            if chokes and fc is not None:
                side_smokes = [
                    g
                    for g in grenades_by_round.get(rn, [])
                    if "smoke" in (g.get("grenade_type") or "").lower()
                    and lookup(g.get("thrower_steam_id")) == side
                    and fc_tick - SMOKE_WINDOW_S * tickrate <= g.get("tick", 0) < fc_tick
                ]
                covered = sum(
                    1
                    for c in chokes
                    if any(c.contains_xy(g.get("land_x", 0.0), g.get("land_y", 0.0))
                           for g in side_smokes)
                )
                smoke_coverage_score = round(covered / len(chokes), 4)

            features.append(
                {
                    "round_num": rn,
                    "side_focus": side,
                    "opening_duel_won": (
                        killer_side == side if killer_side is not None else None
                    ),
                    "opening_zone": opening_zone,
                    "opening_flash_assist": opening_flash_assist,
                    "util_damage": util_damage,
                    "enemy_blind_seconds": round(enemy_blind, 4),
                    "team_blind_seconds": round(team_blind, 4),
                    "smoke_coverage_score": smoke_coverage_score,
                    "trade_success_rate": trade_success_rate,
                    "avg_trade_window_s": avg_trade_window_s,
                    "exec_sync_score": exec_sync_score if side == "T" else None,
                    "archetype_label": None,
                }
            )
    return features
