"""
Tactician — Positional Patterns Analysis
==========================================
Analyzes FirstContact positioning to detect player tendencies like
over-peeking, passive imbalance, or predictable crosshair placement.

Input: Dict containing 'first_contacts' list.
Output: PositionalAnalysis dataclass with player tags and flags.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)

@dataclass
class PositionalTag:
    player: str
    tag: str  # e.g., 'Aggressive Peeker', 'Passive Setup'
    severity: str  # 'positive', 'warning', 'critical'
    description: str

@dataclass
class PositionalAnalysis:
    tags: list[PositionalTag] = field(default_factory=list)

def analyze_positions(match_data: dict) -> PositionalAnalysis:
    """
    Analyzes first contact locations to identify player tendencies.
    """
    logger.info("Running positional patterns analysis...")
    first_contacts = match_data.get("first_contacts", [])

    analysis = PositionalAnalysis()
    if not first_contacts:
        return analysis

    player_aggression: dict[str, dict] = defaultdict(lambda: {"attacks": 0, "deaths": 0})

    for fc in first_contacts:
        attacker = fc.get("attacker")
        victim = fc.get("victim")

        if attacker:
            player_aggression[attacker]["attacks"] += 1
        if victim:
            player_aggression[victim]["deaths"] += 1

    for player, stats in player_aggression.items():
        total_engagements = stats["attacks"] + stats["deaths"]
        if total_engagements == 0:
            continue

        win_rate = stats["attacks"] / total_engagements

        # Simple heuristic for tendencies based on first contact frequency and success
        if total_engagements > 5:
            if win_rate < 0.3:
                analysis.tags.append(PositionalTag(
                    player=player,
                    tag="Over-peeking",
                    severity="critical",
                    description=f"Dying first frequently ({stats['deaths']} times). Needs more passive setups."
                ))
            elif win_rate > 0.7:
                analysis.tags.append(PositionalTag(
                    player=player,
                    tag="Entry Fragger",
                    severity="positive",
                    description=f"Highly successful opening duels ({stats['attacks']} first bloods)."
                ))
            elif stats["attacks"] == 0 and stats["deaths"] < 2:
                # Barely involved in first contacts
                analysis.tags.append(PositionalTag(
                    player=player,
                    tag="Passive Anchor",
                    severity="positive",
                    description="Plays safely and avoids early round risks."
                ))

    return analysis

def positions_to_dict(analysis: PositionalAnalysis) -> dict:
    return {
        "tags": [
            {
                "player": t.player,
                "tag": t.tag,
                "severity": t.severity,
                "description": t.description
            }
            for t in analysis.tags
        ]
    }
