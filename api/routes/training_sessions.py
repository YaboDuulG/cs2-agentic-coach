"""
Training Sessions API
======================
Tracks per-session training server usage: mode, map, region, duration.

Routes:
    POST /api/teams/{team_id}/training-sessions   - Create session on server spin-up
    GET  /api/teams/{team_id}/training-sessions   - List sessions + aggregate stats
    POST /api/training-sessions/{session_id}/end  - Close session (set ended_at + duration)
"""

from datetime import UTC, datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.database import get_session
from db.models import TeamMember, TrainingSession

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Auth helper (reused pattern from servers.py)
# ---------------------------------------------------------------------------


def _verify_team_member(db: Session, user_id: str, team_id: str) -> TeamMember:
    member = db.execute(
        select(TeamMember).where(
            TeamMember.user_id == user_id,
            TeamMember.team_id == team_id,
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this team.")
    return member


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SessionCreateRequest(BaseModel):
    server_id: str | None = None
    mode: str = "practice"
    map_name: str = "de_dust2"
    region: str = "dfw"


class SessionEndRequest(BaseModel):
    ended_at: datetime | None = None  # defaults to now if omitted


class SessionResponse(BaseModel):
    id: str
    team_id: str
    user_id: str
    server_id: str | None
    mode: str
    map_name: str
    region: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
    total_sessions: int
    total_seconds: int
    favourite_mode: str | None
    sessions_this_week: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/teams/{team_id}/training-sessions", response_model=SessionResponse)
def create_session(
    team_id: str,
    body: SessionCreateRequest,
    db: Session = Depends(get_session),
    user_id: str = "",
) -> SessionResponse:
    """Create a training session record when a server is spun up."""
    _verify_team_member(db, user_id, team_id)

    session = TrainingSession(
        id=str(uuid.uuid4()),
        team_id=team_id,
        user_id=user_id,
        server_id=body.server_id,
        mode=body.mode,
        map_name=body.map_name,
        region=body.region,
        started_at=datetime.now(UTC),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(f"[TrainingSession] Created {session.id} mode={body.mode} team={team_id}")
    return SessionResponse.model_validate(session)


@router.get("/teams/{team_id}/training-sessions", response_model=SessionListResponse)
def list_sessions(
    team_id: str,
    limit: int = 50,
    db: Session = Depends(get_session),
    user_id: str = "",
) -> SessionListResponse:
    """List training sessions for a team with aggregate stats."""
    _verify_team_member(db, user_id, team_id)

    sessions = db.execute(
        select(TrainingSession)
        .where(TrainingSession.team_id == team_id)
        .order_by(TrainingSession.started_at.desc())
        .limit(limit)
    ).scalars().all()

    total_seconds = sum(s.duration_seconds or 0 for s in sessions)

    # Favourite mode: mode with most sessions
    mode_counts: dict[str, int] = {}
    for s in sessions:
        mode_counts[s.mode] = mode_counts.get(s.mode, 0) + 1
    favourite_mode = max(mode_counts, key=lambda m: mode_counts[m]) if mode_counts else None

    # Sessions this week (Mon 00:00 UTC)
    now = datetime.now(UTC)
    week_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = week_start.replace(day=now.day - now.weekday())
    sessions_this_week = sum(1 for s in sessions if s.started_at >= week_start)

    return SessionListResponse(
        sessions=[SessionResponse.model_validate(s) for s in sessions],
        total_sessions=len(sessions),
        total_seconds=total_seconds,
        favourite_mode=favourite_mode,
        sessions_this_week=sessions_this_week,
    )


@router.post("/training-sessions/{session_id}/end", response_model=SessionResponse)
def end_session(
    session_id: str,
    body: SessionEndRequest,
    db: Session = Depends(get_session),
    user_id: str = "",
) -> SessionResponse:
    """Mark a session as ended and compute duration."""
    session = db.get(TrainingSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Training session not found.")
    if session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your session.")
    if session.ended_at is not None:
        return SessionResponse.model_validate(session)  # already closed

    ended = body.ended_at or datetime.now(UTC)
    session.ended_at = ended
    session.duration_seconds = int((ended - session.started_at).total_seconds())
    db.commit()
    db.refresh(session)
    logger.info(f"[TrainingSession] Ended {session_id} duration={session.duration_seconds}s")
    return SessionResponse.model_validate(session)
