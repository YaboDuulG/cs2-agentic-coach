"""
Unit tests for the LangGraph MatchState schema.
Validates that the state TypedDict structure is correct.
"""

from agents.state import MatchState


def test_match_state_is_dict_subclass():
    """MatchState should be instantiable as a plain dict."""
    state: MatchState = {
        "match_id": "test-001",
        "user_query": "How did I play in round 5?",
        "session_id": "sess-abc",
        "intent": "tactical_analysis",
    }
    assert state["match_id"] == "test-001"
    assert state["intent"] == "tactical_analysis"


def test_match_state_optional_fields_default_to_none():
    """Optional fields should not be required."""
    state: MatchState = {
        "match_id": "test-002",
        "user_query": "show stats",
    }
    assert state.get("scout_output") is None
    assert state.get("tactical_analysis") is None
    assert state.get("final_report") is None


def test_match_state_errors_list():
    """Errors field should accept a list of strings."""
    state: MatchState = {
        "match_id": "test-003",
        "user_query": "test",
        "errors": ["Scout parse failed", "Timeout on Tactician"],
    }
    assert len(state["errors"]) == 2
