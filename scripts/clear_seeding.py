"""
Clear Seeding Script
====================
Wipes all existing "hltv_pro_match" embeddings and their corresponding Match records from the database.
"""

import json
import logging
import os
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("clear_seeding")

# Load environment variables
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models import KnowledgeEmbedding, Match


def main():
    db = SessionLocal()
    try:
        logger.info("Fetching hltv_pro_match embeddings...")
        embeddings = db.query(KnowledgeEmbedding).filter(
            KnowledgeEmbedding.source == "hltv_pro_match"
        ).all()

        match_ids = set()
        for emb in embeddings:
            if emb.metadata_json:
                try:
                    meta = json.loads(emb.metadata_json)
                    m_id = meta.get("match_id")
                    if m_id:
                        match_ids.add(m_id)
                except Exception:
                    pass

        if match_ids:
            logger.info(f"Deleting {len(match_ids)} pro matches from the database...")
            # Deleting Match rows cascades to delete rounds, kills, etc.
            deleted_matches = db.query(Match).filter(Match.match_id.in_(match_ids)).delete(
                synchronize_session=False
            )
            logger.info(f"Successfully deleted {deleted_matches} Match rows.")
        else:
            logger.info("No matching pro matches found in database.")

        logger.info("Deleting all hltv_pro_match embeddings...")
        deleted_embs = db.query(KnowledgeEmbedding).filter(
            KnowledgeEmbedding.source == "hltv_pro_match"
        ).delete(synchronize_session=False)
        logger.info(f"Successfully deleted {deleted_embs} hltv_pro_match embedding rows.")

        db.commit()
        logger.info("Wipe complete.")

    except Exception as e:
        db.rollback()
        logger.error(f"Error while clearing seeding: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
