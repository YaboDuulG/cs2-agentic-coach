import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.khan import analyse_match

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatRequest(BaseModel):
    match_id: Optional[str] = None
    team_id: Optional[str] = None
    query: str


@router.post("")
async def submit_chat(req: ChatRequest):
    """
    Submits a natural language query to the Great Khan agent graph.
    Used by the ServerControlPanel for RCON commands or the Chat UI for tactical analysis.
    """
    try:
        # We need a match_id to initialize MatchState. If none provided (e.g. from Server panel directly to a team),
        # we can just generate a dummy one or use team_id as a prefix.
        match_id = req.match_id or f"team_{req.team_id}_dummy"

        result = analyse_match(match_id=match_id, user_query=req.query)
        if not result or "final_report" not in result:
            raise HTTPException(
                status_code=500, detail="Failed to get a response from the Great Khan."
            )

        return result["final_report"]
    except Exception as e:
        logger.error(f"Chat API error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

from typing import AsyncGenerator
import json
from fastapi.responses import StreamingResponse

async def stream_generator(req: ChatRequest, db) -> AsyncGenerator[str, None]:
    try:
        from agents.khan.graph import _get_app
        app = _get_app()
    except ImportError:
        # Fallback to the old monolith if refactor isn't completely wired
        from agents.great_khan import _get_app
        app = _get_app()
        
    import uuid
    run_session = req.match_id or str(uuid.uuid4())
    
    initial_state = {
        "match_id": req.match_id or "",
        "user_query": req.query,
        "session_id": run_session,
        "intent": "general",
        "errors": [],
        "hallucination_flags": [],
        "active_agents": [],
    }

    config = {"configurable": {"thread_id": run_session}}

    try:
        async for output in app.astream(initial_state, config=config):
            for node_name, state_update in output.items():
                if "messages" in state_update and state_update["messages"]:
                    latest_msg = state_update["messages"][-1].content
                    chunk = json.dumps({"node": node_name, "chunk": latest_msg})
                    yield f"data: {chunk}\n\n"
                elif "final_report" in state_update and state_update["final_report"]:
                    report = state_update["final_report"]
                    if isinstance(report, dict):
                        chunk = json.dumps({"node": node_name, "report": report})
                        yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"Error during SSE stream: {e}")
        yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

@router.post("/stream")
async def stream_chat(req: ChatRequest):
    return StreamingResponse(
        stream_generator(req, None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )

