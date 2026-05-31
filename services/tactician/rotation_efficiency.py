"""
Tactician — Rotation Efficiency Analysis
==========================================
Analyzes player movement paths and velocities relative to bomb site pressure.
Flags late rotations and calculates a rotation efficiency score per player.

Input: Dict containing 'trajectories' (sampled positions per round).
Output: RotationAnalysis dataclass with scores and flags.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import logging

logger = logging.getLogger(__name__)

@dataclass
class RotationFlag:
    round_num: int
    player: str
    severity: str  # 'warning', 'critical'
    message: str

@dataclass
class PlayerRotationScore:
    player: str
    avg_velocity: float
    rotation_score: float

@dataclass
class RotationAnalysis:
    player_scores: list[PlayerRotationScore] = field(default_factory=list)
    flags: list[RotationFlag] = field(default_factory=list)


def analyze_rotations(match_data: dict) -> RotationAnalysis:
    """
    Analyzes trajectories for rotation efficiency.
    """
    logger.info("Running rotation efficiency analysis...")
    trajectories = match_data.get("trajectories", [])

    analysis = RotationAnalysis()

    if not trajectories:
        return analysis

    player_stats: dict[str, dict] = {}

    for t in trajectories:
        player = t.get("player")
        if not player:
            continue

        if player not in player_stats:
            player_stats[player] = {"total_velocity": 0.0, "samples": 0}

        try:
            positions = json.loads(t.get("positions_json", "[]"))
            if len(positions) > 1:
                # Calculate basic velocity proxy (distance between samples)
                import math
                total_dist = 0.0
                for i in range(1, len(positions)):
                    dx = positions[i].get("x", 0) - positions[i-1].get("x", 0)
                    dy = positions[i].get("y", 0) - positions[i-1].get("y", 0)
                    total_dist += math.sqrt(dx*dx + dy*dy)

                avg_v = total_dist / len(positions)
                player_stats[player]["total_velocity"] += avg_v
                player_stats[player]["samples"] += 1

                # Flag if player stayed too stationary for too long (late rotation)
                if avg_v < 10.0 and len(positions) > 10:
                    analysis.flags.append(RotationFlag(
                        round_num=t.get("round_num", 0),
                        player=player,
                        severity="warning",
                        message=f"Player '{player}' showed very low movement/late rotation."
                    ))
        except Exception as e:
            logger.warning(f"Failed to parse trajectory for {player}: {e}")

    for player, stats in player_stats.items():
        if stats["samples"] > 0:
            avg_vel = stats["total_velocity"] / stats["samples"]
            # Normalize score somewhat arbitrarily for demo
            score = min(1.0, max(0.0, avg_vel / 100.0))
            analysis.player_scores.append(PlayerRotationScore(
                player=player,
                avg_velocity=avg_vel,
                rotation_score=score
            ))

    return analysis

def rotation_to_dict(analysis: RotationAnalysis) -> dict:
    return {
        "player_scores": [
            {
                "player": s.player,
                "avg_velocity": round(s.avg_velocity, 2),
                "rotation_score": round(s.rotation_score, 2)
            }
            for s in analysis.player_scores
        ],
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
