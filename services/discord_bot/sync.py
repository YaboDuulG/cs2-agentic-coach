"""
Sync-outbox processor — the ONLY place that talks to Discord REST or Gemini.
=============================================================================
services/worker/runner.py claims a SyncOutbox row and calls
process_outbox_item(db, item); raising here makes db/outbox.fail requeue the
item (up to max_attempts), returning cleanly marks it DONE.

Kinds:
    strat_upsert  - ensure the strat has a Discord thread, post the embed
    strat_status  - post a status-change line into the thread
    discord_reply - post plain text into a thread
    ai_adapt      - Gemini-adapt the canvas, add an `ai` revision, reply

Design note: Strat has no discord_message_id column (deliberate — see
db/models.py), so upserts and status changes POST new messages instead of
editing old ones. The approve button is stripped at approval time by the
interaction's UPDATE_MESSAGE response, not from here.
"""

import json
import logging
import os
from typing import Any

from sqlalchemy.orm import Session

from db.models import Strat, StratRevision, StratStatus, SyncOutbox, TeamDiscordLink
from services.stratbook.service import add_revision, enqueue_sync

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"

_STATUS_COLORS = {
    StratStatus.DRAFT: 0x95A5A6,  # gray
    StratStatus.IN_REVIEW: 0xF39C12,  # amber
    StratStatus.ACTIVE: 0x2ECC71,  # green
    StratStatus.ARCHIVED: 0x34495E,  # slate
}


def process_outbox_item(db: Session, item: SyncOutbox) -> None:
    """Dispatch one claimed outbox row. Raise to requeue (db/outbox.fail)."""
    payload = json.loads(item.payload_json or "{}")
    if item.kind == "strat_upsert":
        _handle_strat_upsert(db, payload)
    elif item.kind == "strat_status":
        _handle_strat_status(db, payload)
    elif item.kind == "discord_reply":
        _handle_discord_reply(payload)
    elif item.kind == "ai_adapt":
        _handle_ai_adapt(db, payload)
    else:
        raise ValueError(f"Unknown outbox kind {item.kind!r}")


# ---------------------------------------------------------------------------
# Discord REST
# ---------------------------------------------------------------------------


def _discord_request(method: str, path: str, json_body: dict | None = None) -> dict | None:
    """One-stop Discord REST call. Returns parsed JSON, or None when Discord
    is unreachable by design (LOCAL_MODE, or no bot token) — callers treat
    None as 'skip posting, still complete the item'. Raises on HTTP >= 400."""
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    if local_mode or not token:
        logger.info(f"[Discord sync] skipping {method} {path} (LOCAL_MODE or no bot token)")
        return None

    import httpx  # noqa: PLC0415

    response = httpx.request(
        method,
        f"{DISCORD_API_BASE}{path}",
        headers={"Authorization": f"Bot {token}"},
        json=json_body,
        timeout=15.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Discord API {response.status_code} on {path}: {response.text}")
    if not response.content:
        return None
    return response.json()


# ---------------------------------------------------------------------------
# Embed building
# ---------------------------------------------------------------------------


def _build_embed(strat: Strat, revision: StratRevision | None) -> dict[str, Any]:
    """Rich embed for a strat revision: fields, utility list, status color,
    and a minimap image slot from MINIMAP_BASE_URL.

    TODO: generate an actual canvas preview image (render steps/positions onto
    the minimap) and upload it; for now the image is the bare map radar from
    MINIMAP_BASE_URL, skipped entirely when that env is unset.
    """
    status = StratStatus(strat.status)
    embed: dict[str, Any] = {
        "title": strat.title,
        "description": (revision.description if revision else "") or "*No description yet.*",
        "color": _STATUS_COLORS.get(status, 0x95A5A6),
        "fields": [
            {"name": "Map", "value": strat.map_name, "inline": True},
            {"name": "Side", "value": strat.side, "inline": True},
            {"name": "Buy", "value": strat.buy_type, "inline": True},
            {"name": "Status", "value": status.value, "inline": True},
            {
                "name": "Revision",
                "value": str(revision.revision_no) if revision else "-",
                "inline": True,
            },
        ],
    }

    utility = json.loads(revision.utility_json or "[]") if revision else []
    if utility:
        lines = [
            f"- {u.get('type', '?')} → {u.get('callout') or 'unnamed'}" for u in utility[:10]
        ]
        embed["fields"].append({"name": "Utility", "value": "\n".join(lines), "inline": False})

    minimap_base = os.environ.get("MINIMAP_BASE_URL", "").rstrip("/")
    if minimap_base:
        embed["image"] = {"url": f"{minimap_base}/{strat.map_name}.png"}
    return embed


def _approve_button_row(strat_id: str) -> list[dict]:
    """Docstring for _approve_button_row."""
    return [
        {
            "type": 1,  # action row
            "components": [
                {
                    "type": 2,  # button
                    "style": 3,  # success/green
                    "label": "Approve",
                    "custom_id": f"strat_approve:{strat_id}",
                }
            ],
        }
    ]


# ---------------------------------------------------------------------------
# Kind handlers
# ---------------------------------------------------------------------------


def _load_strat(db: Session, strat_id: str) -> Strat:
    """Docstring for _load_strat."""
    strat = db.get(Strat, strat_id)
    if strat is None:
        raise ValueError(f"Strat {strat_id} not found")
    return strat


def _current_revision(db: Session, strat: Strat, revision_id: int | None = None) -> StratRevision | None:
    """Docstring for _current_revision."""
    rev_id = revision_id or strat.current_revision_id
    return db.get(StratRevision, rev_id) if rev_id else None


def _handle_strat_upsert(db: Session, payload: dict) -> None:
    """Ensure the strat's thread exists, then post the current embed into it."""
    strat = _load_strat(db, payload["strat_id"])
    revision = _current_revision(db, strat, payload.get("revision_id"))
    link = db.get(TeamDiscordLink, strat.team_id)
    if link is None:
        logger.info(f"[Discord sync] team {strat.team_id} has no Discord link; nothing to post")
        return

    if not strat.discord_thread_id:
        thread = _discord_request(
            "POST",
            f"/channels/{link.channel_id}/threads",
            {
                "name": f"[strat] {strat.title}"[:100],
                "type": 11,  # public thread
                "auto_archive_duration": 10080,
            },
        )
        if thread is None:  # LOCAL_MODE / no token — nowhere to post
            return
        strat.discord_thread_id = str(thread["id"])
        db.commit()

    message: dict[str, Any] = {"embeds": [_build_embed(strat, revision)]}
    if StratStatus(strat.status) == StratStatus.IN_REVIEW:
        message["components"] = _approve_button_row(strat.id)
    _discord_request("POST", f"/channels/{strat.discord_thread_id}/messages", message)


def _handle_strat_status(db: Session, payload: dict) -> None:
    """Post a status-change line. We POST a new line rather than editing the
    embed message — no discord_message_id column, by design (see module doc)."""
    strat = _load_strat(db, payload["strat_id"])
    if not strat.discord_thread_id:
        logger.info(f"[Discord sync] strat {strat.id} has no thread; skipping status post")
        return
    actor = payload.get("actor") or "someone"
    _discord_request(
        "POST",
        f"/channels/{strat.discord_thread_id}/messages",
        {"content": f"Status changed to **{payload.get('status', '?')}** (by {actor})."},
    )


def _handle_discord_reply(payload: dict) -> None:
    """Docstring for _handle_discord_reply."""
    _discord_request(
        "POST",
        f"/channels/{payload['thread_id']}/messages",
        {"content": str(payload.get("text") or "")[:2000]},
    )


# ---------------------------------------------------------------------------
# ai_adapt — Gemini canvas refinement
# ---------------------------------------------------------------------------


def _gemini_adapt(strat: Strat, revision: StratRevision | None, prompt: str) -> dict[str, Any]:
    """Ask Gemini for an adapted canvas. Returns {canvas, description, summary}.

    Schema-constrained like agents/scribe/report_generator.py — but the canvas
    itself travels as a JSON string field because its positions map has
    dynamic player keys that types.Schema can't express.
    """
    from google import genai  # noqa: PLC0415
    from google.genai import types  # noqa: PLC0415

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    client = genai.Client(api_key=api_key)

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "canvas_json": types.Schema(type=types.Type.STRING),
            "description": types.Schema(type=types.Type.STRING),
            "summary": types.Schema(type=types.Type.STRING),
        },
        required=["canvas_json", "description", "summary"],
    )
    llm_prompt = f"""
    You are an elite CS2 tactical coach maintaining a team stratbook entry.

    Strat: {strat.title} — map {strat.map_name}, side {strat.side}, buy {strat.buy_type}.
    Current description: {revision.description if revision else ""}
    Current canvas JSON (schema:
      {{"steps": [{{"t": seconds, "label": str,
                    "positions": {{player: {{"x": float, "y": float}}}},
                    "utility": [{{"type": "smoke|flash|molotov|he|decoy",
                                  "from": {{"x", "y"}}, "to": {{"x", "y"}},
                                  "callout": str}}]}}],
        "callouts": [{{"name": str, "x": float, "y": float}}]}}):
    {revision.canvas_json if revision else "{}"}

    The team asked for this change: {prompt}

    Return the FULL adapted canvas as a JSON string in canvas_json (same schema,
    keep unchanged parts), an updated description, and a 2-3 sentence summary of
    exactly what you changed and why.
    """
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=llm_prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.4,
        ),
    )
    data = json.loads(response.text or "{}")
    return {
        "canvas": json.loads(data["canvas_json"]),
        "description": data.get("description") or "",
        "summary": data.get("summary") or "Strat adapted.",
    }


def _canvas_utility(canvas: dict) -> list[dict]:
    """Flatten the per-step utility lists into the embed's utility_json shape."""
    utility: list[dict] = []
    for step in canvas.get("steps") or []:
        utility.extend(step.get("utility") or [])
    return utility


def _handle_ai_adapt(db: Session, payload: dict) -> None:
    """Gemini-adapt the strat canvas and add an `ai` revision. The revision
    re-enqueues strat_upsert itself; we add a discord_reply with the summary."""
    strat = _load_strat(db, payload["strat_id"])
    revision = _current_revision(db, strat)
    thread_id = payload.get("thread_id") or strat.discord_thread_id
    prompt = str(payload.get("prompt") or "")

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[Discord sync] ai_adapt requested but no Gemini API key configured")
        if thread_id:
            _discord_request(
                "POST",
                f"/channels/{thread_id}/messages",
                {
                    "content": "Sorry — I can't adapt strats right now "
                    "(AI is not configured on this server)."
                },
            )
        return

    adapted = _gemini_adapt(strat, revision, prompt)
    add_revision(
        db,
        strat,
        canvas=adapted["canvas"],
        description=adapted["description"],
        utility=_canvas_utility(adapted["canvas"]),
        author_id=f"ai:gemini(for {payload.get('requested_by', 'unknown')})",
        source="ai",
    )
    if thread_id:
        enqueue_sync(
            db,
            "discord_reply",
            {"thread_id": thread_id, "text": f"Adapted **{strat.title}**: {adapted['summary']}"},
        )
    db.commit()
