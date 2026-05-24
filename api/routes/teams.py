"""
Teams endpoints — create, join, list, and view team analyses.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateTeamRequest(BaseModel):
    name: str
    user_id: str


class JoinTeamRequest(BaseModel):
    invite_code: str
    user_id: str


@router.post("", summary="Create a new team")
async def create_team(body: CreateTeamRequest):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Team name cannot be empty")

    team_id = str(uuid.uuid4())
    # 8-char uppercase invite code
    invite_code = uuid.uuid4().hex[:8].upper()

    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            db.execute(
                text("""
                    INSERT INTO teams (id, name, owner_user_id, invite_code, created_at)
                    VALUES (:id, :name, :owner, :code, NOW())
                """),
                {
                    "id": team_id,
                    "name": body.name.strip(),
                    "owner": body.user_id,
                    "code": invite_code,
                },
            )
            db.execute(
                text("""
                    INSERT INTO team_members (team_id, user_id, role, joined_at)
                    VALUES (:team_id, :user_id, 'owner', NOW())
                """),
                {"team_id": team_id, "user_id": body.user_id},
            )
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to create team: {e}")
        raise HTTPException(status_code=500, detail="Failed to create team")

    return {"team_id": team_id, "name": body.name.strip(), "invite_code": invite_code}


@router.post("/join", summary="Join a team by invite code")
async def join_team(body: JoinTeamRequest):
    code = body.invite_code.strip().upper()
    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            row = db.execute(
                text("SELECT id, name FROM teams WHERE invite_code = :code"),
                {"code": code},
            ).fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Invalid invite code")

            team_id, team_name = row[0], row[1]

            # Idempotent — don't add twice
            existing = db.execute(
                text("SELECT id FROM team_members WHERE team_id = :tid AND user_id = :uid"),
                {"tid": team_id, "uid": body.user_id},
            ).fetchone()

            if not existing:
                db.execute(
                    text("""
                        INSERT INTO team_members (team_id, user_id, role, joined_at)
                        VALUES (:team_id, :user_id, 'member', NOW())
                    """),
                    {"team_id": team_id, "user_id": body.user_id},
                )
                db.commit()

            return {"team_id": team_id, "name": team_name, "status": "joined"}
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to join team: {e}")
        raise HTTPException(status_code=500, detail="Failed to join team")


@router.get("", summary="List teams for a user")
async def list_teams(user_id: str = ""):
    if not user_id:
        return []
    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            rows = db.execute(
                text("""
                    SELECT t.id, t.name, t.invite_code, t.owner_user_id, t.created_at,
                           COUNT(tm2.id) as member_count
                    FROM teams t
                    JOIN team_members tm ON t.id = tm.team_id
                    LEFT JOIN team_members tm2 ON t.id = tm2.team_id
                    WHERE tm.user_id = :user_id
                    GROUP BY t.id, t.name, t.invite_code, t.owner_user_id, t.created_at
                    ORDER BY t.created_at DESC
                """),
                {"user_id": user_id},
            ).fetchall()

            return [
                {
                    "team_id": r[0],
                    "name": r[1],
                    "invite_code": r[2],
                    "is_owner": r[3] == user_id,
                    "created_at": r[4].isoformat() if r[4] else None,
                    "member_count": r[5],
                }
                for r in rows
            ]
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to list teams for {user_id}: {e}")
        return []


@router.get("/{team_id}/analyses", summary="Get all analyses for a team")
async def team_analyses(team_id: str, user_id: str = ""):
    """Return matches from all team members, for any member of the team."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            # Verify requester is a member
            if user_id:
                member = db.execute(
                    text("SELECT id FROM team_members WHERE team_id = :tid AND user_id = :uid"),
                    {"tid": team_id, "uid": user_id},
                ).fetchone()
                if not member:
                    raise HTTPException(status_code=403, detail="Not a member of this team")

            rows = db.execute(
                text("""
                    SELECT m.match_id, m.map_name, m.status, m.created_at, m.user_id,
                           m.total_rounds
                    FROM matches m
                    JOIN team_members tm ON m.user_id = tm.user_id
                    WHERE tm.team_id = :team_id
                    ORDER BY m.created_at DESC
                    LIMIT 50
                """),
                {"team_id": team_id},
            ).fetchall()

            return [
                {
                    "match_id": r[0],
                    "map": r[1],
                    "status": r[2],
                    "created_at": r[3].isoformat() if r[3] else None,
                    "user_id": r[4],
                    "total_rounds": r[5],
                }
                for r in rows
            ]
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get team analyses: {e}")
        return []


@router.get("/{team_id}", summary="Get team details and members")
async def get_team(team_id: str):
    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            team = db.execute(
                text(
                    "SELECT id, name, invite_code, owner_user_id, created_at FROM teams WHERE id = :id"
                ),
                {"id": team_id},
            ).fetchone()
            if not team:
                raise HTTPException(status_code=404, detail="Team not found")

            members = db.execute(
                text(
                    "SELECT user_id, role, joined_at FROM team_members WHERE team_id = :tid ORDER BY joined_at"
                ),
                {"tid": team_id},
            ).fetchall()

            return {
                "team_id": team[0],
                "name": team[1],
                "invite_code": team[2],
                "owner_user_id": team[3],
                "created_at": team[4].isoformat() if team[4] else None,
                "members": [
                    {"user_id": m[0], "role": m[1], "joined_at": m[2].isoformat() if m[2] else None}
                    for m in members
                ],
            }
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get team {team_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch team")
