"""
Discord HTTP Interactions endpoint.
====================================
POST /api/discord/interactions — Discord signs every request with the app's
Ed25519 key; we verify against DISCORD_PUBLIC_KEY before touching the body.

Handled here:
    PING                → PONG (Discord's endpoint validation)
    /strat bind code:   → cryptographic guild↔team binding (bind code HMAC);
                          run inside a channel group it binds the whole group
    /strat channels     → which channel of the group stands for which map
    /strat ingest       → read this channel since the last ingest and save the
                          strategies it describes (worker job)
    /strat create ...   → new DRAFT strat via the stratbook service; the map
                          defaults to the map channel the command ran in
    /strat view ...     → list matching strats + status + revision
    /strat analyze ...  → best-effort round findings from cached coaching notes
    /strat adapt ...    → enqueue an `ai_adapt` outbox row (in-thread only)
    approve button      → IN_REVIEW → ACTIVE transition

Hard rule: this handler does DB work and outbox INSERTs only. It never calls
Discord REST or an LLM — replies are interaction responses, and everything
slow rides the sync outbox (services/discord_bot/sync.py).
"""

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from db.database import get_session
from db.models import Match, Strat, StratRevision, StratStatus, Team, TeamDiscordLink
from services.discord_bot.channels import (
    category_of,
    channel_for_map,
    interaction_channel,
    list_channels,
    map_for_channel,
    map_from_name,
    remember_channel,
)
from services.discord_bot.security import verify_bind_code, verify_signature
from services.stratbook.service import (
    InvalidTransition,
    create_strat,
    enqueue_sync,
    transition,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Interaction types (Discord API v10)
PING = 1
APPLICATION_COMMAND = 2
MESSAGE_COMPONENT = 3

# Interaction response types
PONG = 1
CHANNEL_MESSAGE_WITH_SOURCE = 4
UPDATE_MESSAGE = 7

EPHEMERAL = 64


def _reply(content: str, *, ephemeral: bool = False) -> dict[str, Any]:
    """A type-4 CHANNEL_MESSAGE_WITH_SOURCE response."""
    data: dict[str, Any] = {"content": content}
    if ephemeral:
        data["flags"] = EPHEMERAL
    return {"type": CHANNEL_MESSAGE_WITH_SOURCE, "data": data}


def _subcommand(data: dict) -> tuple[str, dict[str, Any]]:
    """Extract (subcommand name, {option: value}) from an APPLICATION_COMMAND."""
    options = data.get("options") or []
    if not options:
        return "", {}
    sub = options[0]
    values = {opt.get("name"): opt.get("value") for opt in (sub.get("options") or [])}
    return sub.get("name") or "", values


def _invoker_id(payload: dict) -> str:
    """Discord user id of whoever ran the command (guild or DM shape)."""
    member_user = (payload.get("member") or {}).get("user") or {}
    return member_user.get("id") or (payload.get("user") or {}).get("id") or "unknown"


def _guild_link(db: Session, guild_id: str | None) -> TeamDiscordLink | None:
    """Docstring for _guild_link."""
    if not guild_id:
        return None
    return db.query(TeamDiscordLink).filter(TeamDiscordLink.guild_id == guild_id).first()


@router.post("/interactions", summary="Discord HTTP interactions endpoint")
async def discord_interactions(request: Request, db: Session = Depends(get_session)):
    """Verify the Ed25519 signature, then dispatch the interaction."""
    body = await request.body()

    public_key = os.environ.get("DISCORD_PUBLIC_KEY", "")
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    if public_key:
        signature = request.headers.get("X-Signature-Ed25519", "")
        timestamp = request.headers.get("X-Signature-Timestamp", "")
        if not signature or not timestamp or not verify_signature(
            public_key, signature, timestamp, body
        ):
            raise HTTPException(status_code=401, detail="Bad request signature")
    elif not local_mode:
        # Fail closed outside local dev: an unverifiable endpoint is not an endpoint.
        raise HTTPException(status_code=401, detail="DISCORD_PUBLIC_KEY is not configured")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    itype = payload.get("type")
    if itype == PING:
        return {"type": PONG}
    if itype == APPLICATION_COMMAND:
        return _handle_command(db, payload)
    if itype == MESSAGE_COMPONENT:
        return _handle_component(db, payload)
    return _reply("Unsupported interaction type.", ephemeral=True)


# ---------------------------------------------------------------------------
# Slash commands — /strat <subcommand>
# ---------------------------------------------------------------------------


def _handle_command(db: Session, payload: dict) -> dict:
    """Docstring for _handle_command."""
    data = payload.get("data") or {}
    if data.get("name") != "strat":
        return _reply(f"Unknown command {data.get('name')!r}.", ephemeral=True)

    sub, opts = _subcommand(data)
    guild_id = payload.get("guild_id")
    channel_id = payload.get("channel_id")
    user_id = _invoker_id(payload)
    channel = interaction_channel(payload)

    if sub == "bind":
        return _cmd_bind(db, opts, guild_id, channel_id, user_id, channel)

    # Every other subcommand requires the guild to be bound to a team.
    link = _guild_link(db, guild_id)
    if link is None:
        return _reply(
            "This server isn't linked to a team yet. A team owner can run "
            "`/strat bind code:<bind code>` (code from the web app).",
            ephemeral=True,
        )

    # Every command teaches us one channel of the group; the worker's
    # channels_sync job is what learns the rest. Committed here because the
    # read-only subcommands never commit.
    if remember_channel(db, link, channel):
        db.commit()
    channel_map = map_for_channel(db, link, channel)

    if sub == "channels":
        return _cmd_channels(db, link)
    if sub == "ingest":
        return _cmd_ingest(db, link, channel, channel_map, user_id)
    if sub == "create":
        return _cmd_create(db, opts, link, user_id, channel_map)
    if sub == "view":
        return _cmd_view(db, opts, link, channel_map)
    if sub == "analyze":
        return _cmd_analyze(db, opts, link)
    if sub == "adapt":
        return _cmd_adapt(db, opts, link, channel_id, user_id)
    return _reply(f"Unknown subcommand {sub!r}.", ephemeral=True)


def _cmd_bind(
    db: Session,
    opts: dict,
    guild_id: str | None,
    channel_id: str | None,
    user_id: str,
    channel: dict[str, Any],
) -> dict:
    """Verify the HMAC bind code, then link this guild to the team. Run in a
    channel that sits in a channel group (category), the whole group is bound:
    one channel per map, matched by name. Otherwise this one channel is."""
    if not guild_id or not channel_id:
        return _reply("`/strat bind` only works inside a server channel.", ephemeral=True)

    team_id = verify_bind_code(str(opts.get("code") or ""))
    if team_id is None:
        return _reply("That bind code is invalid.", ephemeral=True)
    team = db.get(Team, team_id)
    if team is None:
        return _reply("That bind code points at a team that no longer exists.", ephemeral=True)

    if _guild_link(db, guild_id) is not None:
        return _reply("This server is already bound to a team.", ephemeral=True)
    if db.get(TeamDiscordLink, team_id) is not None:
        return _reply("That team is already bound to another server.", ephemeral=True)

    category_id = category_of(channel)
    link = TeamDiscordLink(
        team_id=team_id,
        guild_id=guild_id,
        channel_id=channel_id,
        category_id=category_id,
        bound_by=user_id,
    )
    db.add(link)
    db.flush()
    remember_channel(db, link, channel)
    # The worker lists the guild's channels and maps the rest of the group
    # (and finds the category itself when bind ran from inside a thread).
    enqueue_sync(db, "channels_sync", {"team_id": team_id})
    db.commit()
    logger.info(
        f"[Discord] guild {guild_id} bound to team {team_id} by {user_id} "
        f"(category={category_id or 'none'})"
    )
    if category_id:
        return _reply(
            f"Bound this server to **{team.name}**. Every channel in this channel group "
            "whose name is a map (mirage, inferno, dust2, ...) now gets that map's strats "
            "as threads. Run `/strat channels` to see the mapping."
        )
    return _reply(
        f"Bound this server to **{team.name}**. This channel is not in a channel group, "
        "so every strat will sync into this channel."
    )


def _cmd_channels(db: Session, link: TeamDiscordLink) -> dict:
    """List the map channels of the bound group and queue a refresh."""
    enqueue_sync(db, "channels_sync", {"team_id": link.team_id})
    db.commit()
    rows = list_channels(db, link.team_id)
    if not link.category_id:
        return _reply(
            f"Single-channel mode: every strat syncs into <#{link.channel_id}>. To use one "
            "channel per map, put the channels in a channel group and bind from inside it.",
            ephemeral=True,
        )
    if not rows:
        return _reply(
            "No map channels found in this channel group yet. Name a channel after its map "
            "(mirage, de-inferno, dust2, ...) and run this again in a minute; I just "
            "queued a refresh.",
            ephemeral=True,
        )
    lines = [f"- <#{r.channel_id}> → {r.map_name}" for r in rows]
    return _reply(
        "Map channels in this group:\n"
        + "\n".join(lines)
        + f"\nAny other map falls back to <#{link.channel_id}>.",
        ephemeral=True,
    )


def _cmd_ingest(
    db: Session, link: TeamDiscordLink, channel: dict[str, Any], channel_map: str | None, user_id: str
) -> dict:
    """Queue a read of this channel's history since the last ingest (the
    first run reads it from the beginning). The worker does the reading and
    replies here when it is done."""
    from db.models import TeamDiscordIngestCursor  # noqa: PLC0415

    channel_id = str(channel.get("id") or "")
    if not channel_id or channel.get("type") not in (0, 10, 11, 12):
        return _reply("`/strat ingest` works in a text channel or a thread.", ephemeral=True)
    channel_name = str(channel.get("name") or channel_id)
    enqueue_sync(
        db,
        "channel_ingest",
        {
            "team_id": link.team_id,
            "channel_id": channel_id,
            "channel_name": channel_name,
            "map_name": channel_map,
            "requested_by": user_id,
        },
    )
    db.commit()
    cursor = db.get(TeamDiscordIngestCursor, channel_id)
    since = (
        f"since {cursor.last_run_at.strftime('%d %b %H:%M')} UTC"
        if cursor is not None and cursor.last_run_at
        else "from the beginning"
    )
    return _reply(
        f"Reading <#{channel_id}> {since}"
        + (f" as {channel_map} strategies" if channel_map else "")
        + ". I'll post what I found here in a minute."
    )


def _cmd_create(
    db: Session, opts: dict, link: TeamDiscordLink, user_id: str, channel_map: str | None
) -> dict:
    """Docstring for _cmd_create."""
    title = str(opts.get("title") or "").strip()
    if not title:
        return _reply("A strat needs a title.", ephemeral=True)
    typed_map = str(opts.get("map") or "").strip()
    # A typed map wins; an unknown one is kept as typed rather than rejected.
    map_name = (map_from_name(typed_map) or typed_map) if typed_map else channel_map
    if not map_name:
        return _reply(
            "Which map? Run this in a map channel, or pass `map:` (e.g. `map:mirage`).",
            ephemeral=True,
        )
    try:
        strat = create_strat(
            db,
            team_id=link.team_id,
            title=title,
            map_name=map_name,
            side=str(opts.get("side") or "T"),
            buy_type=str(opts.get("buy") or "full_buy"),
            canvas={},
            description="",
            utility=None,
            author_id=f"discord:{user_id}",
            source="discord",
        )
    except ValueError as e:
        return _reply(str(e), ephemeral=True)
    db.commit()
    home = channel_for_map(db, link.team_id, strat.map_name) or link.channel_id
    return _reply(
        f"Created **{strat.title}** ({strat.map_name}, {strat.side}, {strat.buy_type}) "
        f"as DRAFT. A thread will open in <#{home}> once it syncs."
    )


def _cmd_view(db: Session, opts: dict, link: TeamDiscordLink, channel_map: str | None) -> dict:
    """Docstring for _cmd_view."""
    typed_map = str(opts.get("map") or "").strip()
    map_name = (map_from_name(typed_map) or typed_map) if typed_map else channel_map
    if not map_name:
        return _reply(
            "Which map? Run this in a map channel, or pass `map:` (e.g. `map:mirage`).",
            ephemeral=True,
        )
    query = db.query(Strat).filter(Strat.team_id == link.team_id, Strat.map_name == map_name)
    name = str(opts.get("name") or "").strip()
    if name:
        query = query.filter(Strat.title.ilike(f"%{name}%"))
    strats = query.order_by(Strat.updated_at.desc()).limit(15).all()
    if not strats:
        return _reply(f"No strats found for {map_name}.", ephemeral=True)

    lines = []
    for strat in strats:
        rev = (
            db.get(StratRevision, strat.current_revision_id)
            if strat.current_revision_id
            else None
        )
        rev_no = rev.revision_no if rev else 0
        status = StratStatus(strat.status).value
        lines.append(f"- **{strat.title}** ({strat.side}, {strat.buy_type}) — {status}, rev {rev_no}")
    return _reply(f"Strats for **{map_name}**:\n" + "\n".join(lines))


def _cmd_analyze(db: Session, opts: dict, link: TeamDiscordLink) -> dict:
    """Best-effort: pull cached coaching findings for one round of a team match.

    round_id is either `<match_id>:<round_num>` or a bare round number (which
    targets the team's most recent analyzed match).
    """
    raw = str(opts.get("round_id") or "").strip()
    match_id, _, round_part = raw.rpartition(":")
    try:
        round_num = int(round_part)
    except ValueError:
        return _reply(
            "round_id must be a round number or `<match_id>:<round>`.", ephemeral=True
        )

    query = db.query(Match).filter(
        Match.team_id == link.team_id, Match.coaching_notes.isnot(None)
    )
    if match_id:
        query = query.filter(Match.match_id == match_id)
    match = query.order_by(Match.created_at.desc()).first()
    if match is None:
        return _reply("No analyzed match with coaching notes found for this team.", ephemeral=True)

    try:
        notes = json.loads(match.coaching_notes or "{}")
    except json.JSONDecodeError:
        notes = {}
    findings = [
        f
        for f in (notes.get("findings") or [])
        if round_num in (f.get("rounds") or [])
    ]
    if not findings:
        return _reply(
            f"No findings touch round {round_num} of match {match.match_id}.", ephemeral=True
        )
    lines = [
        f"- [{(f.get('severity') or 'medium').upper()}] {f.get('claim', '')}"
        for f in findings[:5]
    ]
    return _reply(
        f"Findings for round {round_num} ({match.map_name}, match {match.match_id}):\n"
        + "\n".join(lines),
        ephemeral=True,
    )


def _cmd_adapt(
    db: Session, opts: dict, link: TeamDiscordLink, channel_id: str | None, user_id: str
) -> dict:
    """Enqueue an ai_adapt outbox row — only from inside a bound strat thread."""
    strat = (
        db.query(Strat)
        .filter(Strat.team_id == link.team_id, Strat.discord_thread_id == channel_id)
        .first()
        if channel_id
        else None
    )
    if strat is None:
        return _reply(
            "`/strat adapt` only works inside a strat's own thread.", ephemeral=True
        )
    prompt = str(opts.get("prompt") or "").strip()
    if not prompt:
        return _reply("Tell me what to change: `/strat adapt prompt:<...>`.", ephemeral=True)

    enqueue_sync(
        db,
        "ai_adapt",
        {
            "strat_id": strat.id,
            "prompt": prompt,
            "thread_id": channel_id,
            "requested_by": user_id,
        },
    )
    db.commit()
    return _reply(f"Working on it — adapting **{strat.title}**. I'll post the result here.")


# ---------------------------------------------------------------------------
# Message components — the approve button
# ---------------------------------------------------------------------------


def _handle_component(db: Session, payload: dict) -> dict:
    """Docstring for _handle_component."""
    custom_id = (payload.get("data") or {}).get("custom_id") or ""
    action, _, strat_id = custom_id.partition(":")
    if action != "strat_approve" or not strat_id:
        return _reply(f"Unknown component {custom_id!r}.", ephemeral=True)

    link = _guild_link(db, payload.get("guild_id"))
    strat = db.get(Strat, strat_id)
    if link is None or strat is None or strat.team_id != link.team_id:
        return _reply("This strat doesn't belong to this server.", ephemeral=True)

    try:
        transition(db, strat, StratStatus.ACTIVE, actor=f"discord:{_invoker_id(payload)}")
    except InvalidTransition as e:
        return _reply(str(e), ephemeral=True)
    db.commit()
    # UPDATE_MESSAGE edits the embed message the button was on: note the
    # approval and strip the button so it can't be double-clicked.
    return {
        "type": UPDATE_MESSAGE,
        "data": {"content": f"**{strat.title}** approved — now ACTIVE.", "components": []},
    }
