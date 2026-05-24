import logging
from pathlib import Path
import sys

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from db.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_migrations():
    logger.info("Starting database migrations for SteamIDs and Player Stats...")
    
    statements = [
        # Alter table kills
        ("kills_attacker_steamid", "ALTER TABLE kills ADD COLUMN IF NOT EXISTS attacker_steamid VARCHAR(32);"),
        ("kills_victim_steamid", "ALTER TABLE kills ADD COLUMN IF NOT EXISTS victim_steamid VARCHAR(32);"),
        
        # Alter table first_contacts
        ("first_contacts_attacker_steamid", "ALTER TABLE first_contacts ADD COLUMN IF NOT EXISTS attacker_steamid VARCHAR(32);"),
        ("first_contacts_victim_steamid", "ALTER TABLE first_contacts ADD COLUMN IF NOT EXISTS victim_steamid VARCHAR(32);"),
        
        # Alter table matches
        ("matches_player_stats_json", "ALTER TABLE matches ADD COLUMN IF NOT EXISTS player_stats_json TEXT;"),
    ]
    
    for label, sql in statements:
        with engine.begin() as conn:
            try:
                conn.execute(text(sql))
                logger.info(f"Success: {label}")
            except Exception as e:
                logger.warning(f"Failed / Already done ({label}): {e}")

    logger.info("Migrations complete!")

if __name__ == "__main__":
    run_migrations()
