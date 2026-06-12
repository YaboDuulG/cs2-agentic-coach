import os
import json
import asyncio
from datetime import datetime, UTC
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# We will use google-genai to generate embeddings
from google import genai
from google.genai import types

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from db.models import Base, MapPlaybook, KnowledgeEmbedding

# Initialize DB
db_url = os.getenv("DATABASE_URL_LOCAL") or os.getenv("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL found. Exiting.")
    sys.exit(1)

engine = create_engine(db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Initialize Gemini Client
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("GEMINI_API_KEY not found. Exiting.")
    sys.exit(1)

client = genai.Client(api_key=api_key)

MIRAGE_PLAYBOOK = {
    "map": "de_mirage",
    "ct_default": "2-1-2 setup. 2 A, 1 Window/Mid, 1 Short, 1 B Apps.",
    "t_default": "1-3-1 map control. 1 A ramp, 3 Top Mid, 1 B Apps.",
    "key_zones": ["Mid Window", "A Connector", "B Short", "A Ramp"],
    "common_mistakes": [
        "Losing mid control early",
        "Over-rotating on B hits",
        "Not trading effectively in A ramp"
    ]
}

PRO_CHUNKS = [
    {
        "content": "Mirage A-Site Defense: When T's execute A site with a smoke wall (Stairs, Jungle, CT), the optimal CT response is for the player on site to play inside Default or Firebox to stay alive, while the CT player flashes over the smoke and pushes to break the execute.",
        "source": "pro_tactics_mirage"
    },
    {
        "content": "Mirage Mid Control: Top mid control is essential for T side. Usually, T's throw a window smoke from T-spawn. If the smoke misses, the CT AWP will hold top mid. T's must flash over mid boxes before peeking.",
        "source": "pro_tactics_mirage"
    },
    {
        "content": "Mirage B-Site Execute (Olofboost): A legendary play where a CT boosts on the corner of B short to see over B apps. Highly risky but can guarantee a first blood. Best countered by a molotov under window.",
        "source": "pro_tactics_mirage"
    }
]

async def seed_db():
    print("Creating tables if they do not exist...")
    Base.metadata.create_all(bind=engine)
    
    with SessionLocal() as db:
        # Seed MapPlaybook
        print("Seeding MapPlaybook for Mirage...")
        mirage_pb = db.query(MapPlaybook).filter_by(map_name="de_mirage").first()
        if not mirage_pb:
            mirage_pb = MapPlaybook(
                map_name="de_mirage",
                playbook_json=json.dumps(MIRAGE_PLAYBOOK)
            )
            db.add(mirage_pb)
        else:
            mirage_pb.playbook_json = json.dumps(MIRAGE_PLAYBOOK)
        
        # Seed KnowledgeEmbeddings
        print("Seeding KnowledgeEmbeddings (fetching embeddings from Gemini)...")
        for chunk in PRO_CHUNKS:
            existing = db.query(KnowledgeEmbedding).filter_by(content=chunk["content"]).first()
            if not existing:
                print(f"Generating embedding for chunk: {chunk['content'][:30]}...")
                response = client.models.embed_content(
                    model="text-embedding-004",
                    contents=chunk["content"]
                )
                embedding = response.embeddings[0].values
                
                new_chunk = KnowledgeEmbedding(
                    content=chunk["content"],
                    embedding=embedding,
                    source=chunk["source"],
                    metadata_json=json.dumps({"map": "de_mirage", "type": "tactic"})
                )
                db.add(new_chunk)
                
        db.commit()
        print("Playbook seeding complete!")

if __name__ == "__main__":
    asyncio.run(seed_db())
