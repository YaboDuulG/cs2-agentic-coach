import os
from datetime import UTC, datetime, timedelta
import logging

from typing import List, Optional
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Request

from db.database import get_db
from sqlalchemy.orm import Session
from sqlalchemy import select

from db.models import PracticeServer, TeamMember
from services.warlord.vultr_client import provision_practice_server, destroy_practice_server

logger = logging.getLogger(__name__)

router = APIRouter()

class ServerCreateRequest(BaseModel):
    mode: str = "practice"
    region: str = "eu" # "eu" or "na"

class ServerResponse(BaseModel):
    id: str
    status: str
    ip_address: Optional[str] = None
    rcon_password: str
    server_password: str
    mode: str
    expires_at: datetime

def _verify_team_member(db: Session, user_id: str, team_id: str):
    member = db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this team")
    return member

@router.post("/teams/{team_id}/servers", response_model=ServerResponse)
def spin_up_server(team_id: str, req_body: ServerCreateRequest, request: Request, db: Session = Depends(get_db)):
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    _verify_team_member(db, user_id, team_id)
    
    # Check if team already has an active server
    active_server = db.execute(
        select(PracticeServer).where(PracticeServer.team_id == team_id, PracticeServer.status.in_(["booting", "active"]))
    ).scalar_one_or_none()
    
    if active_server:
        raise HTTPException(status_code=400, detail="Team already has an active server. Terminate it first.")
        
    # Generate an ID for the server record
    import uuid
    server_id = str(uuid.uuid4())
    
    # Provision via Hetzner
    # In a real app, we would dynamically set region based on req_body.region
    webhook_url = f"{request.base_url}api/servers/webhook"
    
    try:
        vultr_data = provision_practice_server(server_id, webhook_url, region=req_body.region)
    except Exception as e:

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
        status="booting"
    )

    
    db.add(new_server)
    db.commit()
    db.refresh(new_server)
    
    return new_server

@router.get("/teams/{team_id}/servers", response_model=List[ServerResponse])
def list_servers(team_id: str, request: Request, db: Session = Depends(get_db)):
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    _verify_team_member(db, user_id, team_id)
    
    servers = db.execute(
        select(PracticeServer).where(PracticeServer.team_id == team_id, PracticeServer.status != "terminated")
    ).scalars().all()
    
    return servers

@router.delete("/servers/{server_id}")
def terminate_server(server_id: str, request: Request, db: Session = Depends(get_db)):
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    server = db.execute(select(PracticeServer).where(PracticeServer.id == server_id)).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    _verify_team_member(db, user_id, server.team_id)
    
    if server.vultr_instance_id:
        destroy_practice_server(server.vultr_instance_id)
        
    server.status = "terminated"

    db.commit()
    return {"status": "terminated"}

class WebhookPayload(BaseModel):
    server_id: str
    status: str

@router.post("/servers/webhook", include_in_schema=False)
def server_webhook(payload: WebhookPayload, db: Session = Depends(get_db)):
    """Receives ping from cloud-init when CS2 is up."""
    server = db.execute(select(PracticeServer).where(PracticeServer.id == payload.server_id)).scalar_one_or_none()
    if server:
        server.status = payload.status
        db.commit()
    return {"ok": True}

@router.post("/servers/cron/cleanup", include_in_schema=False)
def cron_cleanup(request: Request, db: Session = Depends(get_db)):
    """Vercel cron endpoint to destroy expired servers."""
    auth_header = request.headers.get("Authorization")
    if auth_header != f"Bearer {os.environ.get('CRON_SECRET')}":
        if auth_header != f"Bearer {os.environ.get('CRON_SECRET')}":
            raise HTTPException(status_code=401, detail="Unauthorized")


    expired = db.execute(
        select(PracticeServer).where(PracticeServer.expires_at < datetime.now(UTC), PracticeServer.status != "terminated")
    ).scalars().all()
    
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
