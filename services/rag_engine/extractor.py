"""
Strat/meta extractor — pure functions over ParseResult telemetry.
==================================================================
Consumes the Go parser's ParseResult JSON (rounds/kills/grenades keys as in
services/demo-parser/parser/events.go) and produces round archetypes with
deterministic heuristic labels plus per-archetype metrics. No I/O, no DB.

Heuristics (all deterministic):
  - Side assignment: the kill feed carries no team info, so players are
    2-colored per round (attacker vs victim = opponents) and each component's
    color groups are anchored to T/CT by which group's earliest observed
    positions sit closer to the map's T spawn vs CT spawn.
  - Zone (site) inference: first-contact midpoint classified against a small
    per-map zone-bounds table (mirage/inferno/nuke/anubis). Nuke's A/B stack
    vertically and the kill feed has no z, so its xy split is approximate.
  - Round type: T side is "execute" when >= EXECUTE_MIN_NADES support nades
    land before first contact in one zone, "split" when they spread across
    zones, else "default". CT side is always "hold".
  - Buy type: from the round's per-side money fields (pistol on rounds 1/13).
  - post_plant_success_rate is a proxy — ParseResult has no plant events, so
    "post-plant" means "first contact happened inside a bomb site zone".
"""

from collections import defaultdict
from dataclasses import dataclass
import math

from services.tactician.zones import ZoneBox, default_zones_for

TRADE_WINDOW_SECONDS = 5.0
TRADE_RADIUS_UNITS = 600.0
UTILITY_WINDOW_SECONDS = 20.0
EXECUTE_MIN_NADES = 3
PISTOL_ROUNDS = (1, 13)
BOMB_SITE_ZONES = ("A", "B")

# Maps this extractor labels. Other maps carry zone seeds too (tactician/zones
# adds dust2/ancient/vertigo), but the archetype labels are only validated for
# these four — an unlisted map yields no archetypes rather than unreviewed ones.
_GEOMETRY_MAPS = ("de_mirage", "de_inferno", "de_nuke", "de_anubis")


def _legacy_zone_name(zone: ZoneBox) -> str:
    """'A Site' → 'A' for site boxes, otherwise the lowercased display name —
    preserves the short zone names the pinned archetype labels are built from."""
    if zone.tag == "site":
        return zone.display_name.split()[0]
    return zone.display_name.lower()


def _build_geometry() -> dict[str, dict]:
    """
    MAP_GEOMETRY rebuilt from the canonical zone seed (tactician/zones is the
    single source of truth for coordinates): spawn-tagged boxes provide the
    T/CT anchor points (box center == the historical anchor), everything else
    becomes the (min_x, min_y, max_x, max_y) zone-bounds table.
    """
    geometry: dict[str, dict] = {}
    for map_name in _GEOMETRY_MAPS:
        anchors: dict[str, tuple[float, float]] = {}
        zones: dict[str, tuple[float, float, float, float]] = {}
        for zb in default_zones_for(map_name):
            if zb.tag == "spawn":
                key = "ct_spawn" if zb.display_name.upper().startswith("CT") else "t_spawn"
                anchors[key] = ((zb.min_x + zb.max_x) / 2.0, (zb.min_y + zb.max_y) / 2.0)
            else:
                zones[_legacy_zone_name(zb)] = (zb.min_x, zb.min_y, zb.max_x, zb.max_y)
        geometry[map_name] = {**anchors, "zones": zones}
    return geometry


# Per-map anchor points and zone bounds, derived from services/tactician/zones.
MAP_GEOMETRY: dict[str, dict] = _build_geometry()


@dataclass(frozen=True)
class RoundExtract:
    """One side's view of one round — the unit that gets grouped into archetypes."""

    round_num: int
    side: str  # 'T' | 'CT'
    zone: str
    buy_type: str
    vs_buy_type: str
    round_type: str  # execute | split | default | hold
    winner: str
    metrics: dict


@dataclass(frozen=True)
class ArchetypeDraft:
    """A labeled group of same-shaped rounds plus its aggregated metrics."""

    label: str
    map_name: str
    side: str
    zone: str
    buy_type: str
    round_type: str
    round_nums: tuple[int, ...]
    rounds: tuple[RoundExtract, ...]
    metrics: dict


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Docstring for _dist."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _classify_zone(point: tuple[float, float], geometry: dict) -> str:
    """Zone containing the point, else the zone with the nearest box center."""
    for name, (min_x, min_y, max_x, max_y) in geometry["zones"].items():
        if min_x <= point[0] <= max_x and min_y <= point[1] <= max_y:
            return name
    return min(
        geometry["zones"].items(),
        key=lambda item: _dist(
            point, ((item[1][0] + item[1][2]) / 2.0, (item[1][1] + item[1][3]) / 2.0)
        ),
    )[0]


def _assign_sides(round_kills: list[dict], geometry: dict) -> dict[str, str]:
    """
    2-color the round's players via kill edges (attacker vs victim = opponents),
    then anchor each component's groups to T/CT by summed spawn-distance bias
    of the members' earliest observed positions.
    """
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

    t_spawn, ct_spawn = geometry["t_spawn"], geometry["ct_spawn"]
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
            return sum(_dist(first_pos[p], t_spawn) - _dist(first_pos[p], ct_spawn) for p in group)

        t_group, ct_group = (
            (groups[0], groups[1])
            if spawn_bias(groups[0]) <= spawn_bias(groups[1])
            else (groups[1], groups[0])
        )
        sides.update({p: "T" for p in t_group})
        sides.update({p: "CT" for p in ct_group})
    return sides


def _buy_type(round_num: int, money: int) -> str:
    """Docstring for _buy_type."""
    if round_num in PISTOL_ROUNDS:
        return "pistol"
    if money < 8000:
        return "eco"
    if money < 20000:
        return "force"
    return "full"


def _smoke_count(nades: list[dict]) -> int:
    """Docstring for _smoke_count."""
    return sum(1 for g in nades if "smoke" in (g.get("grenade_type") or "").lower())


def _t_round_type(support_nades: list[dict], fc_zone: str, geometry: dict) -> str:
    """execute / split / default from nade volume and landing-zone spread."""
    if len(support_nades) < EXECUTE_MIN_NADES:
        return "default"
    zones = {
        _classify_zone((g.get("land_x", 0.0), g.get("land_y", 0.0)), geometry)
        for g in support_nades
    }
    return "split" if len(zones | {fc_zone}) > 1 else "execute"


def _trade_stats(
    round_kills: list[dict], sides: dict[str, str], side: str, tickrate: int
) -> tuple[int, int]:
    """
    (traded_deaths, deaths) for `side`: a death is traded when a teammate kills
    the killer within TRADE_WINDOW_SECONDS and TRADE_RADIUS_UNITS of the death.
    """
    window_ticks = TRADE_WINDOW_SECONDS * tickrate
    deaths = [k for k in round_kills if sides.get(k.get("victim_steam_id") or "") == side]
    traded = 0
    for death in deaths:
        death_pos = (death.get("victim_x", 0.0), death.get("victim_y", 0.0))
        for k2 in round_kills:
            if (
                k2.get("victim_steam_id") == death.get("attacker_steam_id")
                and sides.get(k2.get("attacker_steam_id") or "") == side
                and death.get("tick", 0) < k2.get("tick", 0) <= death.get("tick", 0) + window_ticks
                and _dist((k2.get("victim_x", 0.0), k2.get("victim_y", 0.0)), death_pos)
                <= TRADE_RADIUS_UNITS
            ):
                traded += 1
                break
    return traded, len(deaths)


def _extract_round(
    round_event: dict,
    round_kills: list[dict],
    round_nades: list[dict],
    geometry: dict,
    tickrate: int,
) -> list[RoundExtract]:
    """Both sides' RoundExtracts for one round (empty if there were no kills)."""
    if not round_kills:
        return []
    round_num = round_event.get("round_num", 0)
    winner = round_event.get("winner_side") or ""
    sides = _assign_sides(round_kills, geometry)

    first_contact = min(round_kills, key=lambda k: k.get("tick", 0))
    fc_tick = first_contact.get("tick", 0)
    fc_point = (
        (first_contact.get("attacker_x", 0.0) + first_contact.get("victim_x", 0.0)) / 2.0,
        (first_contact.get("attacker_y", 0.0) + first_contact.get("victim_y", 0.0)) / 2.0,
    )
    fc_zone = _classify_zone(fc_point, geometry)

    buys = {
        "T": _buy_type(round_num, round_event.get("t_money", 0)),
        "CT": _buy_type(round_num, round_event.get("ct_money", 0)),
    }

    extracts: list[RoundExtract] = []
    for side in ("T", "CT"):
        if not any(s == side for s in sides.values()):
            continue
        support_nades = [
            g
            for g in round_nades
            if sides.get(g.get("thrower_steam_id") or "") == side
            and fc_tick - UTILITY_WINDOW_SECONDS * tickrate <= g.get("tick", 0) < fc_tick
        ]
        round_type = "hold" if side == "CT" else _t_round_type(support_nades, fc_zone, geometry)
        traded, deaths = _trade_stats(round_kills, sides, side, tickrate)
        utility_leads = [(fc_tick - g.get("tick", 0)) / tickrate for g in support_nades]
        extracts.append(
            RoundExtract(
                round_num=round_num,
                side=side,
                zone=fc_zone,
                buy_type=buys[side],
                vs_buy_type=buys["CT" if side == "T" else "T"],
                round_type=round_type,
                winner=winner,
                metrics={
                    "won": winner == side,
                    "first_contact": {"x": round(fc_point[0], 1), "y": round(fc_point[1], 1)},
                    "utility_leads_seconds": [round(lead, 4) for lead in utility_leads],
                    "smokes": _smoke_count(support_nades),
                    "traded_deaths": traded,
                    "deaths": deaths,
                },
            )
        )
    return extracts


def _map_title(map_name: str) -> str:
    """Docstring for _map_title."""
    return map_name.removeprefix("de_").title()


def _label(map_name: str, side: str, zone: str, round_type: str, extras: dict) -> str:
    """Docstring for _label."""
    map_title, zone_title = _map_title(map_name), zone.title()
    if side == "CT":
        return f"{map_title} {zone_title} Hold vs {extras['vs_buy_type'].title()} Push"
    if round_type == "execute":
        label = f"{map_title} {zone_title}-Execute"
        if extras["avg_smokes"] >= 1:
            label += f" with {extras['avg_smokes']} Smokes"
        return label
    if round_type == "split":
        return f"{map_title} {zone_title}-Split"
    return f"{map_title} Default into {zone_title}"


def extract_archetypes(parse_result: dict, pro_match=None) -> list[ArchetypeDraft]:
    """
    Group each round's per-side extract by (side, zone, round_type, own buy,
    opponent buy) and aggregate the group's metrics into one ArchetypeDraft.
    """
    map_name = (
        parse_result.get("map_name")
        or (getattr(pro_match, "map_name", None) if pro_match else None)
        or "unknown"
    )
    geometry = MAP_GEOMETRY.get(map_name)
    if geometry is None:
        return []  # no zone table for this map — nothing to label
    tickrate = int(parse_result.get("tickrate") or 64)

    kills_by_round: dict[int, list[dict]] = defaultdict(list)
    for k in parse_result.get("kills") or []:
        kills_by_round[k.get("round", 0)].append(k)
    nades_by_round: dict[int, list[dict]] = defaultdict(list)
    for g in parse_result.get("grenades") or []:
        nades_by_round[g.get("round", 0)].append(g)

    extracts: list[RoundExtract] = []
    for round_event in parse_result.get("rounds") or []:
        round_num = round_event.get("round_num", 0)
        extracts.extend(
            _extract_round(
                round_event,
                kills_by_round.get(round_num, []),
                nades_by_round.get(round_num, []),
                geometry,
                tickrate,
            )
        )

    groups: dict[tuple, list[RoundExtract]] = defaultdict(list)
    for extract in extracts:
        groups[
            (extract.side, extract.zone, extract.round_type, extract.buy_type, extract.vs_buy_type)
        ].append(extract)

    drafts: list[ArchetypeDraft] = []
    for (side, zone, round_type, buy_type, vs_buy_type), group in sorted(groups.items()):
        n = len(group)
        wins = sum(1 for e in group if e.metrics["won"])
        leads = [lead for e in group for lead in e.metrics["utility_leads_seconds"]]
        traded = sum(e.metrics["traded_deaths"] for e in group)
        deaths = sum(e.metrics["deaths"] for e in group)
        site_rounds = n if zone in BOMB_SITE_ZONES else 0
        avg_smokes = round(sum(e.metrics["smokes"] for e in group) / n)
        metrics = {
            "rounds_observed": n,
            "round_nums": sorted(e.round_num for e in group),
            "round_win_rate": round(wins / n, 4),
            "avg_utility_lead_seconds": round(sum(leads) / len(leads), 4) if leads else 0.0,
            "first_contact_centroid": {
                "x": round(sum(e.metrics["first_contact"]["x"] for e in group) / n, 1),
                "y": round(sum(e.metrics["first_contact"]["y"] for e in group) / n, 1),
            },
            "trade_success_rate": round(traded / deaths, 4) if deaths else 0.0,
            "trade_opportunities": deaths,
            # Proxy: no plant events in ParseResult — "post-plant" = first
            # contact landed inside a bomb site zone.
            "post_plant_success_rate": round(wins / site_rounds, 4) if site_rounds else 0.0,
            "site_rounds": site_rounds,
            "vs_buy_type": vs_buy_type,
            "avg_smokes": avg_smokes,
        }
        drafts.append(
            ArchetypeDraft(
                label=_label(
                    map_name,
                    side,
                    zone,
                    round_type,
                    {"vs_buy_type": vs_buy_type, "avg_smokes": avg_smokes},
                ),
                map_name=map_name,
                side=side,
                zone=zone,
                buy_type=buy_type,
                round_type=round_type,
                round_nums=tuple(sorted(e.round_num for e in group)),
                rounds=tuple(sorted(group, key=lambda e: e.round_num)),
                metrics=metrics,
            )
        )
    return drafts
