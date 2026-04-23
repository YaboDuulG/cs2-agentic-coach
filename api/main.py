"""
Chinghis Scan — FastAPI Application Entry Point
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from api.routes import upload, health

load_dotenv()

app = FastAPI(
    title="Chinghis Scan API",
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


@app.get("/")
async def root():
    return {
        "service": "Chinghis Scan API",
        "version": "0.1.0",
        "status": "online",
        "environment": os.getenv("APP_ENV", "development"),
    }
