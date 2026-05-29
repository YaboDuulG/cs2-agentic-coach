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
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    response = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="retrieval_query"  # Use retrieval_query for search queries
    )
    return response["embedding"]

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

def retrieve_similar_chunks(db_session, query: str, limit: int = 5, source: str | None = None) -> list[dict]:
    """
    Retrieve top K most similar text chunks from the knowledge_embeddings table.
    Automatically detects if backend is PostgreSQL (uses pgvector) or SQLite (uses Python fallback).
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

    dialect = db_session.bind.dialect.name
    logger.info(f"RAG query: '{query}' | dialect: {dialect} | limit: {limit} | source: {source}")

    if dialect == "sqlite":
        # SQLite Fallback: Fetch candidate rows and compute cosine similarity in Python
        candidate_query = db_session.query(KnowledgeEmbedding)
        if source:
            candidate_query = candidate_query.filter(KnowledgeEmbedding.source == source)
        candidates = candidate_query.all()

        scored_candidates = []
        for cand in candidates:
            # Deserialized list from SQLiteVectorType
            cand_vector = cand.embedding
            if isinstance(cand_vector, str):
                try:
                    cand_vector = json.loads(cand_vector)
                except Exception:
                    continue

            if not isinstance(cand_vector, list):
                continue

            similarity = cosine_similarity(query_vector, cand_vector)
            scored_candidates.append((cand, similarity))

        # Sort by similarity descending
        scored_candidates.sort(key=lambda x: x[1], reverse=True)
        top_candidates = scored_candidates[:limit]

        results = []
        for cand, score in top_candidates:
            results.append({
                "content": cand.content,
                "source": cand.source,
                "score": score,
                "metadata": json.loads(cand.metadata_json) if cand.metadata_json else {}
            })
        return results

    else:
        # PostgreSQL (pgvector): Use native <-> cosine distance operator
        postgres_query = db_session.query(KnowledgeEmbedding)
        if source:
            postgres_query = postgres_query.filter(KnowledgeEmbedding.source == source)

        # Cosine distance ranges from 0 (perfect match) to 2.
        # Order by distance ascending to get closest matches first.
        db_results = postgres_query.order_by(
            KnowledgeEmbedding.embedding.cosine_distance(query_vector)
        ).limit(limit).all()

        results = []
        for cand in db_results:
            # pgvector distance is 1 - cosine_similarity. We can approximate a score for matching output format.
            results.append({
                "content": cand.content,
                "source": cand.source,
                "score": None,  # pgvector order handles sorting natively
                "metadata": json.loads(cand.metadata_json) if cand.metadata_json else {}
            })
        return results
