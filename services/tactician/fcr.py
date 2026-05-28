"""
Tactician — First Contact Resolution (FCR) Analysis
=====================================================
Evaluates the first kill in every round to determine whether the team
won or lost the "first contact" and what impact that had on the round.

Key concepts:
    - First Contact: the first kill event in a round (by tick order)
    - FCR Win:  one of our team made the first kill
    - FCR Loss: opponent made the first kill
    - Impact:   rounds with FCR win have significantly higher win-rate

Algorithm:
    1. For each round, find the earliest-tick kill (already in first_contacts)
    2. Classify as FCR win/loss relative to a reference team or player set
    3. Aggregate per-player and per-round
    4. Score severity: repeated FCR losses → critical coaching flag

Input: parsed match JSON from parse_demo.py (the full output dict)
Output: FcrAnalysis dataclass with per-round + per-player breakdowns
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output schemas
# ---------------------------------------------------------------------------


@dataclass
class RoundFcr:
    """FCR result for a single round."""

    round_num: int
    tick: int
    attacker: str
    attacker_team: str
    victim: str
    weapon: str
    headshot: bool
    # Did any tracked team member make the first kill?
    our_team_won: bool | None  # None if team filtering not applied
    # Did the round outcome match the FCR result?
    fcr_matched_round_outcome: bool | None
    round_winner: str  # CT or T


@dataclass
class PlayerFcrStats:
    """Per-player FCR aggregates."""

    player_name: str
    first_kills: int = 0  # times this player landed the first kill
    first_deaths: int = 0  # times this player was the first to die
    # Rounds where this player got the first kill and team won
    fcr_win_converted: int = 0
    # Rounds where this player died first and team still won (clutch)
    survived_first_death: int = 0

    @property
    def first_kill_rate(self) -> float:
        return self.first_kills / max(self.first_kills + self.first_deaths, 1)

    @property
    def conversion_rate(self) -> float:
        """How often does getting the first kill lead to a round win?"""
        return self.fcr_win_converted / max(self.first_kills, 1)


@dataclass
class FcrAnalysis:
    """Full FCR analysis result for a match."""

    match_id: str
    map_name: str
    total_rounds: int
    rounds: list[RoundFcr] = field(default_factory=list)
    player_stats: dict[str, PlayerFcrStats] = field(default_factory=dict)

    # Aggregate metrics
    ct_fcr_wins: int = 0
    t_fcr_wins: int = 0
    fcr_match_rate: float = 0.0  # % of rounds where FCR winner = round winner

    # Coaching flags
    flags: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Severity flags
# ---------------------------------------------------------------------------


def _flag(severity: str, message: str, player: str | None = None) -> dict:
    return {"severity": severity, "message": message, "player": player}


# ---------------------------------------------------------------------------
# Core analysis function
# ---------------------------------------------------------------------------


def analyze_fcr(
    match_data: dict,
    our_players: set[str] | None = None,
) -> FcrAnalysis:
    """
    Run FCR analysis on parsed match data.

    Args:
        match_data:  Full output dict from parse_demo.parse_demo()
        our_players: Optional set of player names considered "our team"
                     (enables win/loss classification). If None, only
                     raw first-contact stats are computed.

    Returns:
        FcrAnalysis with per-round and per-player breakdowns.
    """
    meta = match_data.get("metadata", {})
    match_id = meta.get("match_id", "unknown")
    map_name = meta.get("map", "unknown")
    total_rounds = meta.get("total_rounds", 0)

    first_contacts: list[dict] = match_data.get("first_contacts", [])
    rounds_data: list[dict] = match_data.get("rounds", [])

    # Build round_num → round winner lookup
    round_winner_by_num: dict[int, str] = {}
    for r in rounds_data:
        round_winner_by_num[r["round_num"]] = r.get("winner_side", "")

    analysis = FcrAnalysis(
        match_id=match_id,
        map_name=map_name,
        total_rounds=total_rounds,
    )

    matched_count = 0

    for fc in first_contacts:
        rnum = fc["round_num"]
        attacker = fc.get("attacker", "")
        attacker_team = fc.get("attacker_team", "")
        victim = fc.get("victim", "")
        weapon = fc.get("weapon", "")
        headshot = fc.get("headshot", False)
        tick = fc.get("tick", 0)
        round_winner = round_winner_by_num.get(rnum, "")

        # Determine if our team won the first contact
        our_team_won: bool | None = None
        if our_players is not None:
            our_team_won = attacker in our_players

        # Did FCR winner side match round outcome?
        fcr_matched: bool | None = None
        if round_winner and attacker_team:
            # attacker_team is typically "CT" or "T" or full team name
            # Normalise to CT/T
            side = _normalise_side(attacker_team)
            if side and round_winner in ("CT", "T"):
                fcr_matched = side == round_winner
                if fcr_matched:
                    matched_count += 1
                if side == "CT":
                    analysis.ct_fcr_wins += 1
                else:
                    analysis.t_fcr_wins += 1

        round_fcr = RoundFcr(
            round_num=rnum,
            tick=tick,
            attacker=attacker,
            attacker_team=attacker_team,
            victim=victim,
            weapon=weapon,
            headshot=headshot,
            our_team_won=our_team_won,
            fcr_matched_round_outcome=fcr_matched,
            round_winner=round_winner,
        )
        analysis.rounds.append(round_fcr)

        # Update per-player stats
        _update_player_stats(analysis.player_stats, attacker, victim, fcr_matched, round_winner)

    # FCR match rate: % of rounds where FCR winner = round winner
    if first_contacts:
        analysis.fcr_match_rate = matched_count / len(first_contacts)

    # Generate coaching flags
    _generate_flags(analysis)

    logger.info(
        f"[FCR] match={match_id} map={map_name} rounds={total_rounds} "
        f"fcr_match_rate={analysis.fcr_match_rate:.1%} flags={len(analysis.flags)}"
    )
    return analysis


def _normalise_side(team_str: str) -> str | None:
    """Extract CT/T from a team string like 'CT', 'T', 'TERRORIST', 'COUNTER-TERRORIST'."""
    t = team_str.upper()
    if "COUNTER" in t or t == "CT":
        return "CT"
    if "TERRORIST" in t or t == "T":
        return "T"
    return None


def _update_player_stats(
    stats: dict[str, PlayerFcrStats],
    attacker: str,
    victim: str,
    fcr_matched: bool | None,
    round_winner: str,
) -> None:
    """Update the per-player stats dict in place."""
    for name in (attacker, victim):
        if name and name not in stats:
            stats[name] = PlayerFcrStats(player_name=name)

    if attacker:
        ps = stats[attacker]
        ps.first_kills += 1
        # Check if the team that made the first kill won the round
        # (we don't have direct team membership here, so proxy via fcr_matched)
        if fcr_matched is True:
            ps.fcr_win_converted += 1

    if victim:
        ps = stats[victim]
        ps.first_deaths += 1
        # If victim's team still won the round despite dying first
        if fcr_matched is False and round_winner:
            ps.survived_first_death += 1


def _generate_flags(analysis: FcrAnalysis) -> None:
    """Generate coaching flags based on FCR patterns."""
    flags = analysis.flags

    # Flag 1: Low overall FCR match rate (first contact often goes to round loser)
    if analysis.total_rounds >= 10 and analysis.fcr_match_rate < 0.45:
        flags.append(
            _flag(
                "warning",
                f"FCR impact is low ({analysis.fcr_match_rate:.0%} of rounds) — first contact is not "
                "a reliable predictor. This often means lots of force-buys or lucky eco wins.",
            )
        )
    elif analysis.total_rounds >= 10 and analysis.fcr_match_rate >= 0.65:
        flags.append(
            _flag(
                "positive",
                f"Strong FCR impact ({analysis.fcr_match_rate:.0%}) — rounds are being won by the "
                "team that controls early aggression. Keep up the proactive play.",
            )
        )

    # Flag 2: Per-player patterns
    for player_name, ps in analysis.player_stats.items():
        total = ps.first_kills + ps.first_deaths
        if total < 3:
            continue  # not enough data

        # Repeatedly dying first
        if ps.first_deaths >= 5 and ps.first_kill_rate < 0.30:
            flags.append(
                _flag(
                    "critical",
                    f"{player_name} is dying first in {ps.first_deaths} rounds "
                    f"({ps.first_kill_rate:.0%} first-kill rate). They may be over-peeking, "
                    "playing a weak angle, or taking duels at a timing/info disadvantage.",
                    player=player_name,
                )
            )
        elif ps.first_deaths >= 3 and ps.first_kill_rate < 0.40:
            flags.append(
                _flag(
                    "warning",
                    f"{player_name} is taking the first contact and losing it frequently "
                    f"({ps.first_kill_rate:.0%} first-kill rate across {total} FCR rounds). "
                    "Consider adjusting default positions or timing.",
                    player=player_name,
                )
            )

        # Strong entry fragger
        if ps.first_kills >= 5 and ps.conversion_rate >= 0.65:
            flags.append(
                _flag(
                    "positive",
                    f"{player_name} is a reliable entry fragger: {ps.first_kills} first kills with "
                    f"{ps.conversion_rate:.0%} round conversion rate.",
                    player=player_name,
                )
            )

    # Flag 3: CT/T imbalance
    ct_total = analysis.ct_fcr_wins
    t_total = analysis.t_fcr_wins
    total_fc = ct_total + t_total
    if total_fc >= 10:
        ct_rate = ct_total / total_fc
        if ct_rate > 0.70:
            flags.append(
                _flag(
                    "warning",
                    f"CTs are winning first contact in {ct_rate:.0%} of rounds. T-side may be "
                    "taking poor initial duels or leaking into CT-advantaged angles.",
                )
            )
        elif ct_rate < 0.30:
            flags.append(
                _flag(
                    "warning",
                    f"Ts are winning first contact in {(1 - ct_rate):.0%} of rounds. CT setups may "
                    "be too passive or players are getting caught off-angles.",
                )
            )


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def fcr_to_dict(analysis: FcrAnalysis) -> dict:
    """Convert FcrAnalysis to a JSON-serialisable dict for API responses."""
    return {
        "match_id": analysis.match_id,
        "map_name": analysis.map_name,
        "total_rounds": analysis.total_rounds,
        "ct_fcr_wins": analysis.ct_fcr_wins,
        "t_fcr_wins": analysis.t_fcr_wins,
        "fcr_match_rate": round(analysis.fcr_match_rate, 4),
        "flags": analysis.flags,
        "rounds": [
            {
                "round_num": r.round_num,
                "tick": r.tick,
                "attacker": r.attacker,
                "attacker_team": r.attacker_team,
                "victim": r.victim,
                "weapon": r.weapon,
                "headshot": r.headshot,
                "our_team_won": r.our_team_won,
                "fcr_matched_round_outcome": r.fcr_matched_round_outcome,
                "round_winner": r.round_winner,
            }
            for r in analysis.rounds
        ],
        "player_stats": {
            name: {
                "player_name": ps.player_name,
                "first_kills": ps.first_kills,
                "first_deaths": ps.first_deaths,
                "first_kill_rate": round(ps.first_kill_rate, 4),
                "fcr_win_converted": ps.fcr_win_converted,
                "conversion_rate": round(ps.conversion_rate, 4),
                "survived_first_death": ps.survived_first_death,
            }
            for name, ps in analysis.player_stats.items()
        },
    }
