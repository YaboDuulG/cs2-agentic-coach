"""
`/strat ingest`: read a channel's history since the last ingest.
=================================================================
The bot has no gateway connection, so it never sees chat as it happens. What
it can do, with the Message Content intent switched on, is read a channel's
history over REST. `/strat ingest` reads everything posted since the last run
(the first run reads the channel from its first message), asks Gemini which
strategies the conversation contains, and saves them to the team's knowledge
base: the same rows the web's "Ingested from Discord" list and the team coach
read. The cursor is the last message id, so nothing is read twice.

Runs in the worker (sync.py hands it the Discord REST function); the slash
command only enqueues. A long channel is read in runs of PAGE_LIMIT pages;
the run re-enqueues itself until it has caught up.
"""

from datetime import UTC, datetime
import json
import logging
import os
from typing import Any, Callable

from sqlalchemy.orm import Session

from db.models import KnowledgeEmbedding, TeamDiscordIngestCursor
from services.stratbook.service import enqueue_sync

logger = logging.getLogger(__name__)

DiscordRequest = Callable[..., Any]

PAGE_SIZE = 100
PAGE_LIMIT = 6  # messages read per run before the job re-enqueues itself
CHUNK_CHARS = 7000  # conversation text per Gemini call
GEMINI_MODEL = "gemini-2.5-flash"
EMBEDDING_DIM = 768


# ---------------------------------------------------------------------------
# Reading the channel
# ---------------------------------------------------------------------------


def fetch_page(request: DiscordRequest, channel_id: str, after_id: str | None) -> list[dict]:
    """One page of messages posted after `after_id`, oldest first. Discord's
    `after` is a snowflake; 0 means "from the first message"."""
    page = request("GET", f"/channels/{channel_id}/messages?limit={PAGE_SIZE}&after={after_id or 0}")
    if not isinstance(page, list):
        return []
    return sorted(page, key=lambda m: int(m.get("id") or 0))


def is_human_message(message: dict) -> bool:
    """Only what people typed: no bots or webhooks, no empty or system messages."""
    author = message.get("author") or {}
    if author.get("bot") or message.get("webhook_id"):
        return False
    if message.get("type", 0) not in (0, 19):  # DEFAULT, REPLY
        return False
    return bool((message.get("content") or "").strip())


def render(messages: list[dict]) -> str:
    """Conversation as `[time] name: text` lines, the shape the prompt expects."""
    lines = []
    for m in messages:
        author = (m.get("author") or {}).get("global_name") or (m.get("author") or {}).get("username") or "someone"
        stamp = (m.get("timestamp") or "")[:16].replace("T", " ")
        lines.append(f"[{stamp}] {author}: {(m.get('content') or '').strip()}")
    return "\n".join(lines)


def chunk(messages: list[dict], max_chars: int = CHUNK_CHARS) -> list[list[dict]]:
    """Consecutive message groups small enough for one Gemini call."""
    chunks: list[list[dict]] = []
    current: list[dict] = []
    size = 0
    for m in messages:
        length = len(m.get("content") or "") + 40
        if current and size + length > max_chars:
            chunks.append(current)
            current, size = [], 0
        current.append(m)
        size += length
    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# Gemini: conversation -> strategies
# ---------------------------------------------------------------------------


def gemini_api_key() -> str | None:
    """Docstring for gemini_api_key."""
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or None


def extract_strategies(conversation: str, map_name: str | None, team_id: str) -> list[dict[str, Any]]:
    """Strategies a chunk of team chat describes. Schema-constrained; the
    model is told to return nothing for chat that holds no strategy, so idle
    talk costs one small call and saves no rows."""
    from google import genai  # noqa: PLC0415
    from google.genai import types  # noqa: PLC0415

    from services.billing.metering import record_usage  # noqa: PLC0415

    api_key = gemini_api_key()
    if not api_key:
        raise RuntimeError("Gemini is not configured")
    client = genai.Client(api_key=api_key)
    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "strategies": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "title": types.Schema(type=types.Type.STRING),
                        "map_name": types.Schema(type=types.Type.STRING),
                        "side": types.Schema(type=types.Type.STRING),
                        "summary": types.Schema(type=types.Type.STRING),
                        "steps": types.Schema(type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)),
                    },
                    required=["title", "map_name", "side", "summary", "steps"],
                ),
            )
        },
        required=["strategies"],
    )
    prompt = f"""
    This is a Counter-Strike 2 team's Discord channel{f" for the map {map_name}" if map_name else ""}.
    Read the conversation and list every strategy, set play, default, retake plan or
    utility lineup the team describes or agrees on. Ignore banter, scheduling and
    anything that is not a tactic.

    For each one return:
    - title: short and specific ("A split via palace", "Banana control: 2 smokes + molly").
    - map_name: the official map id (de_mirage, de_inferno, ...). {f"Default to {map_name}." if map_name else 'Use "All Maps" if unclear.'}
    - side: "T", "CT" or "Both".
    - summary: one sentence.
    - steps: the concrete steps in order, each naming who does what where. Keep the
      team's own callouts and player names.

    Return an empty list when the conversation contains no strategy.

    Conversation:
    \"\"\"{conversation}\"\"\"
    """
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=schema, temperature=0.2
        ),
    )
    record_usage(response, model=GEMINI_MODEL, purpose="ingest", team_id=team_id)
    data = json.loads(response.text or "{}")
    return [s for s in (data.get("strategies") or []) if (s.get("title") or "").strip()]


def embed(text: str) -> list[float]:
    """Docstring for embed."""
    from db.rag import get_query_embedding  # noqa: PLC0415

    api_key = gemini_api_key()
    if not api_key:
        return [0.0] * EMBEDDING_DIM
    try:
        return get_query_embedding(text, api_key)
    except Exception as e:  # a strategy without a vector is still worth keeping
        logger.error(f"[Discord ingest] embedding failed: {e}")
        return [0.0] * EMBEDDING_DIM


def save_strategy(
    db: Session, team_id: str, strat: dict[str, Any], *, author: str, channel_name: str, map_name: str | None
) -> KnowledgeEmbedding:
    """One row in the team's knowledge base, the shape the manual "Add
    strategy" form writes (api/routes/teams.py create_team_strategy)."""
    steps = [str(s).strip() for s in (strat.get("steps") or []) if str(s).strip()]
    resolved_map = (strat.get("map_name") or "").strip() or map_name or "All Maps"
    content = (
        f"Title: {strat['title'].strip()}\nMap: {resolved_map}\nSide: {strat.get('side') or 'Both'}\n"
        f"Summary: {strat.get('summary') or ''}\nSteps:" + "".join(f"\n- {s}" for s in steps)
    )
    meta = {
        "team_id": team_id,
        "map_name": resolved_map,
        "side": strat.get("side") or "Both",
        "title": strat["title"].strip(),
        "author": author,
        "summary": strat.get("summary") or "",
        "steps": steps,
        "raw_content": content,
        "source_channel": channel_name,
    }
    row = KnowledgeEmbedding(
        content=content, embedding=embed(content), source="team_strategy", metadata_json=json.dumps(meta)
    )
    db.add(row)
    return row


# ---------------------------------------------------------------------------
# The job
# ---------------------------------------------------------------------------


def cursor_for(db: Session, team_id: str, channel_id: str) -> TeamDiscordIngestCursor:
    """Docstring for cursor_for."""
    row = db.get(TeamDiscordIngestCursor, channel_id)
    if row is None:
        row = TeamDiscordIngestCursor(channel_id=channel_id, team_id=team_id)
        db.add(row)
        db.flush()
    return row


def run_channel_ingest(db: Session, payload: dict[str, Any], request: DiscordRequest) -> dict[str, Any]:
    """Read the channel since its cursor, save the strategies, advance the
    cursor, reply in the channel. Re-enqueues itself when the channel has more
    than one run's worth of messages left. Raises to requeue on Discord or
    Gemini failure; the cursor only moves after a page is fully saved."""
    team_id, channel_id = payload["team_id"], payload["channel_id"]
    channel_name = payload.get("channel_name") or channel_id
    map_name = payload.get("map_name") or None
    cursor = cursor_for(db, team_id, channel_id)

    if not gemini_api_key():
        # Reading without extracting would move the cursor past content for
        # nothing; refuse instead and keep the channel unread.
        enqueue_sync(db, "discord_reply", {"thread_id": channel_id, "text": "I can't ingest right now: AI is not configured on this server."})
        db.commit()
        return {"messages": 0, "strategies": 0, "more": False}

    read = saved = 0
    titles: list[str] = []
    more = False
    for _ in range(PAGE_LIMIT):
        page = fetch_page(request, channel_id, cursor.last_message_id)
        if not page:
            break
        humans = [m for m in page if is_human_message(m)]
        page_saved = 0
        for group in chunk(humans):
            for strat in extract_strategies(render(group), map_name, team_id):
                author = (group[-1].get("author") or {}).get("username") or "Discord"
                save_strategy(
                    db, team_id, strat,
                    author=f"#{channel_name} via {author}", channel_name=channel_name, map_name=map_name,
                )
                titles.append(strat["title"].strip())
                page_saved += 1
        read += len(humans)
        saved += page_saved
        # One page at a time: a failure on the next page never re-reads this one.
        cursor.last_message_id = str(page[-1]["id"])
        cursor.messages_read += len(humans)
        cursor.strategies_saved += page_saved
        db.commit()
        if len(page) < PAGE_SIZE:
            break
    else:
        more = True
    cursor.last_run_at = datetime.now(UTC).replace(tzinfo=None)

    if more:
        enqueue_sync(db, "channel_ingest", {**payload, "continuation": True})
    if more and not titles and not payload.get("continuation"):
        text = f"Read {read} messages from #{channel_name} so far, no strategies yet; still reading."
    elif more:
        text = f"Read {read} messages from #{channel_name}, saved {saved} strategies; still reading the rest."
    elif read == 0:
        text = f"Nothing new in #{channel_name} since the last ingest."
    else:
        shown = "".join(f"\n- {t}" for t in titles[:10]) + (f"\n- …and {len(titles) - 10} more" if len(titles) > 10 else "")
        text = f"Read {read} messages from #{channel_name}, saved {saved} {'strategy' if saved == 1 else 'strategies'} to the stratbook." + (shown if titles else "")
    enqueue_sync(db, "discord_reply", {"thread_id": channel_id, "text": text})
    db.commit()
    logger.info(f"[Discord ingest] team {team_id} #{channel_name}: {read} messages, {saved} strategies, more={more}")
    return {"messages": read, "strategies": saved, "more": more}
