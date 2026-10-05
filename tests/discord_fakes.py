"""Test doubles for the Discord suites: a fake Discord REST API that records
what the worker sends, and a signer that produces the Ed25519 headers Discord
puts on every interaction."""

import json
import time
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

GUILD = "guild-1"
CATEGORY = "cat-maps"

# A server laid out the way the team uses Discord: one channel group with a
# text channel per map, plus channels that must NOT be picked up.
GUILD_CHANNELS: list[dict[str, Any]] = [
    {"id": CATEGORY, "type": 4, "name": "Maps", "position": 0},
    {"id": "c-mirage", "type": 0, "name": "mirage", "parent_id": CATEGORY, "position": 1},
    {"id": "c-inferno", "type": 0, "name": "de-inferno", "parent_id": CATEGORY, "position": 2},
    {"id": "c-dust2", "type": 0, "name": "🟧│dust-2", "parent_id": CATEGORY, "position": 3},
    {"id": "c-general", "type": 0, "name": "strat-general", "parent_id": CATEGORY, "position": 4},
    {"id": "c-training", "type": 0, "name": "training", "parent_id": CATEGORY, "position": 5},
    {"id": "v-nuke", "type": 2, "name": "nuke", "parent_id": CATEGORY, "position": 6},
    {"id": "cat-other", "type": 4, "name": "Community", "position": 7},
    {"id": "c-other-mirage", "type": 0, "name": "mirage", "parent_id": "cat-other", "position": 8},
    {"id": "c-lobby", "type": 0, "name": "lobby", "parent_id": None, "position": 9},
]


def channel_obj(channel_id: str) -> dict[str, Any]:
    """The partial channel Discord attaches to an interaction from this channel."""
    c = next(c for c in GUILD_CHANNELS if c["id"] == channel_id)
    return {"id": c["id"], "name": c["name"], "type": c["type"], "parent_id": c.get("parent_id")}


def thread_obj(thread_id: str, parent_channel_id: str) -> dict[str, Any]:
    """Docstring for thread_obj."""
    return {"id": thread_id, "name": "[strat] thread", "type": 11, "parent_id": parent_channel_id}


class FakeDiscord:
    """Stands in for services.discord_bot.sync._discord_request."""

    def __init__(self, channels: list[dict[str, Any]] | None = None) -> None:
        self.channels = channels if channels is not None else GUILD_CHANNELS
        self.calls: list[tuple[str, str, dict | None]] = []
        self.threads: dict[str, str] = {}  # thread id -> parent channel id
        self.messages: list[tuple[str, dict]] = []  # (channel or thread id, body)
        self.history: dict[str, list[dict[str, Any]]] = {}  # channel id -> messages, oldest first

    def seed_history(self, channel_id: str, lines: list[str | dict[str, Any]], start_id: int = 1) -> None:
        """Messages in a channel. A string is a human message; a dict is
        merged over the default shape (e.g. {"content": "x", "author": {"bot": True}})."""
        messages = self.history.setdefault(channel_id, [])
        next_id = start_id + len(messages)
        for i, line in enumerate(lines):
            base = {
                "id": str(next_id + i),
                "type": 0,
                "content": line if isinstance(line, str) else line.get("content", ""),
                "author": {"id": "u-1", "username": "igl", "global_name": "IGL"},
                "timestamp": f"2026-10-01T18:{(next_id + i) % 60:02d}:00.000000+00:00",
            }
            messages.append({**base, **line} if isinstance(line, dict) else base)

    def __call__(self, method: str, path: str, json_body: dict | None = None) -> Any:
        self.calls.append((method, path, json_body))
        if method == "GET" and "/messages?" in path:
            channel_id = path.split("/")[2]
            params = dict(p.split("=") for p in path.split("?", 1)[1].split("&"))
            after, limit = int(params.get("after", 0)), int(params.get("limit", 100))
            newer = [m for m in self.history.get(channel_id, []) if int(m["id"]) > after]
            # Discord hands the page back newest first; the reader must sort.
            return list(reversed(newer[:limit]))
        if method == "GET" and path.endswith("/channels"):
            return self.channels
        if method == "POST" and path.endswith("/threads"):
            parent = path.split("/")[2]
            thread_id = f"thread-{len(self.threads) + 1}"
            self.threads[thread_id] = parent
            return {"id": thread_id}
        if method == "POST" and path.endswith("/messages"):
            self.messages.append((path.split("/")[2], json_body or {}))
            return {"id": f"msg-{len(self.messages)}"}
        raise AssertionError(f"unexpected Discord call {method} {path}")

    def paths(self, method: str) -> list[str]:
        """Docstring for paths."""
        return [p for m, p, _ in self.calls if m == method]


class DiscordSigner:
    """Signs request bodies the way Discord does: Ed25519 over timestamp+body."""

    def __init__(self) -> None:
        self._key = Ed25519PrivateKey.generate()
        self.public_key_hex = (
            self._key.public_key()
            .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            .hex()
        )

    def request(self, payload: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
        """(raw body, headers) for one interaction."""
        body = json.dumps(payload).encode()
        timestamp = str(int(time.time()))
        signature = self._key.sign(timestamp.encode() + body).hex()
        return body, {
            "Content-Type": "application/json",
            "X-Signature-Ed25519": signature,
            "X-Signature-Timestamp": timestamp,
        }


def command(
    sub: str,
    options: dict[str, Any] | None = None,
    *,
    channel: dict[str, Any] | None = None,
    guild_id: str = GUILD,
    user_id: str = "discord-user-1",
) -> dict[str, Any]:
    """An APPLICATION_COMMAND payload for /strat <sub>, shaped like Discord's."""
    channel = channel or channel_obj("c-mirage")
    return {
        "type": 2,
        "guild_id": guild_id,
        "channel_id": channel["id"],
        "channel": channel,
        "member": {"user": {"id": user_id}},
        "data": {
            "name": "strat",
            "options": [
                {
                    "type": 1,
                    "name": sub,
                    "options": [{"name": k, "value": v} for k, v in (options or {}).items()],
                }
            ],
        },
    }


def button(custom_id: str, *, guild_id: str = GUILD, user_id: str = "discord-user-2") -> dict[str, Any]:
    """A MESSAGE_COMPONENT payload for a button press."""
    return {
        "type": 3,
        "guild_id": guild_id,
        "member": {"user": {"id": user_id}},
        "data": {"custom_id": custom_id, "component_type": 2},
    }
