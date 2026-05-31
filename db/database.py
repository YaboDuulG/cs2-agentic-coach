"""
DemoSage — Database Engine & Session
=====================================
Provides the SQLAlchemy engine and session factory.

In production (GCP Cloud SQL):  DATABASE_URL from env (PostgreSQL + pgvector)
In local dev:                    DATABASE_URL_LOCAL from env (local PostgreSQL via docker-compose)
In CI / unit tests:              Falls back to in-memory SQLite (no native deps needed)

Usage:
    from db.database import get_session, engine
    from db.models import Base
    Base.metadata.create_all(engine)      # creates all tables
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Resolution order: explicit test override → local dev → cloud SQL → SQLite fallback
_DATABASE_URL = (
    os.getenv("DATABASE_URL_TEST")  # CI / unit tests: sqlite:///:memory:
    or os.getenv("DATABASE_URL_LOCAL")  # Local docker-compose postgres
    or os.getenv("DATABASE_URL")  # GCP Cloud SQL (production / Cloud Run)
    or "sqlite:///:memory:"  # Last resort — no config needed
)

_is_sqlite = _DATABASE_URL.startswith("sqlite")

# SQLite needs check_same_thread=False for FastAPI; PostgreSQL ignores connect_args
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

# PostgreSQL pool settings — prevent stale connections on Cloud Run cold starts
# SQLite doesn't support pool_size/max_overflow so we skip them
_pool_kwargs = (
    {}
    if _is_sqlite
    else {
        "pool_size": 5,
        "max_overflow": 10,
        "pool_pre_ping": True,  # Verifies connections are alive before use
        "pool_recycle": 300,   # Recycle connections every 5 min (Cloud SQL drops idle)
    }
)

engine = create_engine(
    _DATABASE_URL,
    connect_args=_connect_args,
    echo=os.getenv("APP_ENV") == "development",
    **_pool_kwargs,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_session():
    """
    FastAPI dependency — yields a DB session and ensures it's closed after the request.

    Usage:
        @router.get("/example")
        async def example(db: Session = Depends(get_session)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
