"""
DemoSage — FastAPI Application Entry Point
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import analyses, coaching, health, jobs, presign, servers, teams, upload

load_dotenv()

app = FastAPI(
    title="DemoSage API",
    description="CS2 Agentic Coaching Platform — Backend API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(upload.router, prefix="/api/upload", tags=["Upload"])
app.include_router(presign.router, prefix="/api/upload", tags=["Upload"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["Jobs"])
app.include_router(analyses.router, prefix="/api/analyses", tags=["Analyses"])
app.include_router(coaching.router, prefix="/api/coaching", tags=["Coaching"])
app.include_router(teams.router, prefix="/api/teams", tags=["Teams"])
app.include_router(servers.router, prefix="/api", tags=["Servers"])



@app.get("/")
async def root():
    return {
        "service": "DemoSage API",
        "version": "0.1.0",
        "status": "online",
        "environment": os.getenv("APP_ENV", "development"),
    }
