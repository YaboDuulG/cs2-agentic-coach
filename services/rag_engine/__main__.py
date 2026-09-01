"""python -m services.rag_engine — run one HLTV ingestion cycle and exit."""

import logging
import os

from db.database import SessionLocal, engine
from services.rag_engine.worker import run_ingestion_cycle


def main() -> None:
    """Docstring for main."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if os.getenv("LOCAL_MODE", "false").lower() == "true":
        # Local convenience only — deployed schemas are managed by Alembic.
        from db.models import Base  # noqa: PLC0415

        Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        summary = run_ingestion_cycle(db)
        print(summary)
    finally:
        db.close()


if __name__ == "__main__":
    main()
