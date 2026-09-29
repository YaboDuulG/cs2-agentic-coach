"""ESEA season calendar: published dates, projection, purchase window, access."""

from datetime import date, datetime

import pytest

from services.billing.seasons import (
    access_until,
    purchasable_season,
    season,
    season_for_date,
    upcoming,
)


def test_published_seasons_match_the_2026_calendar():
    """Docstring for test_published_seasons_match_the_2026_calendar."""
    s59 = season(59)
    assert (s59.start, s59.end, s59.projected) == (date(2026, 10, 5), date(2026, 12, 20), False)
    assert season(56).start == date(2026, 1, 13)
    assert season(58).end == date(2026, 9, 27)


def test_projection_continues_the_cadence():
    """Four seasons a year: S60 lands in early January 2027, S63 in October."""
    s60 = season(60)
    assert s60.projected and s60.start == date(2027, 1, 4) and s60.end == date(2027, 3, 21)
    assert s60.start.weekday() == 0 and s60.end.weekday() == 6
    assert season(63).start.month == 10 and season(63).start.year == 2027


def test_season_for_date_and_gaps():
    """Docstring for test_season_for_date_and_gaps."""
    assert season_for_date(datetime(2026, 8, 1)).number == 58
    assert season_for_date(datetime(2026, 9, 29)) is None  # between S58 and S59
    assert season_for_date(datetime(2026, 10, 5)).number == 59


def test_purchasable_season_is_current_or_next():
    """Docstring for test_purchasable_season_is_current_or_next."""
    assert purchasable_season(datetime(2026, 8, 1)).number == 58
    assert purchasable_season(datetime(2026, 9, 29)).number == 59
    assert purchasable_season(datetime(2026, 12, 21)).number == 60


def test_access_runs_until_the_next_season_starts():
    """Docstring for test_access_runs_until_the_next_season_starts."""
    assert access_until(season(59)) == datetime(2027, 1, 4)


def test_upcoming_and_bounds():
    """Docstring for test_upcoming_and_bounds."""
    nums = [s.number for s in upcoming(3, datetime(2026, 9, 29))]
    assert nums == [59, 60, 61]
    with pytest.raises(ValueError):
        season(55)
