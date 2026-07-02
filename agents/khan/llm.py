"""Module docstring."""
import json
import logging
import os
from typing import Any

from langchain_community.cache import SQLAlchemyCache
from langchain_core.globals import set_llm_cache
from sqlalchemy import create_engine

logger = logging.getLogger("great_khan")

db_url = os.environ.get("DATABASE_URL", "sqlite:///./demosage.db")
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

_engine = create_engine(db_url)
set_llm_cache(SQLAlchemyCache(_engine, "llm_cache"))

COACHING_MODEL = "gemini-2.5-flash"

def _stub_coaching() -> dict[str, Any]:
    """Fallback when no API key is configured."""
    return {
        "summary": "AI coaching requires GEMINI_API_KEY to be configured.",
        "key_findings": ["Configure GEMINI_API_KEY to see AI insights."],
        "economy_analysis": "Data parsed successfully.",
        "tactical_recommendations": [
            {
                "title": "Configure API Key",
                "detail": "Add GEMINI_API_KEY to Secret Manager.",
            }
        ],
        "strongest_area": "Demo parsed successfully.",
        "weakest_area": "AI coaching not yet configured.",
    }

def _call_gemini(prompt: str) -> dict[str, Any] | None:
    """Call Gemini and parse the JSON response."""
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("No Gemini API key — returning stub notes")
            return _stub_coaching()

        from db.config import get_config

        model_name = get_config("coaching_model", "gemini-2.5-flash")
        temp_str = get_config("coaching_temperature", "0.4")
        try:
            temperature = float(temp_str)
        except ValueError:
            temperature = 0.4

        llm = ChatGoogleGenerativeAI(
            model=model_name,
            temperature=temperature,
            google_api_key=api_key,
            model_kwargs={"response_mime_type": "application/json"},
        )

        # Invoke via LangChain to hit the SQLiteCache
        response = llm.invoke(prompt)
        return json.loads(response.content)
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        return None
