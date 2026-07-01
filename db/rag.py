"""
DemoSage — RAG Semantic Search Module
======================================
Provides functions to retrieve relevant chunks from the Knowledge Base
using vector search (pgvector in Postgres, Python-based fallback in SQLite).
"""

import json
import logging
import math
import os

# Configure logging
logger = logging.getLogger("rag")

from db.models import KnowledgeEmbedding


def get_query_embedding(text: str, api_key: str) -> list[float]:
    """Call Gemini's embedding API to generate a 768-dimensional vector."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    model_name = os.environ.get("GEMINI_EMBEDDING_MODEL") or "gemini-embedding-001"
    if model_name.startswith("models/"):
        model_name = model_name.replace("models/", "")

    response = client.models.embed_content(
        model=model_name,
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY", output_dimensionality=768),
    )
    return response.embeddings[0].values


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two lists of floats."""
    if len(v1) != len(v2) or not v1:
        return 0.0
    dot_product = sum(x * y for x, y in zip(v1, v2))
    mag1 = math.sqrt(sum(x * x for x in v1))
    mag2 = math.sqrt(sum(x * x for x in v2))
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot_product / (mag1 * mag2)


def retrieve_similar_chunks(
    db_session,
    query: str,
    limit: int = 5,
    source: str | None = None,
    user_id: str | None = None,
    team_id: str | None = None,
) -> list[dict]:
    """
    Retrieve top K most similar text chunks using Qdrant.
    Enforces namespace isolation walls using user_id, team_id, and scope tags.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No GEMINI_API_KEY or GOOGLE_API_KEY found. RAG retrieval skipped.")
        return []

    try:
        query_vector = get_query_embedding(query, api_key)
    except Exception as e:
        logger.error(f"Failed to generate query embedding: {e}")
        return []

    logger.info(
        f"RAG query: '{query}' | limit: {limit} | source: {source} | user_id: {user_id} | team_id: {team_id}"
    )

    from db.qdrant_client import search_pro_tactics, search_player_tendencies

    results = []

    # 1. Search pro tactics (public scope)
    try:
        pro_results = search_pro_tactics(
            query_vector=query_vector,
            limit=limit,
        )
        results.extend(pro_results)
    except Exception as e:
        logger.error(f"Failed to search Qdrant pro tactics: {e}")

    # 2. Search player tendencies if team_id provided
    if team_id:
        try:
            team_results = search_player_tendencies(
                query_vector=query_vector,
                team_id=team_id,
                limit=limit,
            )
            results.extend(team_results)
        except Exception as e:
            logger.error(f"Failed to search Qdrant team tendencies: {e}")

    # 3. Search player tendencies if user_id provided
    if user_id:
        try:
            user_results = search_player_tendencies(
                query_vector=query_vector,
                user_id=user_id,
                limit=limit,
            )
            results.extend(user_results)
        except Exception as e:
            logger.error(f"Failed to search Qdrant user tendencies: {e}")

    # Filter by source if provided
    if source:
        results = [r for r in results if r.get("source") == source]

    # Sort by score descending
    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    results = results[:limit]

    final_results = []
    for r in results:
        # Create a copy to avoid mutating the original if it's cached
        r_copy = r.copy()
        content = r_copy.pop("content", "")
        src = r_copy.pop("source", None)
        score = r_copy.pop("score", None)
        r_copy.pop("scope", None) # Remove 'scope' added by qdrant_client
        final_results.append({
            "content": content,
            "source": src,
            "score": score,
            "metadata": r_copy,
        })

    return final_results
