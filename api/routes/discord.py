"""
Discord Webhook Ingestion Route
===============================
Handles incoming webhooks from Discord, parsing unstructured messages into
structured team strategies using Gemini, generating embeddings, and storing them in DB.
"""

import json
import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Query

from db.models import KnowledgeEmbedding
from db.rag import get_query_embedding

logger = logging.getLogger(__name__)
router = APIRouter()


def call_gemini_text(prompt: str, model_name: str = "gemini-2.0-flash") -> str:
    """Call Gemini's standard text generation model."""
    import google.generativeai as genai  # noqa: PLC0415

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for chat text generation.")
        return "Gemini API key is not configured."
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        return f"Error communicating with Gemini: {str(e)}"


def parse_strategy_with_gemini(raw_text: str) -> dict:
    """Convert raw Discord chat message into structured playbook JSON card using Gemini."""
    import google.generativeai as genai  # noqa: PLC0415

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {
            "title": "Ingested Strategy",
            "map_name": "All Maps",
            "side": "Both",
            "summary": "Strategy ingested from Discord.",
            "steps": [raw_text],
        }
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = f"""
        Analyze the following Counter-Strike strategy posted by a player.
        Extract the following information and format it strictly as a JSON object:
        - title: A clean, concise title for this strategy (e.g. "A Split via Cat", "Fast B Rush").
        - map_name: The official CS2 map name if mentioned (e.g., "de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_overpass", "de_ancient", "de_anubis", "de_vertigo"). If not specified or general, use "All Maps".
        - side: Which side does this strategy apply to? Must be either "CT", "T", or "Both".
        - summary: A one-sentence summary of the strategy.
        - steps: A list of string steps/details describing the strategy execution (e.g. who throws what utility, where to push, etc.).

        Raw Discord post:
        \"\"\"{raw_text}\"\"\"
        """
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Failed to parse strategy with Gemini: {e}")
        return {
            "title": "Ingested Tactic",
            "map_name": "All Maps",
            "side": "Both",
            "summary": raw_text[:100] + "..." if len(raw_text) > 100 else raw_text,
            "steps": [raw_text],
        }


@router.post("/webhook", summary="Receive a Discord message webhook")
async def discord_webhook(
    team_id: str = Query(...),
    payload: Dict[str, Any] = Body(...),
):
    if not payload:
        raise HTTPException(status_code=400, detail="Empty payload")

    content = payload.get("content", "").strip()
    if not content:
        return {"status": "ignored", "reason": "No text content"}

    author = payload.get("author", {}).get("username", "Discord User")

    # Ingest only if it's not a bot message (avoid bot loops)
    is_bot = payload.get("author", {}).get("bot", False) or "webhook_id" in payload
    if is_bot:
        return {"status": "ignored", "reason": "Bot message"}

    # Parse strategy details using Gemini
    parsed = parse_strategy_with_gemini(content)

    # Format structured content for text indexing/RAG
    structured_content = f"""
    Title: {parsed.get('title', 'Ingested Tactic')}
    Map: {parsed.get('map_name', 'All Maps')}
    Side: {parsed.get('side', 'Both')}
    Summary: {parsed.get('summary', '')}
    Steps:
    """
    for step in parsed.get("steps", []):
        structured_content += f"\n- {step}"

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured")

    try:
        # Generate 768d embedding vector
        vector = get_query_embedding(structured_content.strip(), api_key)

        # Save to DB
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            meta = {
                "team_id": team_id,
                "map_name": parsed.get("map_name", "All Maps"),
                "side": parsed.get("side", "Both"),
                "title": parsed.get("title", "Ingested Tactic"),
                "author": author,
                "summary": parsed.get("summary", ""),
                "steps": parsed.get("steps", []),
                "raw_content": content,
            }

            db.add(
                KnowledgeEmbedding(
                    content=structured_content.strip(),
                    embedding=vector,
                    source="team_strategy",
                    metadata_json=json.dumps(meta),
                )
            )
            db.commit()
        finally:
            db.close()

        return {"status": "ingested", "title": parsed.get("title", "Ingested Tactic")}
    except Exception as e:
        logger.error(f"Failed to ingest Discord webhook: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
