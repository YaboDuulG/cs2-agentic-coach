"""
Tactician Heuristics — Advanced CS2 Gameplay Algorithms (Phase 4)
Processes the raw ParseResult dictionary from the demo-parser service.
"""

import math
from typing import Any

def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

def analyze_rotation_efficiency(positions: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Analyzes how efficiently players move around the map.
    Returns players with exceptionally slow or fast average rotation speeds.
    """
    player_speeds = {}
    player_last_pos = {}

    for pos in positions:
        if not pos.get("is_alive"):
            continue
        
        steam_id = pos.get("steam_id")
        if not steam_id:
            continue
            
        tick = pos.get("tick")
        x = pos.get("x")
        y = pos.get("y")
        
        if steam_id in player_last_pos:
            last = player_last_pos[steam_id]
            dist = _distance(last["x"], last["y"], x, y)
            tick_diff = tick - last["tick"]
            
            # Filter out teleports (e.g. round restarts)
            if tick_diff > 0 and dist < 5000:
                speed = dist / tick_diff
                if steam_id not in player_speeds:
                    player_speeds[steam_id] = []
                player_speeds[steam_id].append(speed)
                
        player_last_pos[steam_id] = {"tick": tick, "x": x, "y": y}
        
    avg_speeds = {}
    for steam_id, speeds in player_speeds.items():
        if speeds:
            avg_speeds[steam_id] = sum(speeds) / len(speeds)
            
    # Identify outliers (dummy logic for example)
    slowest = min(avg_speeds, key=avg_speeds.get) if avg_speeds else None
    return {
        "average_speeds": avg_speeds,
        "slowest_rotator": slowest
    }


def analyze_utility_sequencing(grenades: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Detects coordinated utility usage (execs).
    A basic heuristic: multiple grenades landing within a small tick window in a round.
    """
    # Group grenades by round
    rounds = {}
    for g in grenades:
        r = g.get("round")
        if r not in rounds:
            rounds[r] = []
        rounds[r].append(g)
        
    execs_detected = 0
    for r, nades in rounds.items():
        nades.sort(key=lambda x: x.get("tick", 0))
        for i in range(len(nades) - 2):
            # If 3 grenades land within 128 ticks (~1 second)
            if nades[i+2].get("tick", 0) - nades[i].get("tick", 0) < 128:
                execs_detected += 1
                
    return {
        "total_execs_detected": execs_detected,
        "team_coordination_rating": "High" if execs_detected > 5 else "Low"
    }


def analyze_economy_coherence(rounds: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Detects economy mismanagements, such as forcing when an eco was optimal.
    """
    economy_errors_ct = 0
    economy_errors_t = 0
    
    for r in rounds:
        round_type = r.get("round_type")
        ct_money = r.get("ct_money", 0)
        t_money = r.get("t_money", 0)
        
        # Heuristic: If they spent a lot but it's classified as eco/force
        if round_type == "force":
            if ct_money < 3000:
                economy_errors_ct += 1
            if t_money < 3000:
                economy_errors_t += 1
                
    return {
        "ct_economy_errors": economy_errors_ct,
        "t_economy_errors": economy_errors_t,
        "verdict": "CT economy was mismanaged" if economy_errors_ct > economy_errors_t else "T economy was mismanaged"
    }

def run_all_heuristics(parse_result: dict[str, Any]) -> dict[str, Any]:
    """Runs all Phase 4 tactical heuristics on the parse result."""
    return {
        "rotations": analyze_rotation_efficiency(parse_result.get("positions", [])),
        "utility": analyze_utility_sequencing(parse_result.get("grenades", [])),
        "economy": analyze_economy_coherence(parse_result.get("rounds", []))
    }
