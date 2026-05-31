from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from agents.great_khan import analyse_match
from db.database import get_session

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
            raise HTTPException(status_code=500, detail="Failed to get a response from the Great Khan.")
        
        return result["final_report"]
    except Exception as e:
        logger.error(f"Chat API error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
