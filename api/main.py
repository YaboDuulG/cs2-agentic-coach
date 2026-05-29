"""
DemoSage — FastAPI Application Entry Point
"""

import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.auth import verify_shared_secret
from api.routes import (
    analyses,
    coaching,
    discord,
    faceit,
    fcr,
    health,
    jobs,
    presign,
    servers,
    teams,
    training_sessions,
    upload,
)

load_dotenv()

app = FastAPI(
    title="DemoSage API",
    description="CS2 Agentic Coaching Platform — Backend API",
    version="0.1.0",
)

# Ensure data/logos exists and mount it for local development
os.makedirs("data/logos", exist_ok=True)
app.mount("/logos", StaticFiles(directory="data/logos"), name="logos")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(
    upload.router,
    prefix="/api/upload",
    tags=["Upload"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    presign.router,
    prefix="/api/upload",
    tags=["Upload"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    jobs.router, prefix="/api/jobs", tags=["Jobs"], dependencies=[Depends(verify_shared_secret)]
)
app.include_router(
    analyses.router,
    prefix="/api/analyses",
    tags=["Analyses"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    coaching.router,
    prefix="/api/coaching",
    tags=["Coaching"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    teams.router, prefix="/api/teams", tags=["Teams"], dependencies=[Depends(verify_shared_secret)]
)
app.include_router(
    servers.router, prefix="/api", tags=["Servers"], dependencies=[Depends(verify_shared_secret)]
)
app.include_router(
    training_sessions.router,
    prefix="/api",
    tags=["TrainingSessions"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    faceit.router,
    prefix="/api/faceit",
    tags=["FACEIT"],
    dependencies=[Depends(verify_shared_secret)],
)
app.include_router(
    fcr.router, prefix="/api", tags=["FCR"], dependencies=[Depends(verify_shared_secret)]
)
app.include_router(
    discord.router, prefix="/api/discord", tags=["Discord"]
)


@app.get("/")
async def root():
    return {
        "service": "DemoSage API",
        "version": "0.1.0",
        "status": "online",
        "environment": os.getenv("APP_ENV", "development"),
    }
