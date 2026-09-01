"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
Coaching endpoint — triggers Great Khan AI analysis and returns cached results.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/{match_id}", summary="Trigger AI coaching for a match")
async def trigger_coaching(match_id: str, db: Session = Depends(get_session)):
    """
    Queue a coaching run for the match. Work happens in the coach worker
    (services/worker), not in a request-scoped background task — Cloud Run
    throttles CPU after the response is sent, which silently starved the
    old BackgroundTasks approach.
    """
    from db.jobs import enqueue_job  # noqa: PLC0415
    from db.models import JobKind  # noqa: PLC0415

    enqueue_job(db, match_id, JobKind.COACH)
    return {"status": "coaching_queued", "match_id": match_id}


@router.get("/{match_id}", summary="Get cached coaching notes for a match")
async def get_coaching(
    match_id: str,
    request: Request,
    user_id: str | None = None,
    uploader_steam_id: str | None = None,
db: Session = Depends(get_session)):
    """Return cached AI coaching output, or 202 if not ready yet."""
    try:
        from sqlalchemy import text  # noqa: PLC0415

        from db.models import Match, MatchStatus  # noqa: PLC0415
        match = db.query(Match).filter(Match.match_id == match_id).first()
        if not match:
            raise HTTPException(status_code=404, detail="Match not found")

        # Access check
        if match.team_id:
            if not user_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: Team match requires user authentication.",
                )
            member_check = db.execute(
                text(
                    "SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"
                ),
                {"team_id": match.team_id, "user_id": user_id},
            ).fetchone()
            if not member_check:
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: You are not a member of this team.",
                )
        else:
            if match.user_id and match.user_id != user_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: This match belongs to another user.",
                )

        # Self-healing: if uploader_steam_id is provided, match is owned by user,
        # and match doesn't have this Steam ID mapped, update it and invalidate cached coaching notes!
        is_owner = match.user_id == user_id
        if uploader_steam_id and is_owner and match.uploader_steam_id != uploader_steam_id:
            logger.info(
                f"[Coaching] Updating uploader_steam_id from {match.uploader_steam_id} to {uploader_steam_id} for match {match_id}. Clearing old coaching notes to force re-run."
            )
            match.uploader_steam_id = uploader_steam_id
            match.coaching_notes = None
            db.commit()

        if not match.coaching_notes:
            # Self-healing: queue a coaching job if the match is parsed but no
            # report exists. enqueue_job dedupes, so repeated polls are cheap.
            if match.status == MatchStatus.COMPLETE:
                from db.jobs import enqueue_job  # noqa: PLC0415
                from db.models import JobKind  # noqa: PLC0415

                enqueue_job(db, match_id, JobKind.COACH)

            return JSONResponse(
                status_code=202,
                content={"status": "pending", "match_id": match_id},
            )

        try:
            coaching_data = json.loads(match.coaching_notes)
        except (json.JSONDecodeError, TypeError):
            coaching_data = {
                "strat_card": match.coaching_notes,
                "player_reports": {},
                "coach_report": match.coaching_notes,
            }

        # Entitlement gating at read time: paywalled insights are omitted
        # from the payload server-side. Authority: subscriptions table →
        # x-user-plan header (trusted Next.js route) → FREE. Team matches
        # honor team-seat inheritance from a TEAM-tier owner.
        from services.billing import (  # noqa: PLC0415
            effective_entitlements,
            redact_coaching_payload,
            resolve_user_tier,
        )

        plan_header = request.headers.get("x-user-plan")
        ents = effective_entitlements(db, user_id, plan_header, team_id=match.team_id)
        coaching_data = redact_coaching_payload(coaching_data, ents)

        return {
            "status": "ready",
            "match_id": match_id,
            "coaching": coaching_data,
            "tier": resolve_user_tier(db, user_id, plan_header).value,
            "is_recon": getattr(match, "is_recon", False),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch coaching for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch coaching notes")


@router.get("/{match_id}/player/{player_name}", summary="Get coaching notes for a specific player")
async def get_player_coaching(match_id: str, player_name: str, request: Request, user_id: str | None = None, db: Session = Depends(get_session)):
    """Return only the Player Report section for a specific player."""
    try:
        from db.models import Match  # noqa: PLC0415
        match = db.query(Match).filter(Match.match_id == match_id).first()
        if not match:
            raise HTTPException(status_code=404, detail="Match not found")

        if not match.coaching_notes:
            return JSONResponse(
                status_code=202,
                content={"status": "pending", "match_id": match_id},
            )

        try:
            coaching_data = json.loads(match.coaching_notes)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=500, detail="Failed to parse coaching data")

        player_reports = coaching_data.get("player_reports", {})
        if player_name not in player_reports:
            raise HTTPException(
                status_code=404, detail=f"No report found for player {player_name}"
            )

        # Per-player deep dives require full coaching (Solo Pro and up).
        from services.billing import (  # noqa: PLC0415
            Entitlement,
            effective_entitlements,
            upgrade_metadata,
        )

        ents = effective_entitlements(
            db, user_id, request.headers.get("x-user-plan"), team_id=match.team_id
        )
        if Entitlement.FULL_COACHING not in ents:
            return JSONResponse(
                status_code=402,
                content={
                    "status": "locked",
                    "match_id": match_id,
                    "player": player_name,
                    **upgrade_metadata(Entitlement.FULL_COACHING),
                },
            )

        return {
            "status": "ready",
            "match_id": match_id,
            "player": player_name,
            "report": player_reports[player_name],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch player report for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch player report")


