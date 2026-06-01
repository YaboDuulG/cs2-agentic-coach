"""
Unit tests for the Great Khan LangGraph orchestrator.
Verifies workflow structure, node execution, and query intent routing.
"""

from unittest.mock import MagicMock, patch

import pytest

import agents.great_khan as great_khan_module
from agents.great_khan import analyse_match, build_graph


@pytest.fixture(autouse=True)
def reset_graph_singleton():
    """Reset the _APP singleton before each test to prevent cross-test contamination.
    Each test compiles a fresh graph under its own set of mocked functions.
    """
    great_khan_module._APP = None
    great_khan_module._MEMORY = great_khan_module.MemorySaver()
    yield
    great_khan_module._APP = None
    great_khan_module._MEMORY = great_khan_module.MemorySaver()


def test_graph_compilation():
    """Verify that build_graph successfully returns a compiled LangGraph app."""
    app = build_graph()
    assert app is not None
    assert hasattr(app, "invoke")


# NOTE: @patch decorators are applied bottom-up: the BOTTOM-MOST decorator
# injects the FIRST argument, the top-most injects the LAST argument.
@patch("agents.great_khan._compute_stats") # → mock_stats    (last arg  — top)
@patch("agents.scribe.report_generator.generate_reports")   # → mock_gemini   (3rd arg)
@patch("db.database.SessionLocal")         # → mock_session  (2nd arg)
@patch("db.rag.retrieve_similar_chunks")   # → mock_retrieve (1st arg  — bottom)
def test_tactical_analysis_pipeline(mock_retrieve, mock_session, mock_gemini, mock_stats):
    """Test that the full tactical analysis pipeline runs and invokes nodes in sequence."""
    mock_stats.return_value = {
        "map_name": "de_mirage",
        "total_rounds": 24,
        "ct_wins": 13,
        "t_wins": 11,
        "top_killers": [],
        "top_weapons": [],
        "ct_avg_spend": 16000,
        "t_avg_spend": 15000,
        "ct_first_contact_pct": 0.5,
        "t_first_contact_pct": 0.5,
        "worst_rounds": [],
    }

    mock_gemini.return_value = {
        "strat_card": "Mock strat card.",
        "player_reports": {"s1mple": "Mock report"},
        "coach_report": "Mock coach.",
    }

    mock_retrieve.return_value = [{"content": "CS2 Mirage guidelines", "source": "game_rules"}]

    # Mock the database session used by tactician_node and cache_node
    mock_db = MagicMock()
    mock_session.return_value = mock_db
    mock_query = mock_db.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.all.return_value = []
    mock_filter.first.return_value = MagicMock()

    # Invoke
    report = analyse_match("match-123", user_query="")

    assert report is not None
    assert report["strat_card"] == "Mock strat card."
    assert "s1mple" in report["player_reports"]

    # Assert mocks were called
    mock_stats.assert_called_once_with("match-123")
    mock_gemini.assert_called_once()
    assert mock_retrieve.call_count >= 1


@patch("agents.great_khan._call_gemini")   # → mock_gemini   (last arg  — top)
@patch("db.database.SessionLocal")         # → mock_session  (2nd arg)
@patch("db.rag.retrieve_similar_chunks")   # → mock_retrieve (1st arg  — bottom)
def test_general_informational_route(mock_retrieve, mock_session, mock_gemini):
    """Verify that general/informational queries route to the general node."""
    mock_gemini.return_value = {
        "summary": "Mock history summary.",
        "key_findings": ["Past game 1 details"],
        "economy_analysis": "N/A",
        "tactical_recommendations": [],
        "strongest_area": "Historical strength",
        "weakest_area": "Historical weakness",
    }
    mock_retrieve.return_value = [{"content": "HLTV NAVI vs Vitality meta info", "source": "hltv_pro_match"}]

    mock_db = MagicMock()
    mock_session.return_value = mock_db
    mock_db.execute.return_value.fetchone.return_value = None

    # Query with general/history intent keywords
    report = analyse_match("match-123", user_query="What has been our meta strategy in past games?")

    assert report is not None
    assert report["summary"] == "Mock history summary."

    # Verify _compute_stats is NOT called when routing to general_node
    with patch("agents.great_khan._compute_stats") as mock_stats, \
         patch("agents.great_khan._call_gemini"), \
         patch("db.database.SessionLocal"):
        analyse_match("match-123", user_query="Show HLTV meta history")
        mock_stats.assert_not_called()


@patch("langchain_google_genai.ChatGoogleGenerativeAI")
@patch("db.database.SessionLocal")
def test_server_request_route(mock_session, mock_llm_class):
    """Verify that server-related queries route to the warlord node."""
    mock_db = MagicMock()
    mock_session.return_value = mock_db

    # Mock Match object with team_id
    mock_match = MagicMock()
    mock_match.team_id = "team-123"

    # Mock PracticeServer with IP and RCON
    mock_server = MagicMock()
    mock_server.status = "active"
    mock_server.ip_address = "127.0.0.1:27015"
    mock_server.rcon_password = "password"

    # Set up DB queries
    mock_db.query.return_value.filter.return_value.first.side_effect = [mock_match, mock_server]

    # Mock LLM and response
    mock_llm = MagicMock()
    mock_llm_class.return_value = mock_llm
    mock_llm.invoke.return_value.content = '{"commands": ["sv_cheats 1"]}'

    with patch("services.warlord.rcon_client.execute_batch_commands"):
        report = analyse_match("match-123", user_query="Please spin up a practice server on de_nuke")

    assert report is not None
    assert "Executed 1 server commands successfully." in report["summary"]
    assert "Executed: sv_cheats 1" in report["key_findings"][0]
