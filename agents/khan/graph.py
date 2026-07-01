from typing import Any
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from agents.state import MatchState
from agents.khan.nodes import (
    supervisor_node,
    scout_node,
    rag_node,
    tactician_node,
    scribe_node,
    general_node,
    warlord_node,
    cache_node,
)

def route_after_supervisor(state: MatchState) -> Any:
    intent = state.get("intent", "tactical_analysis")
    if intent == "server_request":
        return "warlord"
    elif intent == "general":
        return "general_node"

    # Parallel fan-out: trigger scout and rag simultaneously
    return [Send("scout", state), Send("rag", state)]

_MEMORY = MemorySaver()
_APP: Any = None

def _get_app() -> Any:
    """Return the compiled LangGraph app, building it once on first call."""
    global _APP
    if _APP is None:
        workflow = StateGraph(MatchState)
        workflow.add_node("supervisor", supervisor_node)
        workflow.add_node("scout", scout_node)
        workflow.add_node("rag", rag_node)
        workflow.add_node("tactician", tactician_node)
        workflow.add_node("scribe", scribe_node)
        workflow.add_node("general_node", general_node)
        workflow.add_node("warlord", warlord_node)
        workflow.add_node("cache", cache_node)
        workflow.add_conditional_edges(
            "supervisor",
            route_after_supervisor,
            ["scout", "rag", "general_node", "warlord"],
        )
        # Both scout and rag flow into tactician, which will wait for both to complete
        workflow.add_edge(["scout", "rag"], "tactician")
        workflow.add_edge("tactician", "scribe")
        workflow.add_edge("scribe", "cache")
        workflow.add_edge("general_node", "cache")
        workflow.add_edge("warlord", "cache")
        workflow.add_edge("cache", END)
        workflow.add_edge(START, "supervisor")
        _APP = workflow.compile(checkpointer=_MEMORY)
    return _APP

def build_graph() -> Any:
    workflow = StateGraph(MatchState)

    # Add nodes
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("scout", scout_node)
    workflow.add_node("rag", rag_node)
    workflow.add_node("tactician", tactician_node)
    workflow.add_node("scribe", scribe_node)
    workflow.add_node("general_node", general_node)
    workflow.add_node("warlord", warlord_node)
    workflow.add_node("cache", cache_node)

    # Set up routing
    workflow.add_conditional_edges(
        "supervisor",
        route_after_supervisor,
        ["scout", "rag", "general_node", "warlord"],
    )

    workflow.add_edge(["scout", "rag"], "tactician")
    workflow.add_edge("tactician", "scribe")
    workflow.add_edge("scribe", "cache")
    workflow.add_edge("general_node", "cache")
    workflow.add_edge("warlord", "cache")
    workflow.add_edge("cache", END)

    workflow.add_edge(START, "supervisor")

    # Use in-memory checkpointer for sessions
    memory = MemorySaver()
    return workflow.compile(checkpointer=memory)
