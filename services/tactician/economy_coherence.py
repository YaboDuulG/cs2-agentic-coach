"""
Tactician — Economy Coherence Analysis
========================================
Analyzes team economy decisions per round by evaluating equipment values.
Classifies rounds into economy types (Full Buy, Force Buy, Eco, etc.) and
flags mismanaged economy decisions (e.g., forcing when broke).

Input: Dict containing 'rounds' list with equipment values.
Output: EconomyAnalysis dataclass with round classifications and flags.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)

@dataclass
class EconomyFlag:
    round_num: int
    severity: str  # 'warning', 'critical', 'positive'
    message: str
    team: str

@dataclass
class RoundEconomy:
    round_num: int
    ct_eq_val: int
    t_eq_val: int
    ct_type: str
    t_type: str

@dataclass
class EconomyAnalysis:
    rounds: list[RoundEconomy] = field(default_factory=list)
    flags: list[EconomyFlag] = field(default_factory=list)
    overall_coherence_score: float = 1.0


def _classify_buy(eq_val: int, is_t_side: bool) -> str:
    """
    Heuristic classification of a team's buy based on total equipment value.
    In CS2, full buy is typically > 20000.
    Eco is < 5000.
    """
    if eq_val >= 20000:
        return "full_buy"
    elif eq_val >= 10000:
        return "force_buy" if is_t_side else "half_buy"  # Simplified heuristic
    elif eq_val >= 5000:
        return "semi_eco"
    else:
        return "eco"

def analyze_economy(match_data: dict) -> EconomyAnalysis:
    """
    Analyzes the economy of each round and generates flags for poor decisions.
    """
    logger.info("Running economy coherence analysis...")
    rounds_data = match_data.get("rounds", [])

    analysis = EconomyAnalysis()

    for r in rounds_data:
        ct_val = r.get("ct_eq_val") or 0
        t_val = r.get("t_eq_val") or 0
        round_num = r.get("round_num", 0)

        ct_type = _classify_buy(ct_val, is_t_side=False)
        t_type = _classify_buy(t_val, is_t_side=True)

        analysis.rounds.append(RoundEconomy(
            round_num=round_num,
            ct_eq_val=ct_val,
            t_eq_val=t_val,
            ct_type=ct_type,
            t_type=t_type
        ))

        # Example flag: CT forced buy against T full buy with terrible economy
        if ct_type == "force_buy" and t_type == "full_buy" and ct_val < 15000:
            analysis.flags.append(EconomyFlag(
                round_num=round_num,
                severity="warning",
                message=f"CT forced with poor economy ({ct_val}) against T full buy.",
                team="CT"
            ))

        if t_type == "force_buy" and ct_type == "full_buy" and t_val < 12000:
            analysis.flags.append(EconomyFlag(
                round_num=round_num,
                severity="warning",
                message=f"T forced with poor economy ({t_val}) against CT full buy.",
                team="T"
            ))

    # Calculate overall coherence
    num_flags = len(analysis.flags)
    total_rounds = len(rounds_data) or 1
    analysis.overall_coherence_score = max(0.0, 1.0 - (num_flags / total_rounds))

    return analysis

def economy_to_dict(analysis: EconomyAnalysis) -> dict:
    return {
        "overall_coherence_score": analysis.overall_coherence_score,
        "rounds": [
            {
                "round_num": r.round_num,
                "ct_eq_val": r.ct_eq_val,
                "t_eq_val": r.t_eq_val,
                "ct_type": r.ct_type,
                "t_type": r.t_type
            }
            for r in analysis.rounds
        ],
        "flags": [
            {
                "round_num": f.round_num,
                "severity": f.severity,
                "message": f.message,
                "team": f.team
            }
            for f in analysis.flags
        ]
    }
