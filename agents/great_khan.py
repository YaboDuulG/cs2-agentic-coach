"""
The Great Khan — LangGraph Orchestrator (Stub)
==============================================
Phase 2 implementation. This file defines the supervisor node skeleton.
Routing logic and agent handoffs will be wired here.

Current state: stub with intent classification placeholder.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from agents.state import MatchState

logger = logging.getLogger("great_khan")

# --- Model ---
ORCHESTRATOR_MODEL = "gemini-2.5-pro"


def great_khan_node(state: MatchState) -> dict[str, Any]:
    """
    Supervisor node. Classifies user intent and routes to sub-agents.
    TODO (Phase 2): Implement full routing + synthesis logic.
    """
    logger.info(f"[Great Khan] Processing query: {state.get('user_query', '')}")

    # Placeholder intent classification
    # Phase 2 will use tool-calling handoffs via Gemini 2.5 Pro
    return {
        "intent": "tactical_analysis",
        "active_agents": ["scout", "tactician"],
    }


def build_graph() -> StateGraph:
    """
    Build the LangGraph supervisor graph.
    TODO (Phase 2): Wire all agent nodes and edges.
    """
    graph = StateGraph(MatchState)
    graph.add_node("great_khan", great_khan_node)
    graph.set_entry_point("great_khan")
    graph.add_edge("great_khan", END)
    return graph
