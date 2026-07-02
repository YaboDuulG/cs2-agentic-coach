"""
Migrate KnowledgeEmbedding rows from Postgres/pgvector to Qdrant.
"""

import json
import logging
import os
import sys
import uuid

# Add parent directory to path so imports work if run as script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from db.database import SessionLocal
from db.models import KnowledgeEmbedding
from db.qdrant_client import ensure_collections_exist, upsert_player_tendency, upsert_pro_tactic

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate():
    """Docstring for migrate."""
    ensure_collections_exist()
    db = SessionLocal()
    try:
        rows = db.query(KnowledgeEmbedding).all()
        logger.info(f"Found {len(rows)} embeddings to migrate.")

        for row in rows:
            # Prepare payload
            payload = {
                "content": row.content,
                "source": row.source,
            }
            if row.metadata_json:
                try:
                    metadata = json.loads(row.metadata_json)
                    payload.update(metadata)
                except Exception as e:
                    logger.warning(f"Could not parse metadata for row {row.id}: {e}")

            # Use a deterministic UUID based on row ID
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"knowledge_embedding_{row.id}"))

            # The embedding could be a string if it's from SQLite fallback, or list if pgvector
            vector = row.embedding
            if isinstance(vector, str):
                vector = json.loads(vector)

            if not isinstance(vector, list):
                logger.warning(f"Row {row.id} has invalid vector format, skipping.")
                continue

            # Determine which collection to insert into based on scope
            scope = payload.get("scope", "public")
            if scope == "public" or scope not in ["team", "individual"]:
                upsert_pro_tactic(point_id=point_id, vector=vector, payload=payload)
            else:
                upsert_player_tendency(point_id=point_id, vector=vector, payload=payload)

        logger.info("Migration complete.")
    finally:
        db.close()

if __name__ == "__main__":
    migrate()
