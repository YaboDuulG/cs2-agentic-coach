"""
Extractor tests — synthetic ParseResult fixture with hand-computed expected
values for archetype labels, utility lead times, trade math, and the
post-plant proxy. Everything here is exact, no approx unless division forces it.
"""

import os

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from services.rag_engine.extractor import ArchetypeDraft, extract_archetypes

TICKRATE = 64


def _execute_round(round_num: int, winner: str) -> tuple[dict, list[dict], list[dict]]:
    """One T-side A-execute: 3 support nades, entry kill, one traded T death."""
    round_event = {
        "round_num": round_num,
        "winner_side": winner,
        "t_money": 22000,
        "ct_money": 21000,
        "round_type": "full",
    }
    kills = [
        # Entry: T1 opens onto A. T positions skew toward T spawn, CT toward CT.
        {
            "round": round_num, "tick": 6400,
            "attacker_steam_id": "T1", "victim_steam_id": "C1", "weapon": "ak47",
            "attacker_x": -200.0, "attacker_y": -1700.0,
            "victim_x": -900.0, "victim_y": -2200.0,
        },
        # C2 refrags T2 ...
        {
            "round": round_num, "tick": 6500,
            "attacker_steam_id": "C2", "victim_steam_id": "T2", "weapon": "m4a1",
            "attacker_x": -950.0, "attacker_y": -2250.0,
            "victim_x": -250.0, "victim_y": -1750.0,
        },
        # ... and T3 trades C2 3.125s later, 212 units from T2's death.
        {
            "round": round_num, "tick": 6700,
            "attacker_steam_id": "T3", "victim_steam_id": "C2", "weapon": "ak47",
            "attacker_x": -300.0, "attacker_y": -1800.0,
            "victim_x": -400.0, "victim_y": -1900.0,
        },
    ]
    grenades = [
        {"round": round_num, "tick": 6000, "thrower_steam_id": "T1",
         "grenade_type": "smokeGrenade", "land_x": -500.0, "land_y": -2000.0},
        {"round": round_num, "tick": 6100, "thrower_steam_id": "T2",
         "grenade_type": "smokeGrenade", "land_x": -600.0, "land_y": -2100.0},
        {"round": round_num, "tick": 6200, "thrower_steam_id": "T3",
         "grenade_type": "flashbang", "land_x": -550.0, "land_y": -1900.0},
    ]
    return round_event, kills, grenades


def _eco_default_round() -> tuple[dict, list[dict], list[dict]]:
    """T eco with a lone mid pick: one flash, first contact in mid, CT wins."""
    round_event = {
        "round_num": 2,
        "winner_side": "CT",
        "t_money": 2500,
        "ct_money": 21000,
        "round_type": "eco",
    }
    kills = [
        {
            "round": 2, "tick": 5400,
            "attacker_steam_id": "T1", "victim_steam_id": "C1", "weapon": "glock",
            "attacker_x": -300.0, "attacker_y": -500.0,
            "victim_x": -700.0, "victim_y": -700.0,
        },
    ]
    grenades = [
        {"round": 2, "tick": 5000, "thrower_steam_id": "T1",
         "grenade_type": "flashbang", "land_x": -500.0, "land_y": -550.0},
    ]
    return round_event, kills, grenades


def make_parse_result() -> dict:
    """Synthetic mirage ParseResult: eco default (r2) + two A-executes (r5, r7)."""
    r2, k2, g2 = _eco_default_round()
    r5, k5, g5 = _execute_round(5, winner="T")
    r7, k7, g7 = _execute_round(7, winner="CT")
    return {
        "match_id": "2371001",
        "map_name": "de_mirage",
        "tickrate": TICKRATE,
        "rounds": [r2, r5, r7],
        "kills": k2 + k5 + k7,
        "grenades": g2 + g5 + g7,
        "positions": [],
    }


def _by_label(drafts: list[ArchetypeDraft]) -> dict[str, ArchetypeDraft]:
    """Docstring for _by_label."""
    return {d.label: d for d in drafts}


def test_archetype_labels():
    """Both sides of all three rounds resolve to four labeled archetypes."""
    drafts = extract_archetypes(make_parse_result())
    assert set(_by_label(drafts)) == {
        "Mirage A-Execute with 2 Smokes",
        "Mirage A Hold vs Full Push",
        "Mirage Default into Mid",
        "Mirage Mid Hold vs Eco Push",
    }


def test_execute_archetype_metrics_exact():
    """Docstring for test_execute_archetype_metrics_exact."""
    draft = _by_label(extract_archetypes(make_parse_result()))["Mirage A-Execute with 2 Smokes"]

    assert draft.side == "T"
    assert draft.zone == "A"
    assert draft.buy_type == "full"
    assert draft.round_type == "execute"
    assert draft.round_nums == (5, 7)

    m = draft.metrics
    assert m["rounds_observed"] == 2
    # Leads per round: (6400-6000)/64, (6400-6100)/64, (6400-6200)/64
    # = 6.25, 4.6875, 3.125 → mean 4.6875 across both identical rounds.
    assert m["avg_utility_lead_seconds"] == 4.6875
    # First contact midpoint of ((-200,-1700), (-900,-2200)) both rounds.
    assert m["first_contact_centroid"] == {"x": -550.0, "y": -1950.0}
    # T2's death is traded by T3 within 200 ticks (3.125s) and 212 units, both rounds.
    assert m["trade_success_rate"] == 1.0
    assert m["trade_opportunities"] == 2
    # Site reached both rounds (zone A); T won only round 5.
    assert m["post_plant_success_rate"] == 0.5
    assert m["site_rounds"] == 2
    assert m["round_win_rate"] == 0.5
    assert m["vs_buy_type"] == "full"


def test_ct_hold_trade_math():
    """CT loses C1 and C2 untraded in both execute rounds: 0/4."""
    draft = _by_label(extract_archetypes(make_parse_result()))["Mirage A Hold vs Full Push"]
    assert draft.side == "CT"
    assert draft.round_type == "hold"
    assert draft.buy_type == "full"
    assert draft.metrics["trade_success_rate"] == 0.0
    assert draft.metrics["trade_opportunities"] == 4
    assert draft.metrics["round_win_rate"] == 0.5  # CT won round 7 only
    # No CT support utility was thrown before first contact.
    assert draft.metrics["avg_utility_lead_seconds"] == 0.0


def test_eco_default_round():
    """One nade < execute threshold → default; eco buy from money; mid zone."""
    draft = _by_label(extract_archetypes(make_parse_result()))["Mirage Default into Mid"]
    assert draft.side == "T"
    assert draft.zone == "mid"
    assert draft.buy_type == "eco"
    assert draft.round_type == "default"
    assert draft.metrics["avg_utility_lead_seconds"] == 6.25  # (5400-5000)/64
    assert draft.metrics["round_win_rate"] == 0.0
    # Mid is not a bomb site → the post-plant proxy has no denominator.
    assert draft.metrics["site_rounds"] == 0
    assert draft.metrics["post_plant_success_rate"] == 0.0


def test_ct_mid_hold_vs_eco():
    """Docstring for test_ct_mid_hold_vs_eco."""
    draft = _by_label(extract_archetypes(make_parse_result()))["Mirage Mid Hold vs Eco Push"]
    assert draft.metrics["vs_buy_type"] == "eco"
    assert draft.metrics["round_win_rate"] == 1.0
    assert draft.metrics["trade_success_rate"] == 0.0  # C1 died untraded
    assert draft.metrics["trade_opportunities"] == 1


def test_unknown_map_yields_nothing():
    """No zone-bounds table → no labels rather than garbage labels."""
    parse_result = make_parse_result()
    parse_result["map_name"] = "de_vertigo"
    assert extract_archetypes(parse_result) == []


def test_deterministic():
    """Docstring for test_deterministic."""
    first = extract_archetypes(make_parse_result())
    second = extract_archetypes(make_parse_result())
    assert [d.label for d in first] == [d.label for d in second]
    assert [d.metrics for d in first] == [d.metrics for d in second]
