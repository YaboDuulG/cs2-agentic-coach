from fastapi import Depends
from sqlalchemy.orm import Session
from db.database import get_session
"""
DemoSage — Admin configurations endpoints
==========================================
Enables retrieving and saving dynamically configurable prompts and model settings.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.config import DEFAULTS
from db.database import SessionLocal
from db.models import SystemConfig

router = APIRouter()


class UpdateConfigsRequest(BaseModel):
    configs: dict[str, str]


@router.get("/configs", summary="Get all dynamic LLM configurations and prompts")
async def get_admin_configs(db: Session = Depends(get_session)):
    try:
        rows = db.query(SystemConfig).all()
        db_configs = {r.key: r.value for r in rows}

        # Merge system defaults with database values
        merged = {}
        for key, val in DEFAULTS.items():
            merged[key] = db_configs.get(key, val)
        return merged
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch system configs: {e}")


@router.post("/configs", summary="Save LLM configurations and prompt directives")
async def update_admin_configs(body: UpdateConfigsRequest, db: Session = Depends(get_session)):
    try:
        for key, val in body.configs.items():
            # Restrict saving to verified default keys to prevent DB pollution
            if key not in DEFAULTS:
                continue
            config_obj = db.query(SystemConfig).filter(SystemConfig.key == key).first()
            if config_obj:
                config_obj.value = val
            else:
                config_obj = SystemConfig(key=key, value=val)
                db.add(config_obj)
        db.commit()
        return {"status": "success"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save system configs: {e}")


@router.get("/qdrant-quota", summary="Check Qdrant vector quota")
def get_qdrant_quota():
    """Returns Qdrant vector count and warns if approaching 8M limit."""
    try:
        from db.qdrant_client import check_vector_quota  # noqa: PLC0415
        return check_vector_quota()
    except Exception as e:
        return {"error": str(e), "warning": False}
