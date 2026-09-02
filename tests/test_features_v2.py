"""
features_v2 tests — hand-built rounds on a fabricated map with exact expected
values for every feature: flash-assisted opening, trade-window math, exec-sync
spread, blind-second sums, and smoke coverage against a fabricated choke zone.
"""

import pytest

from services.tactician.features_v2 import compute_round_features
from services.tactician.zones import ZoneBox

TICKRATE = 64

ZONES = [
    ZoneBox("de_test", "Test_A_Site", "A Site", 300.0, 300.0, 500.0, 500.0, tag="site"),
    ZoneBox("de_test", "Test_A_Main", "A Main", 0.0, 0.0, 200.0, 200.0, tag="choke"),
    ZoneBox("de_test", "Test_B_Main", "B Main", 1000.0, 1000.0, 1200.0, 1200.0, tag="choke"),
    ZoneBox("de_test", "Test_T_Spawn", "T Spawn", -100.0, -1100.0, 100.0, -900.0, tag="spawn"),
    ZoneBox("de_test", "Test_CT_Spawn", "CT Spawn", -100.0, 900.0, 100.0, 1100.0, tag="spawn"),
]


def _zones_fn(_map_name: str) -> list[ZoneBox]:
    """Docstring for _zones_fn."""
    return ZONES


def _side_of(steamid: str, round_num: int) -> str:
    """Fixture steamids encode their side: T* is T, everything else CT."""
    return "T" if steamid and steamid.startswith("T") else "CT"


ROUNDS = [
    {"round_num": 1, "winner_side": "T", "t_money": 20000, "ct_money": 20000},
    {"round_num": 2, "winner_side": "CT", "t_money": 4000, "ct_money": 20000},
]

KILLS = [
    # First contact: T1 opens onto C1 inside Test_A_Site.
    {"round": 1, "tick": 6400, "attacker_steam_id": "T1", "victim_steam_id": "C1",
     "attacker_x": 350.0, "attacker_y": 350.0, "victim_x": 400.0, "victim_y": 400.0},
    # C2 refrags T1 ...
    {"round": 1, "tick": 6600, "attacker_steam_id": "C2", "victim_steam_id": "T1",
     "attacker_x": 450.0, "attacker_y": 450.0, "victim_x": 420.0, "victim_y": 420.0},
    # ... and T2 trades C2 exactly 200 ticks (3.125s) later.
    {"round": 1, "tick": 6800, "attacker_steam_id": "T2", "victim_steam_id": "C2",
     "attacker_x": 380.0, "attacker_y": 380.0, "victim_x": 455.0, "victim_y": 455.0},
]

FIRST_CONTACTS = [KILLS[0]]  # round 2 has no kills, hence no first contact

DAMAGES = [
    {"round": 1, "tick": 6100, "attacker_steam_id": "T1", "victim_steam_id": "C1",
     "weapon": "HE Grenade", "hp_damage": 40, "is_utility": True},
    {"round": 1, "tick": 6200, "attacker_steam_id": "T1", "victim_steam_id": "C2",
     "weapon": "Molotov", "hp_damage": 15, "is_utility": True},
    {"round": 1, "tick": 6390, "attacker_steam_id": "T1", "victim_steam_id": "C1",
     "weapon": "ak47", "hp_damage": 30, "is_utility": False},  # must NOT count
    {"round": 1, "tick": 6300, "attacker_steam_id": "C1", "victim_steam_id": "T2",
     "weapon": "HE Grenade", "hp_damage": 30, "is_utility": True},
    {"round": 2, "tick": 800, "attacker_steam_id": "C1", "victim_steam_id": "T1",
     "weapon": "Molotov", "hp_damage": 25, "is_utility": True},
]

FLASHES = [
    # Assist flash: blinds the opening victim 1.2s, 50 ticks pre-kill, T-thrown.
    {"round": 1, "tick": 6350, "thrower_steam_id": "T2", "blinded_steam_id": "C1",
     "blind_duration": 1.2, "is_teammate": False},
    {"round": 1, "tick": 6350, "thrower_steam_id": "T2", "blinded_steam_id": "T1",
     "blind_duration": 0.8, "is_teammate": True},
    {"round": 1, "tick": 7000, "thrower_steam_id": "C2", "blinded_steam_id": "T2",
     "blind_duration": 2.0, "is_teammate": False},
    {"round": 2, "tick": 700, "thrower_steam_id": "C1", "blinded_steam_id": "T1",
     "blind_duration": 1.5, "is_teammate": False},
]

GRENADES = [
    # T smoke landing inside the Test_A_Main choke, 320 ticks (5s) pre-contact:
    # exec-sync spread 5s → score 0.5; covers 1 of 2 chokes → coverage 0.5.
    {"round": 1, "tick": 6080, "thrower_steam_id": "T1", "grenade_type": "smokeGrenade",
     "land_x": 100.0, "land_y": 100.0},
]


def _rows():
    """Docstring for _rows."""
    feats = compute_round_features(
        ROUNDS, KILLS, DAMAGES, FLASHES, GRENADES, FIRST_CONTACTS,
        zones_by_map_fn=_zones_fn, map_name="de_test", tickrate=TICKRATE, side_of=_side_of,
    )
    return {(f["round_num"], f["side_focus"]): f for f in feats}


def test_emits_one_row_per_round_per_side():
    """Docstring for test_emits_one_row_per_round_per_side."""
    assert set(_rows()) == {(1, "T"), (1, "CT"), (2, "T"), (2, "CT")}


def test_opening_duel_with_flash_assist():
    """T won the opening in Test_A_Site behind a qualifying flash."""
    rows = _rows()
    assert rows[(1, "T")]["opening_duel_won"] is True
    assert rows[(1, "CT")]["opening_duel_won"] is False
    for side in ("T", "CT"):
        assert rows[(1, side)]["opening_zone"] == "Test_A_Site"
        assert rows[(1, side)]["opening_flash_assist"] is True


def test_flash_assist_rejects_weak_early_or_wrong_side_flashes():
    """<0.7s blind, >1.5s early, or a CT-thrown flash never assist a T entry."""
    bad_flashes = [
        {"round": 1, "tick": 6350, "thrower_steam_id": "T2", "blinded_steam_id": "C1",
         "blind_duration": 0.5, "is_teammate": False},  # too weak
        {"round": 1, "tick": 6300, "thrower_steam_id": "T2", "blinded_steam_id": "C1",
         "blind_duration": 1.0, "is_teammate": False},  # 100 ticks > 96-tick window
        {"round": 1, "tick": 6350, "thrower_steam_id": "C2", "blinded_steam_id": "C1",
         "blind_duration": 1.0, "is_teammate": True},  # killer's opponents' flash
    ]
    feats = compute_round_features(
        ROUNDS[:1], KILLS, DAMAGES, bad_flashes, GRENADES, FIRST_CONTACTS,
        zones_by_map_fn=_zones_fn, map_name="de_test", tickrate=TICKRATE, side_of=_side_of,
    )
    assert all(f["opening_flash_assist"] is False for f in feats)


def test_util_damage_sums_only_utility():
    """Docstring for test_util_damage_sums_only_utility."""
    rows = _rows()
    assert rows[(1, "T")]["util_damage"] == 55  # 40 HE + 15 molly, ak47 30 excluded
    assert rows[(1, "CT")]["util_damage"] == 30
    assert rows[(2, "CT")]["util_damage"] == 25
    assert rows[(2, "T")]["util_damage"] == 0


def test_blind_seconds_split_by_teammate_flag():
    """Docstring for test_blind_seconds_split_by_teammate_flag."""
    rows = _rows()
    assert rows[(1, "T")]["enemy_blind_seconds"] == pytest.approx(1.2)
    assert rows[(1, "T")]["team_blind_seconds"] == pytest.approx(0.8)
    assert rows[(1, "CT")]["enemy_blind_seconds"] == pytest.approx(2.0)
    assert rows[(1, "CT")]["team_blind_seconds"] == 0.0
    assert rows[(2, "CT")]["enemy_blind_seconds"] == pytest.approx(1.5)


def test_trade_window_math():
    """T1's death traded in exactly 3.125s; C1's traded, C2's not."""
    rows = _rows()
    assert rows[(1, "T")]["trade_success_rate"] == 1.0
    assert rows[(1, "T")]["avg_trade_window_s"] == pytest.approx(3.125)
    assert rows[(1, "CT")]["trade_success_rate"] == 0.5  # C1 traded by C2, C2 not
    assert rows[(1, "CT")]["avg_trade_window_s"] == pytest.approx(3.125)
    # No deaths in round 2 → both None, not 0.
    assert rows[(2, "T")]["trade_success_rate"] is None
    assert rows[(2, "T")]["avg_trade_window_s"] is None


def test_exec_sync_score_from_utility_spread():
    """Last T utility 5s pre-contact → 1 − 5/10 = 0.5; CT rows always None."""
    rows = _rows()
    assert rows[(1, "T")]["exec_sync_score"] == pytest.approx(0.5)
    assert rows[(1, "CT")]["exec_sync_score"] is None
    assert rows[(2, "T")]["exec_sync_score"] is None  # no first contact


def test_exec_sync_none_without_precontact_utility():
    """Docstring for test_exec_sync_none_without_precontact_utility."""
    feats = compute_round_features(
        ROUNDS[:1], KILLS, [], [], [], FIRST_CONTACTS,
        zones_by_map_fn=_zones_fn, map_name="de_test", tickrate=TICKRATE, side_of=_side_of,
    )
    assert all(f["exec_sync_score"] is None for f in feats)


def test_smoke_coverage_against_choke_zones():
    """One T smoke in one of two chokes pre-contact → 0.5; CT smoked nothing."""
    rows = _rows()
    assert rows[(1, "T")]["smoke_coverage_score"] == pytest.approx(0.5)
    assert rows[(1, "CT")]["smoke_coverage_score"] == 0.0
    assert rows[(2, "T")]["smoke_coverage_score"] is None  # no first contact


def test_zone_features_none_without_zones():
    """No zones → opening_zone and smoke coverage None, everything else intact."""
    feats = compute_round_features(
        ROUNDS, KILLS, DAMAGES, FLASHES, GRENADES, FIRST_CONTACTS,
        map_name="de_test", tickrate=TICKRATE, side_of=_side_of,
    )
    rows = {(f["round_num"], f["side_focus"]): f for f in feats}
    assert rows[(1, "T")]["opening_zone"] is None
    assert rows[(1, "T")]["smoke_coverage_score"] is None
    assert rows[(1, "T")]["opening_duel_won"] is True
    assert rows[(1, "T")]["util_damage"] == 55


def test_default_side_derivation_uses_spawn_anchors():
    """Without side_of, kill-graph 2-coloring anchored on spawn boxes works."""
    kills = [
        {"round": 1, "tick": 100, "attacker_steam_id": "P1", "victim_steam_id": "P2",
         "attacker_x": 0.0, "attacker_y": -950.0,  # on top of T spawn
         "victim_x": 0.0, "victim_y": 950.0},  # on top of CT spawn
    ]
    feats = compute_round_features(
        [{"round_num": 1, "winner_side": "T"}], kills, [], [], [], [kills[0]],
        zones_by_map_fn=_zones_fn, map_name="de_test", tickrate=TICKRATE,
    )
    rows = {f["side_focus"]: f for f in feats}
    assert rows["T"]["opening_duel_won"] is True
    assert rows["CT"]["opening_duel_won"] is False


def test_unanchorable_rounds_are_skipped():
    """Unknown map, no zones, no side_of → no rows rather than guessed sides."""
    assert compute_round_features(
        ROUNDS, KILLS, DAMAGES, FLASHES, GRENADES, FIRST_CONTACTS, map_name="de_nowhere",
    ) == []
