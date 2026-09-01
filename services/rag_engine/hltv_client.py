"""
HLTV results client — thin HTTP layer for the delta monitor.
==============================================================
Talks to an unofficial HLTV API mirror configured via HLTV_API_BASE.
Every request retries with exponential backoff + full jitter (tenacity),
honoring Retry-After on 429/5xx. No base URL or LOCAL_MODE=true swaps in
FixtureClient, which serves canned S/A-tier results with zero network.

Result shape (normalized, what the delta monitor consumes):
    {
        "hltv_match_id": "2371001",
        "event": {"hltv_event_id": 7801, "name": "...", "tier": "S", "ends_at": iso | None},
        "team_a": "...", "team_b": "...",
        "map_name": "de_mirage",
        "played_at": iso | None,
        "demo_url": http url | None,          # source link — NOT stored as bytes anywhere
        "patch_version": "1.41.2" | None,
    }
"""

import logging
import os

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)
from tenacity.wait import wait_base

logger = logging.getLogger(__name__)

ALLOWED_TIERS = ("S", "A")
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_ATTEMPTS = 5
USER_AGENT = "DemoSage-RAG/1.0"


class RetryableHTTPError(Exception):
    """A 429/5xx response worth retrying, optionally carrying Retry-After seconds."""

    def __init__(self, status_code: int, retry_after: float | None = None):
        """Docstring for __init__."""
        super().__init__(f"HTTP {status_code} (retry_after={retry_after})")
        self.status_code = status_code
        self.retry_after = retry_after


class _wait_retry_after(wait_base):
    """Honor the server's Retry-After when present, else full-jitter exponential."""

    def __init__(self, fallback: wait_base):
        """Docstring for __init__."""
        self.fallback = fallback

    def __call__(self, retry_state) -> float:
        """Docstring for __call__."""
        outcome = retry_state.outcome
        exc = outcome.exception() if outcome is not None else None
        if isinstance(exc, RetryableHTTPError) and exc.retry_after is not None:
            return exc.retry_after
        return self.fallback(retry_state)


def _parse_retry_after(value: str | None) -> float | None:
    """Docstring for _parse_retry_after."""
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None  # HTTP-date form — fall back to jittered backoff


def _tier_ok(result: dict) -> bool:
    """Docstring for _tier_ok."""
    return (result.get("event") or {}).get("tier") in ALLOWED_TIERS


class HLTVClient:
    """HTTP client over the unofficial HLTV endpoints at HLTV_API_BASE."""

    def __init__(self, base_url: str | None = None, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        """Docstring for __init__."""
        self.base_url = (base_url or os.environ.get("HLTV_API_BASE", "")).rstrip("/")
        if not self.base_url:
            raise ValueError("HLTVClient needs a base URL (HLTV_API_BASE)")
        self.timeout = timeout

    def recent_results(self, limit: int = 20) -> list[dict]:
        """Recently completed matches, S/A-tier events only, newest first."""
        payload = self._get_json("/results", params={"limit": limit})
        results = payload if isinstance(payload, list) else payload.get("results") or []
        return [r for r in results if _tier_ok(r)][:limit]

    @retry(
        reraise=True,
        stop=stop_after_attempt(MAX_ATTEMPTS),
        wait=_wait_retry_after(wait_random_exponential(multiplier=0.5, max=30)),
        retry=retry_if_exception_type((RetryableHTTPError, httpx.TransportError)),
    )
    def _get_json(self, path: str, params: dict | None = None):
        """GET a JSON document with backoff on 429/5xx and transport errors."""
        resp = httpx.get(
            f"{self.base_url}{path}",
            params=params,
            timeout=self.timeout,
            headers={"User-Agent": USER_AGENT},
        )
        if resp.status_code == 429 or resp.status_code >= 500:
            raise RetryableHTTPError(
                resp.status_code, _parse_retry_after(resp.headers.get("Retry-After"))
            )
        resp.raise_for_status()
        return resp.json()


# Canned results served in LOCAL_MODE / CI — shaped exactly like the live API.
_FIXTURE_RESULTS: list[dict] = [
    {
        "hltv_match_id": "2371001",
        "event": {
            "hltv_event_id": 7801,
            "name": "IEM Katowice 2026",
            "tier": "S",
            "ends_at": "2026-02-15T22:00:00+00:00",
        },
        "team_a": "Natus Vincere",
        "team_b": "FaZe",
        "map_name": "de_mirage",
        "played_at": "2026-02-14T18:30:00+00:00",
        "demo_url": "https://example.test/download/demo/2371001",
        "patch_version": "1.41.2",
    },
    {
        "hltv_match_id": "2371002",
        "event": {
            "hltv_event_id": 7801,
            "name": "IEM Katowice 2026",
            "tier": "S",
            "ends_at": "2026-02-15T22:00:00+00:00",
        },
        "team_a": "Vitality",
        "team_b": "Spirit",
        "map_name": "de_nuke",
        "played_at": "2026-02-14T20:00:00+00:00",
        "demo_url": "https://example.test/download/demo/2371002",
        "patch_version": "1.41.2",
    },
    {
        "hltv_match_id": "2371003",
        "event": {
            "hltv_event_id": 7912,
            "name": "ESL Challenger Melbourne",
            "tier": "A",
            "ends_at": "2026-02-20T10:00:00+00:00",
        },
        "team_a": "FURIA",
        "team_b": "MOUZ",
        "map_name": "de_inferno",
        "played_at": "2026-02-15T09:00:00+00:00",
        "demo_url": "https://example.test/download/demo/2371003",
        "patch_version": "1.41.2",
    },
]


class FixtureClient:
    """Offline stand-in for HLTVClient — same interface, inline canned data."""

    def __init__(self, results: list[dict] | None = None):
        """Docstring for __init__."""
        self._results = results if results is not None else _FIXTURE_RESULTS

    def recent_results(self, limit: int = 20) -> list[dict]:
        """Docstring for recent_results."""
        return [dict(r) for r in self._results if _tier_ok(r)][:limit]


def get_client() -> HLTVClient | FixtureClient:
    """LOCAL_MODE or missing HLTV_API_BASE → fixtures; otherwise the live client."""
    base = os.environ.get("HLTV_API_BASE", "")
    if os.getenv("LOCAL_MODE", "false").lower() == "true" or not base:
        logger.info("[HLTV] Using FixtureClient (LOCAL_MODE or no HLTV_API_BASE)")
        return FixtureClient()
    return HLTVClient(base_url=base)
