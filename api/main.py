"""
DemoSage — FastAPI Application Entry Point
"""

import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.auth import get_current_user
from api.routes import (
    admin,
    analyses,
    chat,
    coaching,
    discord,
    faceit,
    fcr,
    health,
    jobs,
    oauth,
    presign,
    servers,
    stratbook,
    strats,
    teams,
    training_sessions,
    upload,
    webhooks,
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

# CORS Lockdown
# Read from environment, default to production domains if not set
cors_origins_env = os.getenv("ALLOWED_ORIGINS", "")
if cors_origins_env:
    ALLOWED_ORIGINS = [orig.strip() for orig in cors_origins_env.split(",")]
else:
    # Production defaults (localhost excluded by default in production)
    ALLOWED_ORIGINS = [
        "https://demosage.gg",
        "https://www.demosage.gg",
        "https://cs2-agentic-coach.vercel.app"
    ]
    if os.getenv("APP_ENV") == "development":
        ALLOWED_ORIGINS.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    presign.router,
    prefix="/api/upload",
    tags=["Upload"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    jobs.router, prefix="/api/jobs", tags=["Jobs"], dependencies=[Depends(get_current_user)]
)
app.include_router(
    analyses.router,
    prefix="/api/analyses",
    tags=["Analyses"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    admin.router,
    prefix="/api/admin",
    tags=["Admin"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    coaching.router,
    prefix="/api/coaching",
    tags=["Coaching"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    teams.router, prefix="/api/teams", tags=["Teams"], dependencies=[Depends(get_current_user)]
)
app.include_router(
    servers.router, prefix="/api", tags=["Servers"], dependencies=[Depends(get_current_user)]
)
app.include_router(
    training_sessions.router,
    prefix="/api",
    tags=["TrainingSessions"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    faceit.router,
    prefix="/api/faceit",
    tags=["FACEIT"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    fcr.router, prefix="/api", tags=["FCR"], dependencies=[Depends(get_current_user)]
)
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["Webhooks"])
app.include_router(discord.router, prefix="/api/discord", tags=["Discord"])
# Discord interactions endpoint — authenticated by Ed25519 request signatures,
# NOT Clerk (Discord is the caller), so no get_current_user dependency here.
from services.discord_bot import interactions as discord_interactions  # noqa: E402

app.include_router(discord_interactions.router, prefix="/api/discord", tags=["Discord"])
app.include_router(
    chat.router, prefix="/api/chat", tags=["Chat"], dependencies=[Depends(get_current_user)]
)
app.include_router(
    stratbook.router,
    prefix="/api/stratbook",
    tags=["Stratbook"],
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    strats.router,
    prefix="/api/strats",
    tags=["Strats"],
    dependencies=[Depends(get_current_user)],
)


# OAuth routes — no global auth dependency; individual endpoints manage auth where needed
app.include_router(oauth.router, prefix="/api/oauth", tags=["OAuth"])


@app.get("/")
async def root():
    """Docstring for root."""
    return {
        "service": "DemoSage API",
        "version": "0.1.0",
        "status": "online",
        "environment": os.getenv("APP_ENV", "development"),
    }
