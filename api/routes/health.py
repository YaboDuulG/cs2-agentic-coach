"""
Health check endpoints — used by Cloud Run liveness/readiness probes.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Liveness probe")
async def health_check():
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe")
async def readiness_check():
    # TODO: Add DB connectivity check before marking ready
    return {"status": "ready"}
