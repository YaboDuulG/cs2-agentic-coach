"""
DemoSage — Corpus Ingestion Script
===================================
Parses the game_rules.md markdown file, chunks it semantically,
generates 768-dimensional embeddings via Gemini, and stores them in the DB.

Usage:
    python scripts/ingest_corpus.py
"""

import json
import logging
import os
from pathlib import Path
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ingest_corpus")

# Add project root to sys.path
REPO_ROOT = Path(__file__).parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.database import SessionLocal
from db.models import KnowledgeEmbedding


def get_embedding(text: str, api_key: str) -> list[float]:
    """Call Gemini's embedding API to generate a 768-dimensional vector."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    response = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="retrieval_document"
    )
    return response["embedding"]

def parse_markdown_chunks(filepath: Path) -> list[dict]:
    """
    Parse a markdown file into hierarchical chunks.
    Splits by H2 (##) and H3 (###) headers.
    Injects the path hierarchy into the content to improve retrieval accuracy.
    """
    if not filepath.exists():
        logger.error(f"File not found: {filepath}")
        return []

    content = filepath.read_text(encoding="utf-8")
    lines = content.splitlines()

    chunks = []
    current_h1 = "CS2 Knowledge Base"
    current_h2 = ""
    current_h3 = ""

    current_chunk_lines = []

    def save_current_chunk():
        nonlocal current_chunk_lines, current_h2, current_h3
        chunk_text = "\n".join(current_chunk_lines).strip()
        if chunk_text:
            # Construct hierarchical context header
            hierarchy = f"{current_h1}"
            if current_h2:
                hierarchy += f" > {current_h2}"
            if current_h3:
                hierarchy += f" > {current_h3}"

            full_content = f"{hierarchy}\n\n{chunk_text}"
            chunks.append({
                "content": full_content,
                "metadata": {
                    "h1": current_h1,
                    "h2": current_h2,
                    "h3": current_h3,
                    "source_file": filepath.name
                }
            })
        current_chunk_lines = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            save_current_chunk()
            current_h1 = stripped[2:].strip()
            current_h2 = ""
            current_h3 = ""
        elif stripped.startswith("## "):
            save_current_chunk()
            current_h2 = stripped[3:].strip()
            current_h3 = ""
        elif stripped.startswith("### "):
            save_current_chunk()
            current_h3 = stripped[4:].strip()
        else:
            current_chunk_lines.append(line)

    save_current_chunk()
    return chunks

def main():
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is missing. Cannot generate embeddings.")
        sys.exit(1)

    corpus_path = REPO_ROOT / "data" / "corpus" / "game_rules.md"
    chunks = parse_markdown_chunks(corpus_path)

    if not chunks:
        logger.error("No chunks found in corpus file.")
        sys.exit(1)

    logger.info(f"Parsed {len(chunks)} chunks from {corpus_path.name}")

    from db.database import engine
    from db.models import Base
    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        # Clear existing game rules to prevent duplicates
        deleted = db.query(KnowledgeEmbedding).filter(KnowledgeEmbedding.source == "game_rules").delete()
        db.commit()
        if deleted:
            logger.info(f"Cleared {deleted} existing game_rules embeddings.")

        chunks_created = 0
        for chunk in chunks:
            try:
                content = chunk["content"]
                meta = chunk["metadata"]

                # Generate embedding
                vector = get_embedding(content, api_key)

                # Save to DB
                db.add(KnowledgeEmbedding(
                    content=content,
                    embedding=vector,
                    source="game_rules",
                    metadata_json=json.dumps(meta)
                ))
                chunks_created += 1
                logger.info(f"Ingested chunk: {meta.get('h2') or ''} -> {meta.get('h3') or ''}")
            except Exception as e:
                logger.error(f"Failed to ingest chunk: {e}")

        db.commit()
        logger.info(f"Successfully completed corpus ingestion: created {chunks_created} embeddings.")

    finally:
        db.close()

if __name__ == "__main__":
    main()
