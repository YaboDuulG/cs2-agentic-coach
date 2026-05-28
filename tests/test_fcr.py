"""
Tests for the Tactician FCR (First Contact Resolution) analysis engine.
"""

from services.tactician.fcr import FcrAnalysis, analyze_fcr, fcr_to_dict

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_match(rounds: list[dict], first_contacts: list[dict]) -> dict:
    """Build a minimal parsed match dict for testing FCR."""
    return {
        "metadata": {
            "match_id": "test-match",
            "map": "de_dust2",
            "total_rounds": len(rounds),
        },
        "rounds": rounds,
        "first_contacts": first_contacts,
        "kills": [],
        "grenades": [],
    }


def _round(num: int, winner: str) -> dict:
    return {
        "round_num": num,
        "winner_side": winner,
        "reason": "t_killed",
        "ct_eq_val": 10000,
        "t_eq_val": 10000,
        "ct_score": 0,
        "t_score": 0,
    }


def _fc(round_num: int, attacker: str, team: str, victim: str) -> dict:
    return {
        "round_num": round_num,
        "tick": 1000,
        "attacker": attacker,
        "attacker_team": team,
        "victim": victim,
        "weapon": "ak47",
        "headshot": False,
        "attacker_steamid": None,
        "victim_steamid": None,
        "attacker_x": 0.0,
        "attacker_y": 0.0,
        "victim_x": 100.0,
        "victim_y": 100.0,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fcr_basic_structure():
    """analyze_fcr returns an FcrAnalysis with correct structure."""
    match = _make_match(
        rounds=[_round(1, "CT"), _round(2, "T")],
        first_contacts=[_fc(1, "player_a", "CT", "player_b"), _fc(2, "player_b", "T", "player_a")],
    )
    result = analyze_fcr(match)
    assert isinstance(result, FcrAnalysis)
    assert result.match_id == "test-match"
    assert result.map_name == "de_dust2"
    assert result.total_rounds == 2
    assert len(result.rounds) == 2


def test_fcr_match_rate_perfect():
    """When FCR winner always matches round winner, match_rate == 1.0."""
    rounds = [_round(i, "CT") for i in range(1, 11)]
    fcs = [_fc(i, "ct_player", "CT", "t_player") for i in range(1, 11)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    assert result.fcr_match_rate == 1.0
    assert result.ct_fcr_wins == 10
    assert result.t_fcr_wins == 0


def test_fcr_match_rate_zero():
    """When FCR winner never matches round winner, match_rate == 0.0."""
    rounds = [_round(i, "CT") for i in range(1, 6)]
    # T-side gets all first kills but CT wins all rounds
    fcs = [_fc(i, "t_player", "T", "ct_player") for i in range(1, 6)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    assert result.fcr_match_rate == 0.0
    assert result.t_fcr_wins == 5


def test_player_stats_first_kills():
    """Player who gets all first kills accumulates correct first_kills count."""
    rounds = [_round(i, "CT") for i in range(1, 6)]
    fcs = [_fc(i, "ace", "CT", "victim") for i in range(1, 6)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    assert "ace" in result.player_stats
    ps = result.player_stats["ace"]
    assert ps.first_kills == 5
    assert ps.first_deaths == 0
    assert ps.first_kill_rate == 1.0


def test_player_stats_first_deaths():
    """Player who always dies first accumulates correct first_deaths."""
    rounds = [_round(i, "T") for i in range(1, 4)]
    fcs = [_fc(i, "killer", "T", "always_dies") for i in range(1, 4)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    assert "always_dies" in result.player_stats
    ps = result.player_stats["always_dies"]
    assert ps.first_deaths == 3
    assert ps.first_kills == 0
    assert ps.first_kill_rate == 0.0


def test_critical_flag_generated_for_repeated_first_deaths():
    """A player dying first in 5+ rounds gets a critical coaching flag."""
    rounds = [_round(i, "CT") for i in range(1, 8)]
    fcs = [_fc(i, "killer", "CT", "poor_player") for i in range(1, 8)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    player_flags = [f for f in result.flags if f.get("player") == "poor_player"]
    assert len(player_flags) >= 1
    assert player_flags[0]["severity"] in ("critical", "warning")


def test_positive_flag_for_strong_entry_fragger():
    """A player with 5+ first kills and 65%+ conversion gets a positive flag."""
    # 6 rounds: player gets first kill, team wins 5 of them
    rounds = [_round(i, "CT") for i in range(1, 7)]
    fcs = [_fc(i, "fragger", "CT", "victim") for i in range(1, 7)]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match)
    pos_flags = [
        f for f in result.flags if f["severity"] == "positive" and f.get("player") == "fragger"
    ]
    assert len(pos_flags) >= 1


def test_fcr_to_dict_is_json_serialisable():
    """fcr_to_dict output can be serialised to JSON without error."""
    import json

    match = _make_match(
        rounds=[_round(1, "CT"), _round(2, "T"), _round(3, "CT")],
        first_contacts=[
            _fc(1, "p1", "CT", "p2"),
            _fc(2, "p2", "T", "p1"),
            _fc(3, "p1", "CT", "p3"),
        ],
    )
    result = analyze_fcr(match)
    d = fcr_to_dict(result)
    # Should not raise
    serialised = json.dumps(d)
    assert "match_id" in serialised
    assert "fcr_match_rate" in serialised


def test_empty_first_contacts():
    """analyze_fcr handles a match with no first_contacts gracefully."""
    match = _make_match(
        rounds=[_round(i, "CT") for i in range(1, 5)],
        first_contacts=[],
    )
    result = analyze_fcr(match)
    assert result.fcr_match_rate == 0.0
    assert result.rounds == []
    assert result.player_stats == {}


def test_our_players_team_classification():
    """With our_players set, our_team_won is correctly classified."""
    rounds = [_round(1, "CT"), _round(2, "T")]
    fcs = [_fc(1, "us", "CT", "them"), _fc(2, "them", "T", "us")]
    match = _make_match(rounds, fcs)
    result = analyze_fcr(match, our_players={"us"})
    assert result.rounds[0].our_team_won is True  # us got first kill
    assert result.rounds[1].our_team_won is False  # them got first kill
