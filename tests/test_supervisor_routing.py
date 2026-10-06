"""agents/khan/nodes.py classify_intent: the Great Khan's first decision is a
keyword table; these pin the brittle cases so a stray substring never sends
a coaching question to the server node."""

import pytest

from agents.khan.nodes import classify_intent, supervisor_node


@pytest.mark.parametrize(
    "query",
    [
        "spin up a server for practice",
        "can you connect me to the practice server",
        "run rcon mp_pause_match",
        "warlord, kick the bots",
        "is dathost down",
        "Server please",
    ],
)
def test_server_requests(query):
    """Docstring for test_server_requests."""
    assert classify_intent(query) == "server_request"


@pytest.mark.parametrize(
    "query",
    [
        "what does hltv say about the current meta on mirage",
        "how did we do overall this season",
        "compare to our last game",
        "what's the trend in our B retakes",
        "our history on inferno",
    ],
)
def test_general_questions(query):
    """Docstring for test_general_questions."""
    assert classify_intent(query) == "general"


@pytest.mark.parametrize(
    "query",
    [
        # substrings that used to misroute
        "we observed their lurker every round",  # "observed" contains "server"
        "I pasted the demo link, why did round 7 collapse",  # "pasted" contains "past"
        "check the metadata on the demo",  # "metadata" contains "meta"
        "the trendy new smoke on A",  # "trendy" contains "trend"
        "why do we lose connector fights",  # "connector" contains "connect"
        "the overpass default feels slow",
        # ordinary coaching questions
        "why did we lose the A retakes",
        "how should we play the pistol round",
        "",
        "   ",
    ],
)
def test_coaching_questions_stay_tactical(query):
    """Docstring for test_coaching_questions_stay_tactical."""
    assert classify_intent(query) == "tactical_analysis"


def test_server_beats_general_when_both_appear():
    """Docstring for test_server_beats_general_when_both_appear."""
    assert classify_intent("spin up a server like last game") == "server_request"


def test_supervisor_node_returns_the_intent():
    """Docstring for test_supervisor_node_returns_the_intent."""
    assert supervisor_node({"user_query": "connect to the server"}) == {"intent": "server_request"}
    assert supervisor_node({}) == {"intent": "tactical_analysis"}
