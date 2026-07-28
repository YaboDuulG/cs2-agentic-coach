"""Module docstring."""
import os
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from agents.khan.nodes import (
    cache_node,
    general_node,
    rag_node,
    scout_node,
    scribe_node,
    supervisor_node,
    tactician_node,
    warlord_node,
)
from agents.state import MatchState


def route_after_supervisor(state: MatchState) -> Any:
    """Docstring for route_after_supervisor."""
    intent = state.get("intent", "tactical_analysis")
    if intent == "server_request":
        return "warlord"
    elif intent == "general":
        return "general_node"

    # Parallel fan-out: trigger scout and rag simultaneously
    return [Send("scout", state), Send("rag", state)]


_APP: Any = None
_MEMORY: Any = None


def _get_checkpointer() -> Any:
    """Initialize and return the appropriate LangGraph checkpointer."""
    global _MEMORY
    if _MEMORY is not None:
        return _MEMORY

    db_url = os.environ.get("DATABASE_URL")
    if db_url and not db_url.startswith("sqlite"):
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg_pool import ConnectionPool

        # Replace postgresql:// with postgres:// if needed, though psycopg3 handles both
        pool = ConnectionPool(conninfo=db_url, max_size=5)
        _MEMORY = PostgresSaver(pool)
        _MEMORY.setup()
    else:
        from langgraph.checkpoint.memory import MemorySaver
        _MEMORY = MemorySaver()

    return _MEMORY


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
        _APP = workflow.compile(checkpointer=_get_checkpointer())
    return _APP

def build_graph() -> Any:
    """Docstring for build_graph."""
    return _get_app()
