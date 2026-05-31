"""
Unit tests for the Great Khan LangGraph orchestrator.
Verifies workflow structure, node execution, and query intent routing.
"""

from unittest.mock import MagicMock, patch

from agents.great_khan import analyse_match, build_graph


def test_graph_compilation():
    """Verify that build_graph successfully returns a compiled LangGraph app."""
    app = build_graph()
    assert app is not None
    assert hasattr(app, "invoke")


@patch("agents.great_khan._compute_stats")
@patch("agents.great_khan._call_gemini")
@patch("db.database.SessionLocal")
@patch("db.rag.retrieve_similar_chunks")
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
        "summary": "Mock summary.",
        "key_findings": ["F1", "F2"],
        "economy_analysis": "Mock econ.",
        "tactical_recommendations": [],
        "strongest_area": "Mock strong.",
        "weakest_area": "Mock weak.",
    }

    mock_retrieve.return_value = [{"content": "CS2 Mirage guidelines", "source": "game_rules"}]

    # Mock the database transaction inside tactician_node and cache_node
    mock_db = MagicMock()
    mock_session.return_value = mock_db
    # Mock query filters
    mock_query = mock_db.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.all.return_value = []  # No first contacts or rounds for empty FCR mock
    mock_filter.first.return_value = MagicMock()  # Mock Match object for caching

    # Invoke
    report = analyse_match("match-123", user_query="")

    assert report is not None
    assert report["summary"] == "Mock summary."
    assert len(report["key_findings"]) == 2

    # Assert mocks were called
    mock_stats.assert_called_once_with("match-123")
    mock_gemini.assert_called_once()
    assert mock_retrieve.call_count >= 1


@patch("agents.great_khan._call_gemini")
@patch("db.database.SessionLocal")
@patch("db.rag.retrieve_similar_chunks")
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
    # Mock text execute for fetching team history
    mock_db.execute.return_value.fetchone.return_value = None  # No team history found

    # Query with general/history intent keywords
    report = analyse_match("match-123", user_query="What has been our meta strategy in past games?")

    assert report is not None
    assert report["summary"] == "Mock history summary."

    # Verify that the scout stats were NOT computed since we routed to general_node directly
    with patch("agents.great_khan._compute_stats") as mock_stats:
        analyse_match("match-123", user_query="Show HLTV meta history")
        mock_stats.assert_not_called()


@patch("db.database.SessionLocal")
def test_server_request_route(mock_session):
    """Verify that server-related queries route to the warlord node."""
    mock_db = MagicMock()
    mock_session.return_value = mock_db
    mock_db.query.return_value.filter.return_value.first.return_value = MagicMock()

    report = analyse_match("match-123", user_query="Please spin up a practice server on de_nuke")

    assert report is not None
    assert "Server command parsed." in report["summary"]
    assert "Warlord server node executed." in report["key_findings"]
