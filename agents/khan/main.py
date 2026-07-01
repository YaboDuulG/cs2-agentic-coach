import logging
import uuid
from typing import Any

from agents.state import MatchState
from agents.khan.graph import _get_app

logger = logging.getLogger("great_khan")

def analyse_match(
    match_id: str, user_query: str = "", session_id: str = ""
) -> dict[str, Any] | None:
    """
    Main entry point. Runs the compiled LangGraph workflow.
    """
    logger.info(f"[Great Khan] Invoking LangGraph pipeline for match {match_id}...")

    initial_state: MatchState = {
        "match_id": match_id,
        "user_query": user_query,
        "session_id": session_id or f"session_{match_id}",
        "intent": "general" if user_query else "tactical_analysis",
        "errors": [],
        "hallucination_flags": [],
        "active_agents": [],
    }

    # Use the module-level singleton (not build_graph) to avoid recompilation
    app = _get_app()
    # Use a unique thread_id per invocation so MemorySaver never replays a prior
    # checkpoint from the same match — each analyse_match call is a fresh run.

    run_thread_id = f"{match_id}_{uuid.uuid4().hex[:8]}"
    config = {"configurable": {"thread_id": run_thread_id}}

    try:
        final_state = app.invoke(initial_state, config=config)

        # LangGraph 1.x returns an AddableValuesDict; guard against unexpected types
        if not hasattr(final_state, "get"):
            logger.error(f"[Great Khan Graph] Unexpected final_state type: {type(final_state)}")
            return None

        if final_state.get("errors"):
            logger.warning(f"[Great Khan Graph] Workflow reported errors: {final_state['errors']}")

        return final_state.get("final_report")
    except Exception as e:
        logger.error(f"[Great Khan Graph] Workflow execution failed: {e}")
        return None
