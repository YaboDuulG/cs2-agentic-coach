"""
DemoSage — RAG Knowledge Base Updater
=======================================
Pulls parsed match data from the DB, formats it into search-friendly text chunks,
generates embeddings using Gemini's text-embedding-004, and upserts them into pgvector.

Usage:
    # Process a specific match
    python scripts/update_knowledge_base.py --match-id <match_id>

    # Process all matches that haven't been ingested yet
    python scripts/update_knowledge_base.py
"""

import argparse
import json
import logging
import os
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("update_knowledge_base")

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models import FirstContact, Kill, KnowledgeEmbedding, Match, Round


def clean_player_name(name: str | None) -> str:
    if not name:
        return ""
    import re
    return re.sub(r"\s*\(\d+\)$", "", name)

def format_weapon_name(weapon: str | None) -> str:
    if not weapon:
        return "unknown weapon"
    return weapon.replace("weapon_", "").replace("_", " ").upper()

def get_embedding(text: str, api_key: str) -> list[float]:
    """Call Gemini's embedding API to generate a 768-dimensional vector."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    # Generate embedding
    response = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="retrieval_document"
    )
    return response["embedding"]

def ingest_match(db, match_id: str, api_key: str):
    """Generate and store embeddings for a specific match's macro and micro stats."""
    logger.info(f"Ingesting match {match_id} into RAG database...")

    # 1. Fetch match and children
    match = db.query(Match).filter(Match.match_id == match_id).first()
    if not match:
        logger.error(f"Match {match_id} not found in database.")
        return

    rounds = db.query(Round).filter(Round.match_id == match_id).all()
    kills = db.query(Kill).filter(Kill.match_id == match_id).all()
    first_contacts = db.query(FirstContact).filter(FirstContact.match_id == match_id).all()

    # Parse coaching notes if available
    summary = "No summary available."
    if match.coaching_notes:
        try:
            notes = json.loads(match.coaching_notes)
            summary = notes.get("summary", summary)
        except Exception:
            pass

    # Check and delete existing embeddings for this match to avoid duplicates
    db.query(KnowledgeEmbedding).filter(
        KnowledgeEmbedding.source == "hltv_pro_match",
        KnowledgeEmbedding.metadata_json.like(f'%"{match_id}"%')
    ).delete(synchronize_session=False)
    db.commit()

    chunks_created = 0

    # 2. Match Summary Chunk (Macro)
    macro_text = (
        f"Match Summary (ID: {match_id}) played on map {match.map_name}. "
        f"Total rounds: {match.total_rounds}. "
        f"Overall outcome and coaching advice: {summary} "
        f"Top weapons utilized throughout the match included: "
        f"{', '.join(set(format_weapon_name(k.weapon) for k in kills[:10]))}."
    )

    try:
        macro_vector = get_embedding(macro_text, api_key)
        macro_meta = {
            "match_id": match_id,
            "map_name": match.map_name,
            "type": "summary"
        }

        db.add(KnowledgeEmbedding(
            content=macro_text,
            embedding=macro_vector,
            source="hltv_pro_match",
            metadata_json=json.dumps(macro_meta)
        ))
        chunks_created += 1
    except Exception as e:
        logger.error(f"Failed to generate macro embedding: {e}")
        return

    # 3. Round-by-Round Chunks (Micro)
    for r in rounds:
        r_kills = [k for k in kills if k.round_num == r.round_num]
        r_fc = [fc for fc in first_contacts if fc.round_num == r.round_num]

        fc_text = "No opening duel recorded."
        if r_fc:
            fc = r_fc[0]
            vic_team = "T" if fc.attacker_team == "CT" else "CT"
            fc_text = f"{clean_player_name(fc.attacker)} ({fc.attacker_team}) opened with a kill on {clean_player_name(fc.victim)} ({vic_team}) using {format_weapon_name(fc.weapon)}"

        round_text = (
            f"Round {r.round_num} on map {match.map_name} (Match ID: {match_id}). "
            f"Round winner: Team {r.winner_side}. "
            f"CT equipment value: ${r.ct_eq_val:,} | T equipment value: ${r.t_eq_val:,}. "
            f"Opening duel details: {fc_text}. "
            f"Total kills in round: {len(r_kills)}. "
            f"Weapons logged in kills: {', '.join(set(format_weapon_name(k.weapon) for k in r_kills))}."
        )

        try:
            r_vector = get_embedding(round_text, api_key)
            r_meta = {
                "match_id": match_id,
                "map_name": match.map_name,
                "round_num": r.round_num,
                "type": "round_details",
                "winner_side": r.winner_side
            }
            db.add(KnowledgeEmbedding(
                content=round_text,
                embedding=r_vector,
                source="hltv_pro_match",
                metadata_json=json.dumps(r_meta)
            ))
            chunks_created += 1
        except Exception as e:
            logger.error(f"Failed to generate embedding for round {r.round_num}: {e}")
            continue

    db.commit()
    logger.info(f"Successfully ingested match {match_id}: created {chunks_created} chunks/embeddings.")

def main():
    parser = argparse.ArgumentParser(description="DemoSage RAG Knowledge Base Ingestion Script")
    parser.add_argument("--match-id", type=str, help="Process specific match ID")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is missing. Cannot generate embeddings.")
        sys.exit(1)

    db = SessionLocal()
    try:
        if args.match_id:
            ingest_match(db, args.match_id, api_key)
        else:
            # Automatic scan for un-ingested matches
            # Let's pull all match IDs from knowledge_embeddings first
            ingested_matches = set()
            embeddings = db.query(KnowledgeEmbedding.metadata_json).filter(KnowledgeEmbedding.source == "hltv_pro_match").all()
            for emb in embeddings:
                if emb[0]:
                    try:
                        meta = json.loads(emb[0])
                        if "match_id" in meta:
                            ingested_matches.add(meta["match_id"])
                    except Exception:
                        pass

            # Fetch all completed matches in the matches table
            all_matches = db.query(Match).filter(Match.status.in_(["complete", "done", "parsed"])).all()
            to_ingest = [m for m in all_matches if m.match_id not in ingested_matches]

            if not to_ingest:
                logger.info("RAG Knowledge Base is up to date. No new matches to ingest.")
                return

            logger.info(f"Found {len(to_ingest)} new match(es) to ingest.")
            for match in to_ingest:
                ingest_match(db, match.match_id, api_key)

    finally:
        db.close()

if __name__ == "__main__":
    main()
