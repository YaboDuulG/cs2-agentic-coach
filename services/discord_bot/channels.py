"""
Channel groups: one Discord channel per map.
=============================================
A team binds a Discord *category* (channel group). Every text channel in it
is matched to a CS2 map by its name, and a strat's thread opens in the
channel for its map. This module is the name matching and the DB cache of
that mapping; it never calls Discord (sync.py lists the guild's channels and
hands them to `store_category_channels`).

Matching is by whole token, not substring, so #training is not de_train.
"""

from datetime import UTC, datetime
import re
from typing import Any

from sqlalchemy.orm import Session

from db.models import TeamDiscordChannel, TeamDiscordLink

GUILD_TEXT = 0
GUILD_CATEGORY = 4
# Public / private / announcement threads: their parent_id is a channel.
THREAD_TYPES = {10, 11, 12}

# alias token -> canonical map id. Order does not matter: tokens match whole.
_MAP_ALIASES: dict[str, str] = {
    "mirage": "de_mirage",
    "inferno": "de_inferno",
    "nuke": "de_nuke",
    "ancient": "de_ancient",
    "anubis": "de_anubis",
    "vertigo": "de_vertigo",
    "dust2": "de_dust2",
    "dustii": "de_dust2",
    "d2": "de_dust2",
    "overpass": "de_overpass",
    "train": "de_train",
    "cache": "de_cache",
    "cobblestone": "de_cbble",
    "cbble": "de_cbble",
    "cobble": "de_cbble",
    "tuscan": "de_tuscan",
    "office": "cs_office",
    "italy": "cs_italy",
}
_PREFIXES = ("de", "cs")

KNOWN_MAPS: tuple[str, ...] = tuple(dict.fromkeys(_MAP_ALIASES.values()))


def map_from_name(name: str | None) -> str | None:
    """Canonical map id for a channel name or a typed map, else None.

    "mirage", "de_mirage", "de-mirage", "🟧│mirage-strats", "Dust 2", "d2" and
    "demirage" all resolve; "training", "general" and "" do not.
    """
    tokens = [t for t in re.split(r"[^a-z0-9]+", (name or "").lower()) if t]
    if not tokens:
        return None
    candidates: list[str] = []
    for i, token in enumerate(tokens):
        candidates.append(token)
        # "de" glued to the map with no separator: demirage, csoffice.
        for prefix in _PREFIXES:
            if token.startswith(prefix) and len(token) > len(prefix):
                candidates.append(token[len(prefix) :])
        # A map split across two tokens: "dust-2", "dust 2", "dust_ii".
        if i + 1 < len(tokens):
            candidates.append(token + tokens[i + 1])
    for candidate in candidates:
        if candidate in _MAP_ALIASES:
            return _MAP_ALIASES[candidate]
    return None


def interaction_channel(payload: dict[str, Any]) -> dict[str, Any]:
    """The partial channel object Discord puts on every interaction:
    {id, name, type, parent_id}. Empty dict on older payload shapes."""
    channel = payload.get("channel")
    return channel if isinstance(channel, dict) else {}


def category_of(channel: dict[str, Any]) -> str | None:
    """Category id when the interaction happened in a text channel that sits
    in one. A thread's parent is its channel, not a category, so threads
    return None and the worker resolves the category from the channel list."""
    if channel.get("type") == GUILD_TEXT and channel.get("parent_id"):
        return str(channel["parent_id"])
    return None


def remember_channel(db: Session, link: TeamDiscordLink, channel: dict[str, Any]) -> bool:
    """Top up the cache from an interaction: a text channel of the bound group
    whose name resolves to a map. True when the cache changed; the caller
    commits."""
    if not link.category_id or category_of(channel) != link.category_id:
        return False
    map_name = map_from_name(channel.get("name"))
    if not map_name or not channel.get("id"):
        return False
    channel_id, name = str(channel["id"]), str(channel.get("name") or "")
    row = db.get(TeamDiscordChannel, channel_id)
    if row is not None and (row.team_id, row.map_name, row.name) == (link.team_id, map_name, name[:100]):
        return False
    _upsert(db, link.team_id, channel_id, map_name, name, None)
    return True


def map_for_channel(db: Session, link: TeamDiscordLink, channel: dict[str, Any]) -> str | None:
    """The map an interaction's channel stands for: the channel itself, or for
    a thread the channel it lives in. Cache first, then the channel's name."""
    ids = [channel.get("id")]
    if channel.get("type") in THREAD_TYPES:
        ids.append(channel.get("parent_id"))
    for channel_id in filter(None, ids):
        row = db.get(TeamDiscordChannel, str(channel_id))
        if row is not None and row.team_id == link.team_id:
            return row.map_name
    if link.category_id and category_of(channel) == link.category_id:
        return map_from_name(channel.get("name"))
    return None


def channel_for_map(db: Session, team_id: str, map_name: str) -> str | None:
    """Channel id for a map in the team's group; first by position when two
    channels resolve to the same map."""
    row = (
        db.query(TeamDiscordChannel)
        .filter(TeamDiscordChannel.team_id == team_id, TeamDiscordChannel.map_name == map_name)
        .order_by(TeamDiscordChannel.position, TeamDiscordChannel.channel_id)
        .first()
    )
    return row.channel_id if row else None


def list_channels(db: Session, team_id: str) -> list[TeamDiscordChannel]:
    """Docstring for list_channels."""
    return (
        db.query(TeamDiscordChannel)
        .filter(TeamDiscordChannel.team_id == team_id)
        .order_by(TeamDiscordChannel.position, TeamDiscordChannel.name)
        .all()
    )


def store_category_channels(
    db: Session, link: TeamDiscordLink, guild_channels: list[dict[str, Any]]
) -> list[TeamDiscordChannel]:
    """Rebuild the cache from Discord's channel list for the guild. Resolves
    the category from the bound channel when bind did not carry it. Channels
    that left the group or stopped resolving are dropped. Caller commits."""
    by_id = {str(c.get("id")): c for c in guild_channels}
    if not link.category_id:
        bound = by_id.get(link.channel_id) or {}
        if bound.get("type") in THREAD_TYPES:
            bound = by_id.get(str(bound.get("parent_id"))) or {}
        link.category_id = category_of(bound)

    keep: set[str] = set()
    if link.category_id:
        for channel in guild_channels:
            if channel.get("type") != GUILD_TEXT:
                continue
            if str(channel.get("parent_id") or "") != link.category_id:
                continue
            map_name = map_from_name(channel.get("name"))
            if not map_name:
                continue
            channel_id = str(channel["id"])
            keep.add(channel_id)
            _upsert(
                db, link.team_id, channel_id, map_name,
                str(channel.get("name") or ""), int(channel.get("position") or 0),
            )

    db.flush()
    for row in db.query(TeamDiscordChannel).filter(TeamDiscordChannel.team_id == link.team_id):
        if row.channel_id not in keep:
            db.delete(row)
    db.flush()
    return list_channels(db, link.team_id)


def _upsert(
    db: Session, team_id: str, channel_id: str, map_name: str, name: str, position: int | None
) -> None:
    """Docstring for _upsert."""
    row = db.get(TeamDiscordChannel, channel_id)
    if row is None:
        row = TeamDiscordChannel(channel_id=channel_id, team_id=team_id, position=position or 0)
        db.add(row)
    row.team_id = team_id
    row.map_name = map_name
    row.name = name[:100]
    if position is not None:
        row.position = position
    row.updated_at = datetime.now(UTC)
