"""
Qdrant Cloud client setup for DemoSage.

Collections:
  pro_playbook      — HLTV pro match tactical embeddings (shared, public)
  player_tendency   — Per-player tendency embeddings (scoped by user_id/team_id)

Vector size: 768 (text-embedding-004)
Distance: Cosine
"""

from functools import lru_cache
import logging
import os

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
)

logger = logging.getLogger(__name__)

QDRANT_URL = os.environ.get("QDRANT_URL", "")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")

VECTOR_SIZE = 768  # text-embedding-004
COLLECTION_PRO_PLAYBOOK = "pro_playbook"
COLLECTION_PLAYER_TENDENCY = "player_tendency"

# 8M vector warning threshold (per spec)
VECTOR_QUOTA_WARN_THRESHOLD = 8_000_000


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    """Singleton Qdrant Cloud client."""
    if not QDRANT_URL or not QDRANT_API_KEY:
        raise RuntimeError(
            "QDRANT_URL and QDRANT_API_KEY must be set. "
            "Get these from your Qdrant Cloud dashboard at https://cloud.qdrant.io"
        )
    return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)


def ensure_collections_exist() -> None:
    """Idempotently create the two DemoSage collections if they don't exist."""
    client = get_qdrant_client()
    existing = {c.name for c in client.get_collections().collections}

    for name in [COLLECTION_PRO_PLAYBOOK, COLLECTION_PLAYER_TENDENCY]:
        if name not in existing:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )
            logger.info(f"Created Qdrant collection: {name}")
        else:
            logger.info(f"Qdrant collection already exists: {name}")


def upsert_pro_tactic(point_id: str, vector: list[float], payload: dict) -> None:
    """Insert or update a pro match tactic embedding."""
    from qdrant_client.models import PointStruct
    client = get_qdrant_client()
    payload["scope"] = "public"  # Pro tactics are always public
    client.upsert(
        collection_name=COLLECTION_PRO_PLAYBOOK,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)]
    )


def upsert_player_tendency(point_id: str, vector: list[float], payload: dict) -> None:
    """Insert or update a player tendency embedding."""
    from qdrant_client.models import PointStruct
    client = get_qdrant_client()
    # payload must contain user_id or team_id for namespace isolation
    client.upsert(
        collection_name=COLLECTION_PLAYER_TENDENCY,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)]
    )


def search_pro_tactics(
    query_vector: list[float],
    map_name: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """
    Search pro_playbook collection.
    Optionally filter by map_name.
    All results are public scope.
    """
    client = get_qdrant_client()
    filter_conditions = {"must": [{"key": "scope", "match": {"value": "public"}}]}
    if map_name:
        filter_conditions["must"].append({"key": "map_name", "match": {"value": map_name}})

    results = client.search(
        collection_name=COLLECTION_PRO_PLAYBOOK,
        query_vector=query_vector,
        query_filter=filter_conditions,
        limit=limit,
        with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in results]


def search_player_tendencies(
    query_vector: list[float],
    user_id: str | None = None,
    team_id: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """
    Search player_tendency collection with strict namespace isolation.
    Only returns vectors matching user_id or team_id.
    """
    client = get_qdrant_client()
    must_conditions = []
    if user_id:
        must_conditions.append({"key": "user_id", "match": {"value": user_id}})
    elif team_id:
        must_conditions.append({"key": "team_id", "match": {"value": team_id}})
    else:
        raise ValueError("Must provide either user_id or team_id for player tendency search")

    results = client.search(
        collection_name=COLLECTION_PLAYER_TENDENCY,
        query_vector=query_vector,
        query_filter={"must": must_conditions},
        limit=limit,
        with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in results]


def get_total_vector_count() -> int:
    """Return total vector count across both collections for quota monitoring."""
    client = get_qdrant_client()
    total = 0
    for name in [COLLECTION_PRO_PLAYBOOK, COLLECTION_PLAYER_TENDENCY]:
        try:
            info = client.get_collection(name)
            total += info.vectors_count or 0
        except Exception:
            pass
    return total


def check_vector_quota() -> dict:
    """Check vector quota and return warning if approaching 8M limit."""
    total = get_total_vector_count()
    warn = total >= VECTOR_QUOTA_WARN_THRESHOLD
    return {
        "total_vectors": total,
        "threshold": VECTOR_QUOTA_WARN_THRESHOLD,
        "warning": warn,
        "message": (
            f"⚠️ Approaching Qdrant Cloud free tier limit ({total:,}/{VECTOR_QUOTA_WARN_THRESHOLD:,} vectors). Upgrade soon."
            if warn
            else "OK"
        ),
    }
