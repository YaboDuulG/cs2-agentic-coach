"""
Archetype vectorizer — summary text, Gemini embeddings, Qdrant upsert.
=======================================================================
Builds a structured semantic summary per ArchetypeDraft, persists the
ProStratArchetype row (always), and — when an API key is configured and
LOCAL_MODE is off — embeds the summary (768 dims, RETRIEVAL_DOCUMENT, same
Gemini pattern as db/rag.py) and upserts it into the Qdrant 'pro_playbook'
collection with rich metadata payload filters.
"""

from datetime import UTC, datetime
import json
import logging
import os
import uuid

from db.models import ProStratArchetype

logger = logging.getLogger(__name__)


def _team_name(pro_match) -> str:
    """
    ParseResult telemetry carries no side<->team mapping yet, so archetypes are
    attributed to the matchup rather than one team. TODO: resolve the executing
    team once the parser emits team names.
    """
    return f"{pro_match.team_a} vs {pro_match.team_b}"


def build_summary_text(draft) -> str:
    """'<map> <side> <label>: <metrics prose>' — the text that gets embedded."""
    m = draft.metrics
    centroid = m["first_contact_centroid"]
    return (
        f"{draft.map_name} {draft.side} {draft.label}: {draft.buy_type} buy, "
        f"{draft.round_type} round vs {m['vs_buy_type']} buy. "
        f"Avg utility lead {m['avg_utility_lead_seconds']:.1f}s before first contact; "
        f"first contact centered at ({centroid['x']:.0f}, {centroid['y']:.0f}) in {draft.zone}; "
        f"trade success rate {m['trade_success_rate']:.0%}; "
        f"post-plant success rate {m['post_plant_success_rate']:.0%}; "
        f"won {m['round_win_rate']:.0%} of {m['rounds_observed']} rounds."
    )


def get_document_embedding(text: str, api_key: str) -> list[float]:
    """768-dim document embedding — mirrors db/rag.py's query-side pattern."""
    from google import genai  # noqa: PLC0415
    from google.genai import types  # noqa: PLC0415

    client = genai.Client(api_key=api_key)

    model_name = os.environ.get("GEMINI_EMBEDDING_MODEL") or "gemini-embedding-001"
    if model_name.startswith("models/"):
        model_name = model_name.replace("models/", "")

    response = client.models.embed_content(
        model=model_name,
        contents=text,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT", output_dimensionality=768
        ),
    )
    return response.embeddings[0].values


def _point_id(pro_match, draft) -> str:
    """Stable point id so re-ingesting a match updates instead of duplicating."""
    key = f"{pro_match.hltv_match_id}:{draft.label}:{draft.side}:{draft.buy_type}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


def _embedding_enabled() -> bool:
    """Docstring for _embedding_enabled."""
    if os.getenv("LOCAL_MODE", "false").lower() == "true":
        return False
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def vectorize_archetypes(db, pro_match, drafts) -> list[ProStratArchetype]:
    """
    Upsert one ProStratArchetype row per draft (keyed by label + team + patch)
    and mirror it into Qdrant when embedding is enabled. Row persistence never
    depends on the embedding leg succeeding.
    """
    rows: list[ProStratArchetype] = []
    for draft in drafts:
        summary = build_summary_text(draft)
        metrics = dict(draft.metrics)
        metrics["pro_match_id"] = pro_match.hltv_match_id
        row = (
            db.query(ProStratArchetype)
            .filter_by(
                label=draft.label,
                team_name=_team_name(pro_match),
                patch_version=pro_match.patch_version,
            )
            .first()
        )
        if row is None:
            row = ProStratArchetype(
                label=draft.label,
                map_name=draft.map_name,
                side=draft.side,
                buy_type=draft.buy_type,
                round_type=draft.round_type,
                team_name=_team_name(pro_match),
                patch_version=pro_match.patch_version,
            )
            db.add(row)
        row.summary_text = summary
        row.metrics_json = json.dumps(metrics)
        row.updated_at = datetime.now(UTC)
        rows.append(row)
    db.commit()

    if not _embedding_enabled():
        logger.info(
            f"[Vectorizer] Embedding skipped (LOCAL_MODE or no key); "
            f"{len(rows)} archetype rows persisted for {pro_match.hltv_match_id}"
        )
        return rows

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    for draft, row in zip(drafts, rows):
        try:
            vector = get_document_embedding(row.summary_text, api_key)
            from db.qdrant_client import upsert_pro_tactic  # noqa: PLC0415

            point_id = _point_id(pro_match, draft)
            upsert_pro_tactic(
                point_id=point_id,
                vector=vector,
                payload={
                    "content": row.summary_text,
                    "label": draft.label,
                    "map_name": draft.map_name,
                    "side": draft.side,
                    "buy_type": draft.buy_type,
                    "team_name": row.team_name,
                    "round_type": draft.round_type,
                    "patch_version": pro_match.patch_version,
                    "pro_match_id": pro_match.hltv_match_id,
                    "source": "hltv_pro_match",
                },
            )
            row.qdrant_point_id = point_id
        except Exception as e:
            logger.error(f"[Vectorizer] Embed/upsert failed for '{draft.label}': {e}")
    db.commit()
    return rows
