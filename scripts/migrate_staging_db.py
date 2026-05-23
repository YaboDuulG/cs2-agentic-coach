import logging

from sqlalchemy import text

from db.database import engine

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

        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN coaching_notes TEXT;"))
            logger.info("Added coaching_notes column to matches table")
        except Exception as e:
            logger.warning(f"Could not add coaching_notes (might already exist): {e}")

        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN gcs_demo_uri TEXT;"))
            logger.info("Added gcs_demo_uri column to matches table")
        except Exception as e:
            logger.warning(f"Could not add gcs_demo_uri (might already exist): {e}")

        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN gcs_audio_uri TEXT;"))
            logger.info("Added gcs_audio_uri column to matches table")
        except Exception as e:
            logger.warning(f"Could not add gcs_audio_uri (might already exist): {e}")

        try:
            conn.execute(text("ALTER TABLE matches ADD COLUMN gcs_parsed_uri TEXT;"))
            logger.info("Added gcs_parsed_uri column to matches table")
        except Exception as e:
            logger.warning(f"Could not add gcs_parsed_uri (might already exist): {e}")

    logger.info("Migrations complete!")

if __name__ == "__main__":
    run_migrations()
