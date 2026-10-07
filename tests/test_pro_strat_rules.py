"""Tests for services/pro_strats/rules.py — the strat/tip/mechanic gate."""

import pytest

from services.pro_strats.rules import (
    EntryKind,
    GateDecision,
    StratTemplate,
    Verdict,
    classify_entry,
    gate_archetype_draft,
    validate_template,
)


def _full_strat_template() -> dict:
    return {
        "name": "Mirage A execute with late lurk",
        "identity": {
            "map_name": "de_mirage",
            "side": "T",
            "objective": "A site execute",
        },
        "buy_requirement": "full buy: 4 smokes, 4 flashes, 2 mollies, no AWP needed",
        "roles": [
            {"player": "Player 1", "job": "entry palace"},
            {"player": "Player 2", "job": "trade frag palace"},
            {"player": "Player 3", "job": "lurk mid, late B pressure"},
            {"player": "Player 4", "job": "support, throws CT smoke"},
            {"player": "Player 5", "job": "IGL, calls the hit"},
        ],
        "timing_trigger": "at 1:10, after default mid control",
        "timing_order": "smokes at 1:05, flashes at 1:02, palace pop at 1:00",
        "utility": [
            {"thrower": "Player 4", "nade": "smoke", "purpose": "CT smoke"},
            {"thrower": "Player 1", "nade": "flash", "purpose": "palace pop flash"},
            {"thrower": "Player 2", "nade": "molotov", "purpose": "triple molly"},
        ],
        "execution_steps": [
            "Take mid control by 1:20",
            "Throw CT + stairs smokes at 1:05",
            "Palace pop with flashes at 1:00",
            "Plant default, play post-plant crossfire",
        ],
        "contingencies": [
            "if they stack A then Player 3 hits B with the lurk smoke",
            "if we lose palace entry then fallback to mid control and default",
        ],
        "what_beats_it": "early mid aggression that kills the lurk",
        "when_not_to_call": "don't call on force buys; needs the full utility set",
    }


# --- classification ---------------------------------------------------------


def test_full_execute_classifies_as_strat():
    text = (
        "Player 1 entries palace, Player 2 trades him, Player 3 lurks mid. "
        "If they stack A then we hit B. If we lose the entry, fallback to default."
    )
    result = classify_entry(text)
    assert result.kind is EntryKind.STRAT


def test_single_lineup_classifies_as_tip():
    result = classify_entry(
        "Stand in the corner of palace, aim at the antenna, jump-throw the CT smoke."
    )
    assert result.kind is EntryKind.TIP
    assert any("tip" in r for r in result.reasons)


def test_mechanic_explainer_classifies_as_mechanic():
    result = classify_entry(
        "Counter-strafing cancels your movement so your spray is accurate. "
        "This movement technique is essential for rifle duels."
    )
    assert result.kind is EntryKind.MECHANIC


def test_empty_text_is_not_a_strat():
    assert classify_entry("").kind is EntryKind.TIP
    assert classify_entry("   ").kind is EntryKind.TIP


def test_coordination_without_contingency_is_tip():
    text = (
        "Player 1 entries, Player 2 trades, Player 3 lurks. "
        "Everyone throws their utility on time."
    )
    result = classify_entry(text)
    assert result.kind is EntryKind.TIP
    assert any("contingency" in r for r in result.reasons)


@pytest.mark.parametrize(
    "text",
    [
        # two role words describing ONE player are not two players
        "The entry should wait for support before peeking; if they push then back off.",
        # one label, if/then
        "Player 1 holds the angle; if they come then he falls back.",
        # 'setup' alone
        "Setup on A: if they go B then rotate.",
        # an AWPer's own decision tree
        "Our AWPer holds mid; if they smoke it, he falls back to window.",
    ],
)
def test_one_player_with_a_contingency_is_still_a_tip(text):
    result = classify_entry(text)
    assert result.kind is EntryKind.TIP
    assert any("fewer than two players" in r for r in result.reasons)


@pytest.mark.parametrize(
    "text",
    [
        # "if X, Y" without the word "then"
        "Player 1 smokes CT, Player 2 flashes over and entries. If they stack A, we swing to B.",
        # five labels + "on contact"
        "Player 1 entries, Player 2 trades, Player 3 lurks, Player 4 supports, Player 5 calls. "
        "On contact at banana, everyone collapses B.",
        # pair word instead of labels
        "The entry goes first and the trader trades him; if we lose the opener, fall back to default.",
        # short labels, "when they rotate"
        "P1 entries and P2 trades; when they rotate, swing to A.",
    ],
)
def test_two_or_more_players_with_a_contingency_is_a_strat(text):
    assert classify_entry(text).kind is EntryKind.STRAT


def test_mechanic_explainer_stays_a_mechanic_even_with_player_labels():
    text = "Player 1 and Player 2 should practise counter-strafing; if you stop then shoot."
    assert classify_entry(text).kind is EntryKind.MECHANIC


def test_player_count_is_capped_at_five():
    from services.pro_strats.rules import _count_coordinating_players

    text = " ".join(f"Player {i} holds" for i in range(1, 10))
    assert _count_coordinating_players(text) == 5


# --- template validation ----------------------------------------------------


def test_complete_template_passes_all_eight():
    checklist = validate_template(StratTemplate.model_validate(_full_strat_template()))
    assert checklist.passed_count == 8
    assert checklist.verdict is Verdict.STRAT
    assert checklist.missing == []


def test_missing_contingencies_is_not_a_strat():
    data = _full_strat_template()
    data["contingencies"] = []
    checklist = validate_template(StratTemplate.model_validate(data))
    assert checklist.verdict is Verdict.NOT_A_STRAT
    assert "contingencies" in checklist.missing


def test_partial_roles_is_half_a_strat():
    data = _full_strat_template()
    data["roles"] = data["roles"][:3]  # only three players with jobs
    checklist = validate_template(StratTemplate.model_validate(data))
    assert checklist.verdict is Verdict.HALF_STRAT
    assert "roles" in checklist.missing


def test_bare_template_is_not_a_strat():
    data = _full_strat_template()
    data["buy_requirement"] = ""
    data["utility"] = []
    data["contingencies"] = []
    data["what_beats_it"] = ""
    data["when_not_to_call"] = ""
    checklist = validate_template(StratTemplate.model_validate(data))
    assert checklist.verdict is Verdict.NOT_A_STRAT


# --- gate -------------------------------------------------------------------


def test_gate_accepts_complete_strat():
    draft = {
        "label": "Mirage A execute",
        "summary_text": (
            "Player 1 entries palace and Player 2 trades him while Player 3 "
            "lurks mid; if they stack A then we hit B."
        ),
        "template": _full_strat_template(),
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.ACCEPT
    assert result.kind is EntryKind.STRAT


def test_gate_rejects_tip():
    draft = {
        "label": "CT smoke lineup",
        "summary_text": "Stand in palace corner, aim at the antenna, jump-throw.",
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.REJECT
    assert result.kind is EntryKind.TIP


def test_gate_rejects_mechanic():
    draft = {
        "label": "Spray control",
        "summary_text": "Spray control and recoil patterns for the AK-47.",
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.REJECT
    assert result.kind is EntryKind.MECHANIC


def test_gate_sends_unstructured_strat_to_review():
    draft = {
        "label": "Inferno B execute",
        "summary_text": (
            "Player 1 entries apps and Player 2 trades him; "
            "if they stack B then fallback to A."
        ),
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.NEEDS_REVIEW
    assert result.kind is EntryKind.STRAT


def test_gate_sends_half_strat_to_review_with_missing_sections():
    data = _full_strat_template()
    data["what_beats_it"] = ""
    draft = {
        "label": "Mirage A execute",
        "summary_text": (
            "Player 1 entries palace and Player 2 trades him while Player 3 "
            "lurks mid; if they stack A then we hit B."
        ),
        "template": data,
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.NEEDS_REVIEW
    assert "counters" in result.missing_sections


def test_gate_handles_malformed_template_without_crashing():
    draft = {
        "label": "Broken",
        "summary_text": "Player 1 entries and Player 2 trades; if X then Y.",
        "template": {"name": "broken"},  # missing required fields
    }
    result = gate_archetype_draft(draft)
    assert result.decision is GateDecision.NEEDS_REVIEW


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
