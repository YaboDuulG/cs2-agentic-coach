"""Module docstring."""
from datetime import UTC, datetime, timedelta
import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.database import get_session
from db.models import PracticeServer, TeamMember
from services.billing import Entitlement, effective_entitlements, upgrade_metadata
from services.warlord.dathost_client import (
    TRAINING_MODE_CONFIGS,
    DatHostCreditsError,
    check_cs2_update_active,
    destroy_practice_server,
    get_available_modes,
    provision_practice_server,
    read_console,
    send_console_command,
)

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_MODES = list(TRAINING_MODE_CONFIGS.keys())


class ServerCreateRequest(BaseModel):
    """Docstring for ServerCreateRequest."""
    model_config = ConfigDict(populate_by_name=True)

    mode: str = "practice"
    region: str = "eu"  # "eu" or "na"
    map_name: str = Field(default="de_dust2", alias="map")


class ServerResponse(BaseModel):
    """Docstring for ServerResponse."""
    id: str
    status: str
    ip_address: Optional[str] = None
    rcon_password: str
    server_password: str
    mode: str
    expires_at: datetime


def _verify_team_member(db: Session, user_id: str, team_id: str):
    """Docstring for _verify_team_member."""
    member = db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this team")
    return member


def _require_team_plan(db: Session, request: Request, user_id: str, team_id: str) -> None:
    """Practice servers are a Team feature: 402 with upgrade metadata unless the
    caller (or the team's owner, through seat inheritance) holds the season."""
    ents = effective_entitlements(db, user_id, request.headers.get("x-user-plan"), team_id)
    if Entitlement.TEAM_ANALYSIS not in ents:
        raise HTTPException(status_code=402, detail=upgrade_metadata(Entitlement.TEAM_ANALYSIS))


def _load_server_for_member(db: Session, request: Request, server_id: str) -> PracticeServer:
    """Docstring for _load_server_for_member."""
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    server = db.execute(
        select(PracticeServer).where(PracticeServer.id == server_id)
    ).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    _verify_team_member(db, user_id, server.team_id)
    return server


def _console_host_id(server: PracticeServer) -> str:
    """The DatHost id behind a server row, or 409/503 when there is no console."""
    if server.status not in ("booting", "active"):
        raise HTTPException(status_code=409, detail="This server is not running")
    host_id = server.vultr_instance_id or ""
    if not host_id or host_id.startswith(("local-", "mock-")):
        raise HTTPException(status_code=503, detail="No console for a local server")
    return host_id


@router.get("/servers/modes")
def list_training_modes():
    """Returns available training modes and live CS2 update status."""
    is_active, detail = check_cs2_update_active()
    return {
        "modes": get_available_modes(),
        "update_window_active": is_active,
        "update_detail": detail,
    }


@router.post("/teams/{team_id}/servers", response_model=ServerResponse)
def spin_up_server(
    team_id: str,
    req_body: ServerCreateRequest,
    request: Request,
    db: Session = Depends(get_session),
):
    """Docstring for spin_up_server."""
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    _verify_team_member(db, user_id, team_id)
    _require_team_plan(db, request, user_id, team_id)

    # Validate mode
    if req_body.mode not in VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode '{req_body.mode}'. Valid modes: {VALID_MODES}",
        )

    # Check if team already has an active server
    active_server = db.execute(
        select(PracticeServer).where(
            PracticeServer.team_id == team_id, PracticeServer.status.in_(["booting", "active"])
        )
    ).scalar_one_or_none()

    if active_server:
        raise HTTPException(
            status_code=400, detail="Team already has an active server. Terminate it first."
        )

    import uuid

    server_id = str(uuid.uuid4())
    webhook_url = f"{request.base_url}api/servers/webhook"

    try:
        local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
        if local_mode:
            vultr_data = {
                "vultr_id": f"local-{server_id}",
                "ip_address": "127.0.0.1:27015",
                "rcon_password": "local_rcon_pass",
                "server_password": "local_server_pass",
            }
        else:
            vultr_data = provision_practice_server(
                server_id,
                webhook_url,
                region=req_body.region,
                mode=req_body.mode,
                map_name=req_body.map_name,
            )
    except DatHostCreditsError as e:
        # Out of credits: 402 so the UI can say why. No server row, no session.
        logger.error(f"DatHost credits exhausted for team {team_id}: {e}")
        raise HTTPException(status_code=402, detail=str(e))
    except ValueError as e:
        err_str = str(e)
        logger.exception(f"ValueError spinning up server: {err_str}")
        # Tuesday update window — surface as 503 Service Unavailable
        if "maintenance window" in err_str:
            raise HTTPException(status_code=503, detail=err_str)
        raise HTTPException(status_code=500, detail=err_str)
    except Exception as e:
        logger.exception(f"Unhandled exception spinning up server: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    new_server = PracticeServer(
        id=server_id,
        team_id=team_id,
        vultr_instance_id=vultr_data["vultr_id"],
        ip_address=vultr_data["ip_address"],
        rcon_password=vultr_data["rcon_password"],
        server_password=vultr_data["server_password"],
        mode=req_body.mode,
        expires_at=datetime.now(UTC) + timedelta(hours=2),
        status="active",
    )

    db.add(new_server)
    db.commit()
    db.refresh(new_server)

    return new_server


@router.get("/teams/{team_id}/servers", response_model=List[ServerResponse])
def list_servers(team_id: str, request: Request, db: Session = Depends(get_session)):
    """Docstring for list_servers."""
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    _verify_team_member(db, user_id, team_id)

    servers = (
        db.execute(
            select(PracticeServer).where(
                PracticeServer.team_id == team_id, PracticeServer.status != "terminated"
            )
        )
        .scalars()
        .all()
    )

    return servers


@router.delete("/servers/{server_id}")
def terminate_server(server_id: str, request: Request, db: Session = Depends(get_session)):
    """Docstring for terminate_server."""
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    server = db.execute(
        select(PracticeServer).where(PracticeServer.id == server_id)
    ).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    _verify_team_member(db, user_id, server.team_id)

    if server.vultr_instance_id:
        local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
        if not local_mode:
            destroy_practice_server(server.vultr_instance_id)

    server.status = "terminated"

    db.commit()
    return {"status": "terminated"}


class ConsoleCommand(BaseModel):
    """Docstring for ConsoleCommand."""
    command: str = Field(min_length=1, max_length=200)


@router.get("/servers/{server_id}/console")
def get_console(
    server_id: str, request: Request, lines: int = 50, db: Session = Depends(get_session)
):
    """Last lines of the server console, for any member of the team."""
    server = _load_server_for_member(db, request, server_id)
    host_id = _console_host_id(server)
    try:
        return {"lines": read_console(host_id, max_lines=max(1, min(lines, 200)))}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/servers/{server_id}/console")
def post_console(
    server_id: str, body: ConsoleCommand, request: Request, db: Session = Depends(get_session)
):
    """Run one raw console command (RCON) on the team's server and return the
    console tail so the caller sees the response."""
    server = _load_server_for_member(db, request, server_id)
    host_id = _console_host_id(server)
    command = body.command.strip()
    if not command or "\n" in command:
        raise HTTPException(status_code=400, detail="One command per request")
    try:
        send_console_command(host_id, command)
        return {"ok": True, "lines": read_console(host_id, max_lines=50)}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))


class WebhookPayload(BaseModel):
    """Docstring for WebhookPayload."""
    server_id: str
    status: str


@router.post("/servers/webhook", include_in_schema=False)
def server_webhook(payload: WebhookPayload, db: Session = Depends(get_session)):
    """Receives ping from cloud-init when CS2 is up."""
    server = db.execute(
        select(PracticeServer).where(PracticeServer.id == payload.server_id)
    ).scalar_one_or_none()
    if server:
        server.status = payload.status
        db.commit()
    return {"ok": True}


@router.post("/servers/cron/cleanup", include_in_schema=False)
def cron_cleanup(request: Request, db: Session = Depends(get_session)):
    """Vercel cron endpoint to destroy expired servers."""
    auth_header = request.headers.get("Authorization")
    if auth_header != f"Bearer {os.environ.get('CRON_SECRET')}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    expired = (
        db.execute(
            select(PracticeServer).where(
                PracticeServer.expires_at < datetime.now(UTC), PracticeServer.status != "terminated"
            )
        )
        .scalars()
        .all()
    )

    count = 0
    for srv in expired:
        if srv.vultr_instance_id:
            try:
                destroy_practice_server(srv.vultr_instance_id)
                srv.status = "terminated"

                count += 1
            except Exception as e:
                logger.error(f"Failed to cleanup {srv.id}: {e}")

    db.commit()
    return {"terminated_count": count}
