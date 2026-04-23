"""
Chinghis Scan — LangGraph Global State Schema
=============================================
Single TypedDict shared across ALL agents.
The Great Khan owns this schema — no agent may add fields without updating here.
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from typing_extensions import TypedDict


class AgentConfidence(TypedDict):
    """Confidence envelope attached to every agent output."""
    score: float        # 0.0 – 1.0
    grounded: bool      # True if claim is backed by parsed demo data or RAG
    flagged: bool       # True if confidence < threshold; output withheld from user


class MatchState(TypedDict, total=False):
    """
    Global LangGraph state. All agents read from and write to this.

    Lifecycle:
        1. Great Khan populates match_id + user_query on session start.
        2. Scout writes scout_output after demo parse.
        3. Comms Analyst writes comms_output after audio analysis.
        4. Khan's Library writes rag_context after retrieval.
        5. Tactician writes tactical_analysis after per-round analysis.
        6. Scribe writes final_report after report generation.
        7. Great Khan synthesizes and returns to user.
    """

    # --- Session ---
    match_id: str
    user_query: str
    session_id: str
    intent: Literal["stat_query", "tactical_analysis", "server_request", "general"]

    # --- Agent outputs ---
    scout_output: Optional[dict[str, Any]]          # Structured JSON from demo parse
    comms_output: Optional[dict[str, Any]]          # Transcript + NLP scores
    rag_context: Optional[list[dict[str, Any]]]     # Pro match references from pgvector
    tactical_analysis: Optional[dict[str, Any]]    # Tactician per-player/round analysis
    final_report: Optional[dict[str, Any]]         # Scribe compiled report

    # --- Routing & control ---
    active_agents: list[str]                        # Which agents are currently running
    errors: list[str]                               # Accumulated error messages
    hallucination_flags: list[str]                  # Claims withheld due to low confidence

    # --- Confidence ---
    confidence: Optional[AgentConfidence]
