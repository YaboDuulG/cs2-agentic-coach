"""
services/rag_engine — HLTV pro meta ingestion + hybrid retrieval.
==================================================================
Public API:
    get_client / HLTVClient / FixtureClient   — HLTV results client (env-configured)
    run_delta                                 — dedupe-and-queue delta monitor
    extract_archetypes / ArchetypeDraft       — pure telemetry → archetype extraction
    build_summary_text / vectorize_archetypes — summaries, embeddings, Qdrant upsert
    retrieve_pro_comps                        — hybrid (BM25 + dense, RRF) query API
    run_ingestion_cycle                       — one full delta → extract → vectorize pass
"""

from services.rag_engine.delta_monitor import run_delta
from services.rag_engine.extractor import ArchetypeDraft, RoundExtract, extract_archetypes
from services.rag_engine.hltv_client import FixtureClient, HLTVClient, get_client
from services.rag_engine.retrieval import retrieve_pro_comps
from services.rag_engine.vectorizer import build_summary_text, vectorize_archetypes
from services.rag_engine.worker import run_ingestion_cycle

__all__ = [
    "ArchetypeDraft",
    "FixtureClient",
    "HLTVClient",
    "RoundExtract",
    "build_summary_text",
    "extract_archetypes",
    "get_client",
    "retrieve_pro_comps",
    "run_delta",
    "run_ingestion_cycle",
    "vectorize_archetypes",
]
