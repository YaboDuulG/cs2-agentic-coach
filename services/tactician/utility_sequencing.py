"""
Tactician — Utility Sequencing Analysis
=========================================
Analyzes grenade throws to evaluate utility effectiveness and sequencing.
Flags issues like throwing smokes without flashes or wasting utility on lost rounds.

Input: Dict containing 'grenades' list.
Output: UtilityAnalysis dataclass with scores and flags.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)

@dataclass
class UtilityFlag:
    round_num: int
    player: str
    severity: str
    message: str

@dataclass
class UtilityAnalysis:
    flags: list[UtilityFlag] = field(default_factory=list)
    overall_efficiency: float = 1.0

def analyze_utility(match_data: dict) -> UtilityAnalysis:
    """
    Analyzes grenade usage for sequencing and effectiveness.
    """
    logger.info("Running utility sequencing analysis...")
    grenades = match_data.get("grenades", [])

    analysis = UtilityAnalysis()
    if not grenades:
        return analysis

    round_utility = defaultdict(list)
    for g in grenades:
        round_utility[g.get("round_num")].append(g)

    total_flags = 0

    for round_num, throws in round_utility.items():
        # Example heuristic: Check if flashbangs were used before entering a site
        # We don't have site entry times, so we look for basic sequences like smoke followed by nothing
        flashes = [g for g in throws if g.get("grenade_type") == "flashbang"]
        smokes = [g for g in throws if g.get("grenade_type") == "smoke"]

        # If team threw >2 smokes but 0 flashes, it's highly inefficient site execution
        if len(smokes) >= 2 and len(flashes) == 0:
            analysis.flags.append(UtilityFlag(
                round_num=round_num,
                player="Team",
                severity="warning",
                message=f"Heavy smoke usage ({len(smokes)}) without any flashbang support."
            ))
            total_flags += 1

        # Check per-player utility dumping
        player_throws = defaultdict(int)
        for g in throws:
            player = g.get("thrower")
            if player:
                player_throws[player] += 1

        for player, count in player_throws.items():
            if count > 4:
                analysis.flags.append(UtilityFlag(
                    round_num=round_num,
                    player=player,
                    severity="warning",
                    message="Dumped excessive utility in a single round."
                ))
                total_flags += 1

    total_rounds = len(match_data.get("rounds", [])) or 1
    analysis.overall_efficiency = max(0.0, 1.0 - (total_flags / (total_rounds * 2)))

    return analysis

def utility_to_dict(analysis: UtilityAnalysis) -> dict:
    return {
        "overall_efficiency": round(analysis.overall_efficiency, 2),
        "flags": [
            {
                "round_num": f.round_num,
                "player": f.player,
                "severity": f.severity,
                "message": f.message
            }
            for f in analysis.flags
        ]
    }
