import logging
from pathlib import Path
import sys

# Ensure project root is in sys.path when executed directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from db.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_migrations():
    logger.info("Starting staging DB migrations...")
    columns = [
        ("user_id", "ALTER TABLE matches ADD COLUMN user_id VARCHAR(64);"),
        ("demo_filename", "ALTER TABLE matches ADD COLUMN demo_filename VARCHAR(255);"),
        ("coaching_notes", "ALTER TABLE matches ADD COLUMN coaching_notes TEXT;"),
        ("gcs_demo_uri", "ALTER TABLE matches ADD COLUMN gcs_demo_uri TEXT;"),
        ("gcs_audio_uri", "ALTER TABLE matches ADD COLUMN gcs_audio_uri TEXT;"),
        ("gcs_parsed_uri", "ALTER TABLE matches ADD COLUMN gcs_parsed_uri TEXT;"),
    ]
    for col_name, sql in columns:
        with engine.begin() as conn:
            try:
                conn.execute(text(sql))
                logger.info(f"Added {col_name} column to matches table")
            except Exception as e:
                logger.warning(f"Could not add {col_name} (might already exist): {e}")

    logger.info("Migrations complete!")

if __name__ == "__main__":
    run_migrations()
