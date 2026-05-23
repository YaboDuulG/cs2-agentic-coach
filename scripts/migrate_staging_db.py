import os
import logging
from db.database import engine
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_migrations():
    logger.info("Starting staging DB migrations...")
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN user_id VARCHAR(64);"))
            logger.info("Added user_id column to matches table")
        except Exception as e:
            logger.warning(f"Could not add user_id (might already exist): {e}")
            
        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN demo_filename VARCHAR(255);"))
            logger.info("Added demo_filename column to matches table")
        except Exception as e:
            logger.warning(f"Could not add demo_filename (might already exist): {e}")
            
    logger.info("Migrations complete!")

if __name__ == "__main__":
    run_migrations()
