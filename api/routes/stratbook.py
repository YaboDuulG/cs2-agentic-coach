"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
Stratbook endpoints — create, list, and view user/team strategies.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class SaveUserStrategyRequest(BaseModel):
    """Docstring for SaveUserStrategyRequest."""
    user_id: str
    map_name: str
    title: str
    strategy_json: str


class SaveTeamPlaybookRequest(BaseModel):
    """Docstring for SaveTeamPlaybookRequest."""
    team_id: str
    map_name: str
    title: str
    playbook_json: str


@router.post("/user", summary="Save a custom user strategy")
async def save_user_strategy(body: SaveUserStrategyRequest, db: Session = Depends(get_session)):
    """Docstring for save_user_strategy."""
    if not body.title.strip() or not body.user_id.strip():
        raise HTTPException(status_code=400, detail="Title and user_id cannot be empty")

    from db.models import UserStrategy
    try:
        new_strat = UserStrategy(
            user_id=body.user_id,
            map_name=body.map_name,
            title=body.title,
            strategy_json=body.strategy_json,
        )
        db.add(new_strat)
        db.commit()
        db.refresh(new_strat)
        return {"status": "success", "id": new_strat.id}
    except Exception as e:
        logger.error(f"Failed to save user strategy: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/user/{user_id}", summary="Get all strategies for a user")
async def get_user_strategies(user_id: str, db: Session = Depends(get_session)):
    """Docstring for get_user_strategies."""
    from db.models import UserStrategy
    try:
        strats = db.query(UserStrategy).filter(UserStrategy.user_id == user_id).all()
        return {
            "strategies": [
                {
                    "id": s.id,
                    "map_name": s.map_name,
                    "title": s.title,
                    "strategy_json": s.strategy_json,
                    "created_at": s.created_at,
                }
                for s in strats
            ]
        }
    except Exception as e:
        logger.error(f"Failed to load user strategies: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/team", summary="Save a team playbook")
async def save_team_playbook(body: SaveTeamPlaybookRequest, db: Session = Depends(get_session)):
    """Docstring for save_team_playbook."""
    if not body.title.strip() or not body.team_id.strip():
        raise HTTPException(status_code=400, detail="Title and team_id cannot be empty")

    from db.models import TeamPlaybook
    try:
        new_pb = TeamPlaybook(
            team_id=body.team_id,
            map_name=body.map_name,
            title=body.title,
            playbook_json=body.playbook_json,
        )
        db.add(new_pb)
        db.commit()
        db.refresh(new_pb)
        return {"status": "success", "id": new_pb.id}
    except Exception as e:
        logger.error(f"Failed to save team playbook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/team/{team_id}", summary="Get all playbooks for a team")
async def get_team_playbooks(team_id: str, db: Session = Depends(get_session)):
    """Docstring for get_team_playbooks."""
    from db.models import TeamPlaybook
    try:
        playbooks = db.query(TeamPlaybook).filter(TeamPlaybook.team_id == team_id).all()
        return {
            "playbooks": [
                {
                    "id": p.id,
                    "map_name": p.map_name,
                    "title": p.title,
                    "playbook_json": p.playbook_json,
                    "created_at": p.created_at,
                }
                for p in playbooks
            ]
        }
    except Exception as e:
        logger.error(f"Failed to load team playbooks: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class CritiqueStrategyRequest(BaseModel):
    """Docstring for CritiqueStrategyRequest."""
    map_name: str
    strategy_json: str


@router.post("/critique", summary="Get AI critique of a drawn strategy")
async def get_strategy_critique(body: CritiqueStrategyRequest, db: Session = Depends(get_session)):
    """Docstring for get_strategy_critique."""
    if not body.map_name.strip() or not body.strategy_json.strip():
        raise HTTPException(status_code=400, detail="map_name and strategy_json cannot be empty")

    from agents.strat_reviewer import critique_strategy

    critique_result = await critique_strategy(body.strategy_json, body.map_name)
    return critique_result
