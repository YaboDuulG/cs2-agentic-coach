"""
ESEA season calendar — the billing period for the Team tier.
=============================================================
Team is not a monthly subscription. A team pays a flat fee for one ESEA
season and keeps access until the next season starts, so the off-season gap
is covered and a renewal is seamless.

Known seasons come from ESEA's published 2026 calendar (dust2.us, "ESEA
releases 2026 calendar"; ESEA notes the dates are subject to change). Later
seasons are PROJECTED from that cadence — four seasons a year, eleven weeks
each, thirteen weeks between starts — and flagged `projected=True` so the
pricing page can say "dates to be confirmed". Update KNOWN_SEASONS when ESEA
publishes the next calendar; nothing else needs to change.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

SEASON_LENGTH = timedelta(days=76)  # Monday start → Sunday end, eleven weeks
SEASON_CADENCE = timedelta(days=91)  # thirteen weeks between season starts
TEAM_SEASON_PRICE_USD = 300


@dataclass(frozen=True)
class Season:
    """Docstring for Season."""
    number: int
    start: date
    end: date
    projected: bool = False

    @property
    def label(self) -> str:
        """Docstring for label."""
        return f"ESEA Season {self.number}"


KNOWN_SEASONS: tuple[Season, ...] = (
    Season(56, date(2026, 1, 13), date(2026, 3, 23)),
    Season(57, date(2026, 4, 6), date(2026, 6, 21)),
    Season(58, date(2026, 7, 13), date(2026, 9, 27)),
    Season(59, date(2026, 10, 5), date(2026, 12, 20)),
)

_FIRST_KNOWN = KNOWN_SEASONS[0].number
_LAST_KNOWN = KNOWN_SEASONS[-1]


def season(number: int) -> Season:
    """The season with this number: published if known, otherwise projected."""
    if number < _FIRST_KNOWN:
        raise ValueError(f"season {number} predates the billing calendar")
    for s in KNOWN_SEASONS:
        if s.number == number:
            return s
    steps = number - _LAST_KNOWN.number
    start = _LAST_KNOWN.start + SEASON_CADENCE * steps
    return Season(number, start, start + SEASON_LENGTH, projected=True)


def _today(now: datetime | None) -> date:
    """Docstring for _today."""
    return (now or datetime.now(UTC)).date()


def season_for_date(now: datetime | None = None) -> Season | None:
    """The season in progress on `now`, or None during an off-season gap."""
    today = _today(now)
    n = _FIRST_KNOWN
    while True:
        s = season(n)
        if s.start <= today <= s.end:
            return s
        if s.start > today:
            return None
        n += 1


def purchasable_season(now: datetime | None = None) -> Season:
    """What a team buys today: the season in progress, else the next one."""
    today = _today(now)
    n = _FIRST_KNOWN
    while True:
        s = season(n)
        if today <= s.end:
            return s
        n += 1


def access_until(s: Season) -> datetime:
    """A season purchase lasts until the NEXT season starts (naive UTC)."""
    nxt = season(s.number + 1)
    return datetime(nxt.start.year, nxt.start.month, nxt.start.day)


def upcoming(count: int = 3, now: datetime | None = None) -> list[Season]:
    """The purchasable season and the ones after it."""
    first = purchasable_season(now)
    return [season(first.number + i) for i in range(max(1, count))]


def to_dict(s: Season) -> dict:
    """Docstring for to_dict."""
    return {
        "number": s.number,
        "label": s.label,
        "start": s.start.isoformat(),
        "end": s.end.isoformat(),
        "access_until": access_until(s).isoformat(),
        "projected": s.projected,
        "price_usd": TEAM_SEASON_PRICE_USD,
    }
