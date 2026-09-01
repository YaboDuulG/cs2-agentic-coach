"""
Pro-comp query API — hybrid retrieval for the coaching AI.
===========================================================
retrieve_pro_comps answers situation queries like "top 5 successful Nuke ramp
holds vs eco push on current patch" by fusing two legs with reciprocal rank
fusion (k=60):

  dense  — Gemini query embedding + Qdrant 'pro_playbook' search with strict
           payload filters (map/side/buy/round_type/patch).
  sparse — in-module Okapi BM25 over ProStratArchetype.summary_text from the
           relational DB, pre-filtered by the same metadata.

Either leg failing (no Qdrant, no key, empty corpus) degrades to the other
leg; the function never raises. Results are RetrievedChunk-shaped dicts
compatible with what agents/scribe/evidence.py consumes.
"""

from collections import Counter
import json
import logging
import math
import os
import re

from db.models import ProStratArchetype

logger = logging.getLogger(__name__)

RRF_K = 60
BM25_K1 = 1.5
BM25_B = 0.75
CANDIDATES_PER_LEG = 20


def _tokenize(text: str) -> list[str]:
    """Docstring for _tokenize."""
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _bm25_scores(query_tokens: list[str], docs: list[list[str]]) -> list[float]:
    """Okapi BM25 scores for each doc against the query tokens."""
    n_docs = len(docs)
    if not n_docs or not query_tokens:
        return [0.0] * n_docs
    avg_len = sum(len(d) for d in docs) / n_docs
    doc_freq: Counter[str] = Counter()
    for doc in docs:
        doc_freq.update(set(doc))

    scores = [0.0] * n_docs
    for term in set(query_tokens):
        df = doc_freq.get(term, 0)
        if df == 0:
            continue
        idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
        for i, doc in enumerate(docs):
            tf = doc.count(term)
            if tf == 0:
                continue
            denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * len(doc) / avg_len)
            scores[i] += idf * (tf * (BM25_K1 + 1)) / denom
    return scores


def _filters(
    map_name, side, buy_type, round_type, patch_version
) -> dict[str, str | None]:
    """Docstring for _filters."""
    return {
        "map_name": map_name,
        "side": side,
        "buy_type": buy_type,
        "round_type": round_type,
        "patch_version": patch_version,
    }


def _dense_leg(query_text: str, filters: dict, limit: int) -> list[dict]:
    """Qdrant search with strict payload filters. Returns ranked candidates."""
    # LOCAL_MODE mirrors the vectorizer: no embedding / no Qdrant — the BM25
    # leg carries retrieval. Keeps tests and local dev offline and fast.
    if os.getenv("LOCAL_MODE", "false").lower() == "true":
        logger.info("[ProComps] Dense leg skipped: LOCAL_MODE")
        return []
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.info("[ProComps] Dense leg skipped: no Gemini API key")
        return []
    from db.qdrant_client import COLLECTION_PRO_PLAYBOOK, get_qdrant_client  # noqa: PLC0415
    from db.rag import get_query_embedding  # noqa: PLC0415

    query_vector = get_query_embedding(query_text, api_key)
    must: list[dict] = [{"key": "scope", "match": {"value": "public"}}]
    for key, value in filters.items():
        if value:
            must.append({"key": key, "match": {"value": value}})
    results = get_qdrant_client().search(
        collection_name=COLLECTION_PRO_PLAYBOOK,
        query_vector=query_vector,
        query_filter={"must": must},
        limit=limit,
        with_payload=True,
    )
    return [
        {"key": str(r.id), "leg_score": r.score, "payload": dict(r.payload or {})}
        for r in results
    ]


def _sparse_leg(db, query_text: str, filters: dict, limit: int) -> list[dict]:
    """BM25 over ProStratArchetype summaries, metadata-filtered in SQL."""
    query = db.query(ProStratArchetype)
    for attr, value in filters.items():
        if value:
            query = query.filter(getattr(ProStratArchetype, attr) == value)
    rows = query.all()
    if not rows:
        return []
    docs = [_tokenize(f"{row.label} {row.summary_text}") for row in rows]
    scores = _bm25_scores(_tokenize(query_text), docs)
    ranked = sorted(
        (
            (score, row)
            for score, row in zip(scores, rows)
            if score > 0
        ),
        key=lambda pair: (-pair[0], pair[1].id),
    )[:limit]
    return [
        {
            "key": row.qdrant_point_id or f"pg:{row.id}",
            "leg_score": score,
            "row": row,
        }
        for score, row in ranked
    ]


def _rrf_fuse(legs: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """Reciprocal rank fusion: score(doc) = sum over legs of 1/(k + rank)."""
    fused: dict[str, dict] = {}
    for leg in legs:
        for rank, candidate in enumerate(leg, start=1):
            entry = fused.setdefault(candidate["key"], {"score": 0.0, "candidates": []})
            entry["score"] += 1.0 / (k + rank)
            entry["candidates"].append(candidate)
    return sorted(
        (
            {"key": key, "score": entry["score"], "candidates": entry["candidates"]}
            for key, entry in fused.items()
        ),
        key=lambda e: (-e["score"], e["key"]),
    )


def _to_chunk(fused_entry: dict) -> dict:
    """RetrievedChunk-shaped dict from whichever legs saw this doc."""
    payload: dict = {}
    row = None
    for candidate in fused_entry["candidates"]:
        payload = payload or candidate.get("payload") or {}
        row = row or candidate.get("row")

    if payload:
        text = payload.get("content") or payload.get("label") or ""
        pro_match_id = payload.get("pro_match_id")
        metadata = {
            k: v for k, v in payload.items() if k not in ("content", "scope", "source")
        }
    else:
        metrics = {}
        try:
            metrics = json.loads(row.metrics_json or "{}")
        except (TypeError, ValueError):
            pass
        text = row.summary_text or row.label
        pro_match_id = metrics.get("pro_match_id")
        metadata = {
            "label": row.label,
            "map_name": row.map_name,
            "side": row.side,
            "buy_type": row.buy_type,
            "team_name": row.team_name,
            "round_type": row.round_type,
            "patch_version": row.patch_version,
        }
    return {
        "id": fused_entry["key"],
        "text": text,
        "score": round(fused_entry["score"], 6),
        "source": "hltv_pro_match",
        "pro_match_id": pro_match_id,
        "metadata": metadata,
    }


def retrieve_pro_comps(
    db,
    query_text: str,
    *,
    map_name: str | None = None,
    side: str | None = None,
    buy_type: str | None = None,
    round_type: str | None = None,
    patch_version: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    """
    Hybrid (dense + BM25, RRF-fused) pro-comp retrieval with metadata filters.
    Degrades to whichever leg works; returns [] rather than raising.
    """
    filters = _filters(map_name, side, buy_type, round_type, patch_version)
    candidates = max(CANDIDATES_PER_LEG, top_k)

    try:
        dense = _dense_leg(query_text, filters, candidates)
    except Exception as e:
        logger.error(f"[ProComps] Dense leg failed, degrading to BM25 only: {e}")
        dense = []
    try:
        sparse = _sparse_leg(db, query_text, filters, candidates)
    except Exception as e:
        logger.error(f"[ProComps] BM25 leg failed, degrading to dense only: {e}")
        sparse = []

    fused = _rrf_fuse([dense, sparse])
    chunks = [_to_chunk(entry) for entry in fused[:top_k]]
    logger.info(
        f"[ProComps] query='{query_text}' filters={ {k: v for k, v in filters.items() if v} } "
        f"dense={len(dense)} sparse={len(sparse)} returned={len(chunks)}"
    )
    return chunks
