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
        ("kills_attacker_team", "ALTER TABLE kills ALTER COLUMN attacker_team TYPE VARCHAR(64);"),
        ("kills_victim_team", "ALTER TABLE kills ALTER COLUMN victim_team TYPE VARCHAR(64);"),
        ("grenades_team", "ALTER TABLE grenades ALTER COLUMN team TYPE VARCHAR(64);"),
        ("rounds_winner_side", "ALTER TABLE rounds ALTER COLUMN winner_side TYPE VARCHAR(64);"),
        (
            "first_contacts_attacker_team",
            "ALTER TABLE first_contacts ALTER COLUMN attacker_team TYPE VARCHAR(64);",
        ),
        ("trajectories_team", "ALTER TABLE trajectories ALTER COLUMN team TYPE VARCHAR(64);"),
        ("teams_logo_url", "ALTER TABLE teams ADD COLUMN logo_url VARCHAR(512);"),
    ]
    for col_name, sql in columns:
        with engine.begin() as conn:
            try:
                conn.execute(text(sql))
                logger.info(f"Added/modified column/type for {col_name}")
            except Exception as e:
                logger.warning(f"Could not migrate {col_name}: {e}")

    logger.info("Migrations complete!")


if __name__ == "__main__":
    run_migrations()
