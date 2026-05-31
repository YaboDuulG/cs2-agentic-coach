"""
The Great Khan — Stateful AI Coaching Engine (LangGraph-based)
==============================================================
Pulls parsed match data, retrieves RAG context, performs tactical analysis,
and generates structured coaching feedback using a stateful multi-agent topology.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from agents.state import MatchState

logger = logging.getLogger("great_khan")

COACHING_MODEL = "gemini-2.0-flash"


# ---------------------------------------------------------------------------
# Core Gemini Callers & Prompt Builders
# ---------------------------------------------------------------------------


def _build_prompt(match_id: str, stats: dict[str, Any], rag_context: list[dict[str, Any]] | None = None) -> str:
    rag_text = ""
    if rag_context:
        rag_text = "\n\nCRITICAL CONTEXT & GAME RULES FOR THE COACH (RAG):\n"
        for i, chunk in enumerate(rag_context, 1):
            rag_text += f"[{i}] {chunk.get('content')}\n"

    return f"""You are DemoSage — an elite CS2 tactical coach. Analyse this match data and return ONLY valid JSON with no markdown.

Match: {stats.get("map_name", "unknown")} | {stats.get("total_rounds", 0)} rounds
CT wins: {stats.get("ct_wins", 0)} | T wins: {stats.get("t_wins", 0)}

Top killers:
{json.dumps(stats.get("top_killers", []), indent=2)}

Economy summary (avg spend per round):
CT avg: ${stats.get("ct_avg_spend", 0):.0f} | T avg: ${stats.get("t_avg_spend", 0):.0f}

First contact win rate (who won the opening duel):
CT: {stats.get("ct_first_contact_pct", 0):.0%} | T: {stats.get("t_first_contact_pct", 0):.0%}

Top weapons used:
{json.dumps(stats.get("top_weapons", []), indent=2)}

Worst economy rounds (high spend, round lost):
{json.dumps(stats.get("worst_rounds", []), indent=2)}

Return this exact JSON structure:
{{
  "summary": "2-3 sentence match summary mentioning map, score, and overall performance",
  "key_findings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "economy_analysis": "2-3 sentences on economy patterns and mismanagement",
  "tactical_recommendations": [
    {{"title": "short title", "detail": "specific actionable recommendation"}},
    {{"title": "short title", "detail": "specific actionable recommendation"}},
    {{"title": "short title", "detail": "specific actionable recommendation"}}
  ],
  "strongest_area": "one sentence on what the team did well",
  "weakest_area": "one sentence on the biggest weakness to fix"
}}{rag_text}"""


def _compute_stats(match_id: str) -> dict[str, Any] | None:
    """Pull match data from DB and compute summary statistics."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import FirstContact, Kill, Match, Round  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return None

            kills = db.query(Kill).filter(Kill.match_id == match_id).all()
            rounds = db.query(Round).filter(Round.match_id == match_id).all()
            first_contacts = db.query(FirstContact).filter(FirstContact.match_id == match_id).all()

            # Win rates
            ct_wins = sum(1 for r in rounds if r.winner_side == "CT")
            t_wins = sum(1 for r in rounds if r.winner_side == "T")

            # Top killers
            killer_counts: dict[str, int] = {}
            weapon_counts: dict[str, int] = {}
            for k in kills:
                if k.attacker:
                    killer_counts[k.attacker] = killer_counts.get(k.attacker, 0) + 1
                if k.weapon:
                    weapon_counts[k.weapon] = weapon_counts.get(k.weapon, 0) + 1

            top_killers = sorted(killer_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            top_weapons = sorted(weapon_counts.items(), key=lambda x: x[1], reverse=True)[:5]

            # Economy
            ct_spends = [r.ct_eq_val for r in rounds if r.ct_eq_val is not None and r.ct_eq_val > 0]
            t_spends = [r.t_eq_val for r in rounds if r.t_eq_val is not None and r.t_eq_val > 0]

            # Worst rounds (lost despite high spend)
            worst_rounds = []
            for r in rounds:
                spend = r.ct_eq_val if r.winner_side == "T" else r.t_eq_val
                if spend and spend > 10000:
                    worst_rounds.append(
                        {
                            "round": r.round_num,
                            "loser": "CT" if r.winner_side == "T" else "T",
                            "spend": spend,
                            "winner": r.winner_side,
                        }
                    )
            worst_rounds = sorted(worst_rounds, key=lambda x: x["spend"], reverse=True)[:5]

            # First contact win rate
            ct_fc = sum(1 for fc in first_contacts if fc.attacker_team == "CT")
            t_fc = len(first_contacts) - ct_fc
            total_fc = len(first_contacts) or 1

            return {
                "map_name": match.map_name,
                "total_rounds": match.total_rounds,
                "ct_wins": ct_wins,
                "t_wins": t_wins,
                "top_killers": [{"player": p, "kills": k} for p, k in top_killers],
                "top_weapons": [{"weapon": w, "kills": k} for w, k in top_weapons],
                "ct_avg_spend": sum(ct_spends) / len(ct_spends) if ct_spends else 0,
                "t_avg_spend": sum(t_spends) / len(t_spends) if t_spends else 0,
                "ct_first_contact_pct": ct_fc / total_fc,
                "t_first_contact_pct": t_fc / total_fc,
                "worst_rounds": worst_rounds,
            }
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to compute stats for {match_id}: {e}")
        return None


def _stub_coaching() -> dict[str, Any]:
    """Fallback when no API key is configured."""
    return {
        "summary": "Demo analysed. AI coaching requires GEMINI_API_KEY to be configured.",
        "key_findings": ["Upload a demo and configure GEMINI_API_KEY to see AI insights."],
        "economy_analysis": "Economy data parsed successfully.",
        "tactical_recommendations": [
            {
                "title": "Configure API Key",
                "detail": "Add GEMINI_API_KEY to your GCP Secret Manager to enable AI coaching.",
            }
        ],
        "strongest_area": "Demo parsed successfully.",
        "weakest_area": "AI coaching not yet configured.",
    }


def _call_gemini(prompt: str) -> dict[str, Any] | None:
    """Call Gemini and parse the JSON response."""
    try:
        import os  # noqa: PLC0415

        import google.generativeai as genai  # noqa: PLC0415

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("No Gemini API key — returning stub notes")
            return _stub_coaching()

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.4,
                response_mime_type="application/json",
            ),
        )
        import json  # noqa: PLC0415
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        return None


def _stub_coaching() -> dict[str, Any]:
    """Fallback when no API key is configured."""
    return {
        "summary": "AI coaching requires GEMINI_API_KEY to be configured.",
        "key_findings": ["Configure GEMINI_API_KEY to see AI insights."],
        "economy_analysis": "Data parsed successfully.",
        "tactical_recommendations": [
            {
                "title": "Configure API Key",
                "detail": "Add GEMINI_API_KEY to Secret Manager.",
            }
        ],
        "strongest_area": "Demo parsed successfully.",
        "weakest_area": "AI coaching not yet configured.",
    }

# ---------------------------------------------------------------------------
# LangGraph Node Definitions
# ---------------------------------------------------------------------------


def supervisor_node(state: MatchState) -> dict[str, Any]:
    """Classifies the user query and routes to the correct node."""
    logger.info("[Supervisor] Evaluating user query...")
    query = state.get("user_query", "").strip()

    if not query:
        # If no user query, default to tactical analysis on the uploaded match
        return {"intent": "tactical_analysis"}

    query_lower = query.lower()

    # Route based on key terms
    if any(k in query_lower for k in ("server", "warlord", "connect", "rcon", "dathost", "spin up")):
        intent = "server_request"
    elif any(k in query_lower for k in ("history", "past", "meta", "trend", "overall", "last game", "hltv")):
        intent = "general"
    else:
        intent = "tactical_analysis"

    logger.info(f"[Supervisor] Classed intent: {intent}")
    return {"intent": intent}


def scout_node(state: MatchState) -> dict[str, Any]:
    """Fetches parsed stats from the database for the given match."""
    match_id = state.get("match_id")
    logger.info(f"[Scout Node] Fetching match stats for {match_id}...")
    stats = _compute_stats(match_id)
    if not stats:
        return {"errors": ["Scout stats could not be computed for this match."]}
    return {"scout_output": stats}


def rag_node(state: MatchState) -> dict[str, Any]:
    """Retrieves context from the RAG database based on the map name."""
    match_id = state.get("match_id")

    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import Match  # noqa: PLC0415
    from db.rag import retrieve_similar_chunks  # noqa: PLC0415

    db = SessionLocal()
    try:
        match_obj = db.query(Match).filter(Match.match_id == match_id).first()
        map_name = match_obj.map_name if match_obj else "unknown"
        logger.info(f"[Library RAG Node] Querying rules and pro tactics for de_{map_name}...")

        rag_context = []
        # Query CS2 map rules and guidelines
        map_chunks = retrieve_similar_chunks(
            db, query=f"CS2 tactical guidelines map {map_name}", limit=3, source="game_rules"
        )
        rag_context.extend(map_chunks)

        # Query economy save/buy rules
        econ_chunks = retrieve_similar_chunks(
            db, query="CS2 economy buy thresholds and save rules", limit=2, source="game_rules"
        )
        rag_context.extend(econ_chunks)

        # Query pro matches
        pro_chunks = retrieve_similar_chunks(
            db, query=f"pro match de_{map_name} tactics", limit=2, source="hltv_pro_match"
        )
        rag_context.extend(pro_chunks)
    except Exception as e:
        logger.error(f"RAG retrieval failed: {e}")
    finally:
        db.close()

    return {"rag_context": rag_context}


def tactician_node(state: MatchState) -> dict[str, Any]:
    """Evaluates duels, economy, utility, and movement via Tactician modules."""
    match_id = state.get("match_id")
    logger.info(f"[Tactician Node] Running tactical analysis for match {match_id}...")

    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import FirstContact, Grenade, PlayerTrajectory, Round  # noqa: PLC0415
    from services.tactician.economy_coherence import (  # noqa: PLC0415
        analyze_economy,
        economy_to_dict,
    )
    from services.tactician.fcr import analyze_fcr, fcr_to_dict  # noqa: PLC0415
    from services.tactician.positional_patterns import (  # noqa: PLC0415
        analyze_positions,
        positions_to_dict,
    )
    from services.tactician.rotation_efficiency import (  # noqa: PLC0415
        analyze_rotations,
        rotation_to_dict,
    )
    from services.tactician.utility_sequencing import (  # noqa: PLC0415
        analyze_utility,
        utility_to_dict,
    )

    db = SessionLocal()
    try:
        first_contacts = db.query(FirstContact).filter(FirstContact.match_id == match_id).all()
        rounds = db.query(Round).filter(Round.match_id == match_id).all()
        grenades = db.query(Grenade).filter(Grenade.match_id == match_id).all()
        trajectories = db.query(PlayerTrajectory).filter(PlayerTrajectory.match_id == match_id).all()

        fc_list = []
        for fc in first_contacts:
            fc_list.append(
                {
                    "round_num": fc.round_num,
                    "attacker": fc.attacker,
                    "attacker_team": fc.attacker_team,
                    "victim": fc.victim,
                    "weapon": fc.weapon,
                    "headshot": fc.headshot,
                    "tick": fc.tick,
                }
            )

        r_list = []
        for r in rounds:
            r_list.append(
                {
                    "round_num": r.round_num,
                    "winner_side": r.winner_side,
                    "ct_eq_val": r.ct_eq_val,
                    "t_eq_val": r.t_eq_val,
                }
            )

        g_list = []
        for g in grenades:
            g_list.append(
                {
                    "round_num": g.round_num,
                    "tick": g.tick,
                    "thrower": g.thrower,
                    "grenade_type": g.grenade_type,
                }
            )

        t_list = []
        for t in trajectories:
            t_list.append(
                {
                    "round_num": t.round_num,
                    "player": t.player,
                    "positions_json": t.positions_json,
                }
            )

        match_data = {
            "metadata": {"match_id": match_id, "total_rounds": len(rounds)},
            "first_contacts": fc_list,
            "rounds": r_list,
            "grenades": g_list,
            "trajectories": t_list,
        }

        fcr_data = fcr_to_dict(analyze_fcr(match_data))
        eco_data = economy_to_dict(analyze_economy(match_data))
        rot_data = rotation_to_dict(analyze_rotations(match_data))
        pos_data = positions_to_dict(analyze_positions(match_data))
        util_data = utility_to_dict(analyze_utility(match_data))

        return {"tactical_analysis": {
            "fcr": fcr_data,
            "economy": eco_data,
            "rotations": rot_data,
            "positions": pos_data,
            "utility": util_data
        }}
    except Exception as e:
        logger.error(f"Tactician analysis failed: {e}")
        return {"errors": ["Tactician analysis failed."]}
    finally:
        db.close()


def scribe_node(state: MatchState) -> dict[str, Any]:
    """Compiles the report by incorporating RAG and Tactician flags into Gemini."""
    match_id = state.get("match_id")
    scout_out = state.get("scout_output", {})
    rag_context = state.get("rag_context", [])
    tactical_analysis = state.get("tactical_analysis", {})

    logger.info("[Scribe Node] Generating final report...")

    from agents.scribe.report_generator import generate_reports

    report = generate_reports(match_id, scout_out, rag_context, tactical_analysis)

    score = 1.0
    grounded = True
    if not scout_out:
        score = 0.5
        grounded = False

    return {
        "final_report": report,
        "confidence": {"score": score, "grounded": grounded, "flagged": score < 0.6},
    }


def general_node(state: MatchState) -> dict[str, Any]:
    """Handles informational queries concerning history, meta trends, and rules."""
    query = state.get("user_query", "")
    match_id = state.get("match_id")
    logger.info(f"[General Node] Querying meta and historical games context for query: {query}")

    from db.database import SessionLocal  # noqa: PLC0415
    from db.rag import retrieve_similar_chunks  # noqa: PLC0415

    rag_context = []
    db = SessionLocal()
    try:
        # Retrieve guideline and pro match meta snapshots
        meta_chunks = retrieve_similar_chunks(db, query=query, limit=4, source="game_rules")
        rag_context.extend(meta_chunks)

        pro_chunks = retrieve_similar_chunks(db, query=query, limit=4, source="hltv_pro_match")
        rag_context.extend(pro_chunks)
    except Exception as e:
        logger.error(f"RAG retrieval failed in general_node: {e}")

    # Build historical trend profile
    past_matches_summary = ""
    try:
        from sqlalchemy import text  # noqa: PLC0415

        match_row = db.execute(
            text("SELECT team_id, user_id FROM matches WHERE match_id = :match_id"),
            {"match_id": match_id},
        ).fetchone()

        if match_row:
            team_id, user_id = match_row[0], match_row[1]
            if team_id:
                history_rows = db.execute(
                    text(
                        "SELECT match_id, map_name, total_rounds, coaching_notes, created_at FROM matches WHERE team_id = :team_id AND status = 'complete' ORDER BY created_at DESC LIMIT 5"
                    ),
                    {"team_id": team_id},
                ).fetchall()
            else:
                history_rows = db.execute(
                    text(
                        "SELECT match_id, map_name, total_rounds, coaching_notes, created_at FROM matches WHERE user_id = :user_id AND status = 'complete' ORDER BY created_at DESC LIMIT 5"
                    ),
                    {"user_id": user_id},
                ).fetchall()

            if history_rows:
                past_matches_summary += "\n\nPAST TEAM MATCHES HISTORICAL TRENDS:\n"
                for h in history_rows:
                    past_matches_summary += f"- Match on {h[1]} ({h[2]} rounds, created {h[4]}): "
                    notes = h[3]
                    if notes:
                        try:
                            notes_dict = json.loads(notes)
                            past_matches_summary += f"{notes_dict.get('summary', '')}\n"
                        except Exception:
                            past_matches_summary += f"{notes[:100]}...\n"
                    else:
                        past_matches_summary += "No coaching notes available.\n"
    except Exception as e:
        logger.error(f"Failed to fetch team history in general_node: {e}")
    finally:
        db.close()

    rag_text = "\n".join([f"- {c.get('content')}" for c in rag_context])

    prompt = f"""You are DemoSage (The Great Khan) — an elite CS2 tactical coach.
The user is asking a general or historical question: "{query}"

Here is some retrieved game rules, meta, and pro guidelines context (RAG):
{rag_text}
{past_matches_summary}

Based on this, answer the user's question with historical insights, past trends, and strategic advice.
Return ONLY valid JSON matching this exact structure:
{{
  "summary": "Direct answer to the user's query in 2-3 sentences.",
  "key_findings": ["historical context point 1", "meta trend point 2", "game review point 3"],
  "economy_analysis": "Historical economy patterns or N/A",
  "tactical_recommendations": [
    {{"title": "Meta/Strategic recommendation", "detail": "actionable advice based on historical context"}}
  ],
  "strongest_area": "Summary of historical strength",
  "weakest_area": "Summary of historical weakness"
}}"""

    report = _call_gemini(prompt)
    if not report:
        report = _stub_coaching()

    return {"final_report": report}


def warlord_node(state: MatchState) -> dict[str, Any]:
    """Stub server request handler node."""
    logger.info("[Warlord Node] Routing server config query...")
    report = {
        "summary": "Server command parsed.",
        "key_findings": ["Warlord server node executed."],
        "economy_analysis": "N/A for server requests",
        "tactical_recommendations": [
            {
                "title": "Server Request",
                "detail": f"Processed request: {state.get('user_query')}",
            }
        ],
        "strongest_area": "N/A",
        "weakest_area": "N/A",
    }
    return {"final_report": report}


def cache_node(state: MatchState) -> dict[str, Any]:
    """Caches the generated report to the matches table in the database."""
    match_id = state.get("match_id")
    report = state.get("final_report")

    # LangGraph 1.x requires every node to return at least one state key.
    # We echo back final_report unchanged so the state update is valid.
    if not report:
        return {"final_report": state.get("final_report")}

    logger.info(f"[Cache Node] Caching coaching notes for match {match_id}...")

    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import Match  # noqa: PLC0415

    db = SessionLocal()
    try:
        match = db.query(Match).filter(Match.match_id == match_id).first()
        if match:
            match.coaching_notes = json.dumps(report)
            db.commit()
            logger.info(f"[Cache Node] Cached notes saved successfully for {match_id}.")
    except Exception as e:
        logger.error(f"Failed to cache coaching notes: {e}")
    finally:
        db.close()

    return {"final_report": report}


# ---------------------------------------------------------------------------
# Graph Compilation
# ---------------------------------------------------------------------------


from langgraph.types import Send


def route_after_supervisor(state: MatchState) -> Any:
    intent = state.get("intent", "tactical_analysis")
    if intent == "server_request":
        return "warlord"
    elif intent == "general":
        return "general_node"

    # Parallel fan-out: trigger scout and rag simultaneously
    return [Send("scout", state), Send("rag", state)]


# ---------------------------------------------------------------------------
# Module-level graph singleton — compiled once, reused across all requests
# ---------------------------------------------------------------------------

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


# Keep build_graph() for tests that need a fresh isolated graph instance
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


# ---------------------------------------------------------------------------
# Main Entry Point API
# ---------------------------------------------------------------------------


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
    import uuid  # noqa: PLC0415
    run_thread_id = f"{match_id}_{uuid.uuid4().hex[:8]}"
    config = {"configurable": {"thread_id": run_thread_id}}

    try:
        final_state = app.invoke(initial_state, config=config)

        # LangGraph 1.x returns an AddableValuesDict; guard against unexpected types
        if not hasattr(final_state, "get"):
            logger.error(
                f"[Great Khan Graph] Unexpected final_state type: {type(final_state)}"
            )
            return None

        if final_state.get("errors"):
            logger.warning(
                f"[Great Khan Graph] Workflow reported errors: {final_state['errors']}"
            )

        return final_state.get("final_report")
    except Exception as e:
        logger.error(f"[Great Khan Graph] Workflow execution failed: {e}")
        return None
