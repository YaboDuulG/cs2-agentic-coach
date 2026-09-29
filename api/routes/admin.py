"""Module docstring."""
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
from db.models import SystemConfig

router = APIRouter()


class UpdateConfigsRequest(BaseModel):
    """Docstring for UpdateConfigsRequest."""
    configs: dict[str, str]


@router.get("/configs", summary="Get all dynamic LLM configurations and prompts")
async def get_admin_configs(db: Session = Depends(get_session)):
    """Docstring for get_admin_configs."""
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
    """Docstring for update_admin_configs."""
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


class CreateTrialCodesRequest(BaseModel):
    """Docstring for CreateTrialCodesRequest."""
    count: int = 5
    tier: str = "SOLO_PRO"
    days: int = 7
    max_uses: int | None = 1
    valid_days: int = 14
    note: str | None = None


def _promo_dict(row) -> dict:
    """Docstring for _promo_dict."""
    return {
        "code": row.code,
        "kind": row.kind,
        "tier": row.tier,
        "days": row.days,
        "max_uses": row.max_uses,
        "uses": row.uses,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "active": row.active,
        "note": row.note,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.post("/promo-codes", summary="Mint trial codes")
async def create_promo_codes(
    body: CreateTrialCodesRequest, user_id: str = "", db: Session = Depends(get_session)
):
    """Admin-only by way of the Next.js route (Clerk role check); the FastAPI
    side is reachable only with the shared secret."""
    from services.billing import Tier, create_trial_codes  # noqa: PLC0415

    try:
        tier = Tier(body.tier.upper())
    except ValueError:
        raise HTTPException(status_code=400, detail="tier must be SOLO_PRO or TEAM")
    if tier is Tier.FREE:
        raise HTTPException(status_code=400, detail="tier must be SOLO_PRO or TEAM")
    if not 1 <= body.days <= 365:
        raise HTTPException(status_code=400, detail="days must be 1–365")
    rows = create_trial_codes(
        db,
        count=body.count,
        tier=tier,
        days=body.days,
        max_uses=body.max_uses,
        valid_days=body.valid_days,
        created_by=user_id or None,
        note=body.note,
    )
    return {"codes": [_promo_dict(r) for r in rows]}


@router.get("/promo-codes", summary="List trial codes, newest first")
async def list_promo_codes(limit: int = 100, db: Session = Depends(get_session)):
    """Docstring for list_promo_codes."""
    from db.models import PromoCode  # noqa: PLC0415

    rows = (
        db.query(PromoCode)
        .filter(PromoCode.kind == "trial")
        .order_by(PromoCode.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return {"codes": [_promo_dict(r) for r in rows]}


@router.get("/team-metering", summary="Per-team Gemini spend, server hours, and margin")
async def team_metering_endpoint(window: str = "season", db: Session = Depends(get_session)):
    """window: season (default) | 30d | 90d | all. Admin-only via the Next.js route."""
    from services.billing.metering import team_metering  # noqa: PLC0415

    if window not in ("season", "30d", "90d", "all"):
        raise HTTPException(status_code=400, detail="window must be season, 30d, 90d or all")
    return team_metering(db, window)


@router.get("/dathost-account", summary="DatHost credits and servers currently on")
async def dathost_account():
    """Never raises: the metering panel shows 'unavailable' on any failure."""
    import os  # noqa: PLC0415

    if os.getenv("LOCAL_MODE", "false").lower() == "true" and not os.getenv("DATHOST_EMAIL"):
        return {"available": False, "reason": "LOCAL_MODE without DatHost credentials"}
    try:
        from services.warlord.dathost_client import get_account  # noqa: PLC0415

        return {"available": True, **get_account()}
    except Exception as e:
        return {"available": False, "reason": str(e)[:200]}


@router.get("/qdrant-quota", summary="Check Qdrant vector quota")
def get_qdrant_quota():
    """Returns Qdrant vector count and warns if approaching 8M limit."""
    try:
        from db.qdrant_client import check_vector_quota  # noqa: PLC0415
        return check_vector_quota()
    except Exception as e:
        return {"error": str(e), "warning": False}
