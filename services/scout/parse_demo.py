"""
The Scout — CS2 Demo Parser
===========================
Parses a CS2 .dem file using demoparser2 (pure Rust, Python 3.12+ compatible).
No LLM is used here — this is deterministic data extraction.

Outputs:
    - metadata       : map name, tickrate, total rounds
    - kills          : per-kill events with positions, weapon, headshot flag
    - grenades       : throw positions, grenade type
    - rounds         : economy, winner side, end reason
    - first_contacts : first kill event per round (FCR seed data for Tactician)
    - trajectories   : sampled player movement per round (heatmap-ready)

Usage:
    python parse_demo.py --demo /path/to/match.dem --match-id match-001
    python parse_demo.py --demo /path/to/match.dem --match-id match-001 --write-db
"""

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any

from demoparser2 import DemoParser
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("scout")

# Sample every N ticks for trajectory data to keep JSON manageable.
# At 64 tick, sampling every 8 ticks ≈ 8 positions/second
TRAJECTORY_SAMPLE_TICKS = int(os.getenv("TRAJECTORY_SAMPLE_TICKS", "8"))

# ---------------------------------------------------------------------------
# Round identification constants (Rule 2 fallback)
# ---------------------------------------------------------------------------
# In a pistol round, each team has 5 players starting with $800.
# We treat any round where BOTH sides have combined equipment ≤ this value
# as a candidate pistol / warmup round.
# This threshold is generous to account for partial team sizes or eco rounds.
PISTOL_ROUND_MAX_EQUIP_PER_SIDE = int(os.getenv("PISTOL_ROUND_MAX_EQUIP", "4500"))

# Minimum total rounds we expect a real competitive half to contain.
# If we haven't found at least this many rounds we skip filtering.
MIN_COMPETITIVE_ROUNDS = int(os.getenv("MIN_COMPETITIVE_ROUNDS", "10"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_str(val: Any, default: str = "") -> str:
    return str(val) if val is not None else default


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_demo(dem_path: str) -> dict[str, Any]:
    """Parse a CS2 demo file using demoparser2 and return structured event data."""
    logger.info(f"Parsing demo: {dem_path}")
    parser = DemoParser(dem_path)

    # --- Header / metadata ---
    header = parser.parse_header()
    map_name = _safe_str(header.get("map_name", "unknown"))
    playback_ticks = _safe_int(header.get("playback_ticks", 0))
    # CS2 runs at 64 tick for matchmaking, 128 tick for FACEIT
    tickrate = 128 if playback_ticks > 100000 else 64

    output: dict[str, Any] = {
        "metadata": {
            "map": map_name,
            "tickrate": tickrate,
            "total_rounds": 0,
            "warmup_rounds_excluded": [],
        },
        "kills": [],
        "grenades": [],
        "rounds": [],
        "first_contacts": [],
        "trajectories": [],
    }

    # --- Kill events (player_death) ---
    try:
        kills_df = parser.parse_event(
            "player_death",
            player=["X", "Y", "Z", "team_name"],
            other=["total_rounds_played"],
        )
        if kills_df is not None and not kills_df.empty:
            for _, row in kills_df.iterrows():
                kill = {
                    "round": _safe_int(row.get("total_rounds_played")),
                    "tick": _safe_int(row.get("tick")),
                    "attacker": _safe_str(row.get("attacker_name")),
                    "attacker_team": _safe_str(row.get("attacker_team_name")),
                    "attacker_steamid": _safe_str(row.get("attacker_steamid")),
                    "victim": _safe_str(row.get("user_name")),
                    "victim_team": _safe_str(row.get("user_team_name")),
                    "victim_steamid": _safe_str(row.get("user_steamid")),
                    "weapon": _safe_str(row.get("weapon")),
                    "headshot": bool(row.get("headshot", False)),
                    "attacker_x": _safe_float(row.get("attacker_X", row.get("attacker_x"))),
                    "attacker_y": _safe_float(row.get("attacker_Y", row.get("attacker_y"))),
                    "attacker_z": _safe_float(row.get("attacker_Z", row.get("attacker_z"))),
                    "victim_x": _safe_float(row.get("user_X", row.get("user_x"))),
                    "victim_y": _safe_float(row.get("user_Y", row.get("user_y"))),
                    "victim_z": _safe_float(row.get("user_Z", row.get("user_z"))),
                }

                output["kills"].append(kill)
    except Exception as e:
        logger.warning(f"Kill events skipped: {e}")

    # --- First contact per round ---
    seen_rounds: set[int] = set()
    for kill in sorted(output["kills"], key=lambda k: (k["round"], k["tick"])):
        r = kill["round"]
        if r not in seen_rounds:
            seen_rounds.add(r)
            output["first_contacts"].append({**kill, "is_first_contact": True})

    # --- Grenade events ---
    for event_name in [
        "hegrenade_detonate",
        "smokegrenade_detonate",
        "flashbang_detonate",
        "molotov_detonate",
    ]:
        try:
            g_df = parser.parse_event(
                event_name,
                player=["X", "Y", "Z", "team_name"],
                other=["total_rounds_played"],
            )
            if g_df is not None and not g_df.empty:
                grenade_type = event_name.replace("_detonate", "").replace("_extinguish", "")
                for _, row in g_df.iterrows():
                    output["grenades"].append(
                        {
                            "round": _safe_int(row.get("total_rounds_played")),
                            "tick": _safe_int(row.get("tick")),
                            "thrower": _safe_str(row.get("user_name")),
                            "team": _safe_str(row.get("user_team_name")),
                            "type": grenade_type,
                            "throw_x": _safe_float(row.get("user_X", row.get("user_x"))),
                            "throw_y": _safe_float(row.get("user_Y", row.get("user_y"))),
                        }
                    )

        except Exception:
            pass  # Not all demo types have all grenade events

    # --- Round events (Economy + Winners) ---
    eco_lookup: dict[int, dict] = {}
    # warmup_rounds: set of round numbers (total_rounds_played) to exclude
    warmup_rounds: set[int] = set()
    freeze_df = None
    try:
        # Rule 1 — is_warmup_period flag (most reliable when available)
        freeze_df = parser.parse_event(
            "round_freeze_end",
            other=["total_rounds_played", "is_warmup_period"],
        )
        if freeze_df is not None and not freeze_df.empty:
            if "is_warmup_period" in freeze_df.columns:
                warmup_mask = freeze_df["is_warmup_period"].fillna(False).astype(bool)
                warmup_rnds = freeze_df.loc[warmup_mask, "total_rounds_played"].dropna()
                warmup_rounds.update(int(r) for r in warmup_rnds)
                logger.info(
                    f"Rule 1 (is_warmup_period): excluded rounds {sorted(warmup_rounds)}"
                )

            ticks = freeze_df["tick"].tolist()
            ticks_df = parser.parse_ticks(["current_equip_value", "team_name"])
            filtered_ticks_df = ticks_df[ticks_df["tick"].isin(ticks)]
            merged = filtered_ticks_df.merge(
                freeze_df[["tick", "total_rounds_played"]], on="tick", how="left"
            )
            for rnd_num, grp in merged.groupby("total_rounds_played"):
                ct_val = grp[grp["team_name"] == "CT"]["current_equip_value"].sum()
                t_val = grp[grp["team_name"] == "TERRORIST"]["current_equip_value"].sum()
                eco_lookup[int(rnd_num)] = {"ct": int(ct_val), "t": int(t_val)}
    except Exception as e:
        logger.debug(f"Economy data unavailable: {e}")

    # Rule 2 — Game Phase Matching (Robust)
    # 1: Warmup, 2: First Half, 3: Second Half, 4: Halftime, 5: Post-Match
    match_start_tick = 0
    match_end_tick = float('inf')
    
    try:
        phase_ticks_df = parser.parse_ticks(["game_phase"])
        if "game_phase" in phase_ticks_df.columns:
            # Find when phase changes to 2 (Live Match Start)
            phase_2_mask = phase_ticks_df["game_phase"] == 2
            if phase_2_mask.any():
                match_start_tick = int(phase_ticks_df.loc[phase_2_mask, "tick"].iloc[0])
                logger.info(f"Match start detected (phase 2) at tick: {match_start_tick}")
            
            # Find when phase changes to 5 (Match Over)
            phase_5_mask = phase_ticks_df["game_phase"] == 5
            if phase_5_mask.any():
                match_end_tick = int(phase_ticks_df.loc[phase_5_mask, "tick"].iloc[0])
                logger.info(f"Match end detected (phase 5) at tick: {match_end_tick}")
    except Exception as e:
        logger.warning(f"Failed to extract game_phase: {e}")

    if warmup_rounds:
        logger.info(f"Total warmup/invalid rounds excluded: {sorted(warmup_rounds)}")
    output["metadata"]["warmup_rounds_excluded"] = sorted(warmup_rounds)

    try:
        round_df = parser.parse_event(
            "round_end",
            other=["winner", "reason", "total_rounds_played"],
        )
        if round_df is not None and not round_df.empty:
            ct_score = t_score = 0
            # Deduplicate: CS2 can fire multiple round_end events for the same
            # round (e.g. both ct_killed and bomb_exploded for an eco defuse).
            # Keep the LAST event per total_rounds_played so we get the definitive
            # winner/reason without creating duplicate round_num entries.
            round_df = (
                round_df.sort_values("total_rounds_played")
                .drop_duplicates(subset=["total_rounds_played"], keep="last")
            )
            for _, row in round_df.iterrows():
                rnd_num = _safe_int(row.get("total_rounds_played"))

                tick = _safe_int(row.get("tick", 0))

                # Skip rounds that ended before match start or after match end
                if tick < match_start_tick or tick > match_end_tick:
                    logger.debug(f"Skipping out-of-bounds round {rnd_num} at tick {tick}")
                    continue

                # Also respect any warmup rounds identified by Rule 1
                if rnd_num in warmup_rounds:
                    logger.debug(f"Skipping warmup round {rnd_num}")
                    continue

                winner = row.get("winner")
                winner_side = ""
                if winner in (3, "CT"):
                    winner_side = "CT"
                elif winner in (2, "T", "TERRORIST"):
                    winner_side = "T"

                # Additional guard: skip rounds with no valid winner side
                # (knife rounds, technical rounds, etc.)
                if not winner_side:
                    logger.debug(f"Skipping round {rnd_num} with no valid winner side")
                    continue

                if winner_side == "CT":
                    ct_score += 1
                elif winner_side == "T":
                    t_score += 1

                eco = eco_lookup.get(rnd_num, {})
                output["rounds"].append(
                    {
                        "round_num": rnd_num,
                        "winner_side": winner_side,
                        "reason": _safe_str(row.get("reason")),
                        "ct_eq_val": eco.get("ct", 0),
                        "t_eq_val": eco.get("t", 0),
                        "ct_score": ct_score,
                        "t_score": t_score,
                    }
                )
    except Exception as e:
        logger.warning(f"Round events unavailable: {e}")
        # Fall back: infer round count from kills
        if output["kills"]:
            max_round = max(k["round"] for k in output["kills"])
            for i in range(1, max_round + 1):
                output["rounds"].append(
                    {
                        "round_num": i,
                        "winner_side": "",
                        "reason": "",
                        "ct_eq_val": 0,
                        "t_eq_val": 0,
                        "ct_score": 0,
                        "t_score": 0,
                    }
                )

    output["metadata"]["total_rounds"] = len(output["rounds"])

    # Build a set of valid (non-warmup) round numbers for downstream filtering
    valid_round_nums: set[int] = {r["round_num"] for r in output["rounds"]}

    # --- Filter kills / grenades / first_contacts to competitive rounds only ---
    if warmup_rounds:
        pre_filter_kills = len(output["kills"])
        output["kills"] = [k for k in output["kills"] if k["round"] in valid_round_nums]
        output["grenades"] = [g for g in output["grenades"] if g["round"] in valid_round_nums]
        output["first_contacts"] = [
            fc for fc in output["first_contacts"] if fc["round"] in valid_round_nums
        ]
        logger.info(
            f"Filtered out {pre_filter_kills - len(output['kills'])} warmup kills; "
            f"{len(output['kills'])} competitive kills remain"
        )

    # --- Player and Utility Stats Compilation ---
    player_stats = {}
    try:
        hurt_df = parser.parse_event(
            "player_hurt", player=["team_name"], other=["total_rounds_played"]
        )
        fire_df = parser.parse_event("weapon_fire", other=["total_rounds_played"])
        blind_df = parser.parse_event(
            "player_blind", player=["team_name"], other=["total_rounds_played"]
        )

        ticks_df_all = parser.parse_ticks(["team_name"])

        raw_players = {}

        def get_stat_player(steamid, name, team=None):
            if not steamid or steamid in ("0", "nan", None):
                return None
            steamid = str(steamid)
            if steamid not in raw_players:
                raw_players[steamid] = {
                    "name": name,
                    "steamid": steamid,
                    "team": team or "",
                    "kills": 0,
                    "deaths": 0,
                    "assists": 0,
                    "headshots": 0,
                    "damage_dealt": 0,
                    "rounds_played": 0,
                    "kills_per_round": {},
                    "entry_attempts": 0,
                    "entry_kills": 0,
                    "entry_deaths": 0,
                    "trade_kills": 0,
                    "deaths_traded": 0,
                    "utility_smokes": 0,
                    "utility_flashes": 0,
                    "utility_hes": 0,
                    "utility_molotovs": 0,
                    "utility_decoys": 0,
                    "he_damage": 0,
                    "fire_damage": 0,
                    "enemies_flashed": 0,
                    "enemy_blind_time": 0.0,
                    "team_flashed": 0,
                    "team_blind_time": 0.0,
                    "flash_assists": 0,
                    "flashed_self": 0,
                    "kast_rounds": set(),
                }
            if team and not raw_players[steamid]["team"]:
                raw_players[steamid]["team"] = team
            return raw_players[steamid]

        if freeze_df is not None and not freeze_df.empty:
            tick_to_round_local = {
                int(r["tick"]): int(r["total_rounds_played"]) for _, r in freeze_df.iterrows()
            }
            freeze_ticks = ticks_df_all[ticks_df_all["tick"].isin(tick_to_round_local.keys())]
            for _, row in freeze_ticks.iterrows():
                tick = int(row.get("tick", 0))
                if tick < match_start_tick or tick > match_end_tick:
                    continue  # skip events outside match bounds

                rn = tick_to_round_local.get(tick, -1)
                if rn not in valid_round_nums:
                    continue  # skip invalid/warmup rounds
                p = get_stat_player(row.get("steamid"), row.get("name"), row.get("team_name"))
                if p:
                    p["rounds_played"] += 1

        tot_r = len(output["rounds"])

        if kills_df is not None and not kills_df.empty:
            for _, row in kills_df.iterrows():
                tick = int(row.get("tick", 0))
                if tick < match_start_tick or tick > match_end_tick:
                    continue
                
                round_num = _safe_int(row.get("total_rounds_played"))
                if round_num not in valid_round_nums:
                    continue  # skip warmup kills

                att_id = row.get("attacker_steamid")
                p_att = get_stat_player(
                    att_id, row.get("attacker_name"), row.get("attacker_team_name")
                )
                if p_att:
                    p_att["kills"] += 1
                    if row.get("headshot"):
                        p_att["headshots"] += 1
                    p_att["kills_per_round"][round_num] = (
                        p_att["kills_per_round"].get(round_num, 0) + 1
                    )
                    p_att["kast_rounds"].add(round_num)

                vic_id = row.get("user_steamid")
                p_vic = get_stat_player(vic_id, row.get("user_name"), row.get("user_team_name"))
                if p_vic:
                    p_vic["deaths"] += 1

                ast_id = row.get("assister_steamid")
                p_ast = get_stat_player(
                    ast_id, row.get("assister_name"), row.get("assister_team_name")
                )
                if p_ast:
                    p_ast["assists"] += 1
                    p_ast["kast_rounds"].add(round_num)

                if row.get("assistedflash") and ast_id:
                    p_ast = get_stat_player(ast_id, row.get("assister_name"))
                    if p_ast:
                        p_ast["flash_assists"] += 1

        if fire_df is not None and not fire_df.empty:
            for _, row in fire_df.iterrows():
                tick = int(row.get("tick", 0))
                if tick < match_start_tick or tick > match_end_tick:
                    continue

                if _safe_int(row.get("total_rounds_played")) not in valid_round_nums:
                    continue  # skip warmup utility
                usr_id = row.get("user_steamid")
                wep = str(row.get("weapon", ""))
                p = get_stat_player(usr_id, row.get("user_name"))
                if p:
                    if wep == "weapon_smokegrenade":
                        p["utility_smokes"] += 1
                    elif wep == "weapon_flashbang":
                        p["utility_flashes"] += 1
                    elif wep == "weapon_hegrenade":
                        p["utility_hes"] += 1
                    elif wep == "weapon_decoy":
                        p["utility_decoys"] += 1
                    elif wep in ("weapon_molotov", "weapon_incgrenade"):
                        p["utility_molotovs"] += 1

        if hurt_df is not None and not hurt_df.empty:
            for _, row in hurt_df.iterrows():
                tick = int(row.get("tick", 0))
                if tick < match_start_tick or tick > match_end_tick:
                    continue

                if _safe_int(row.get("total_rounds_played")) not in valid_round_nums:
                    continue  # skip warmup damage
                att_id = row.get("attacker_steamid")
                vic_id = row.get("user_steamid")
                att_team = row.get("attacker_team_name")
                vic_team = row.get("user_team_name")
                dmg = _safe_int(row.get("dmg_health"))
                wep = str(row.get("weapon", ""))

                if att_id and att_id != vic_id and att_team != vic_team:
                    p_att = get_stat_player(att_id, row.get("attacker_name"))
                    if p_att:
                        p_att["damage_dealt"] += dmg
                        if wep == "hegrenade":
                            p_att["he_damage"] += dmg
                        elif wep in ("inferno", "molotov"):
                            p_att["fire_damage"] += dmg

        if blind_df is not None and not blind_df.empty:
            for _, row in blind_df.iterrows():
                tick = int(row.get("tick", 0))
                if tick < match_start_tick or tick > match_end_tick:
                    continue

                if _safe_int(row.get("total_rounds_played")) not in valid_round_nums:
                    continue  # skip warmup flash events
                att_id = row.get("attacker_steamid")
                vic_id = row.get("user_steamid")
                att_team = row.get("attacker_team_name")
                vic_team = row.get("user_team_name")
                dur = _safe_float(row.get("blind_duration"))

                if att_id:
                    p_att = get_stat_player(att_id, row.get("attacker_name"))
                    if p_att:
                        if att_id == vic_id:
                            p_att["flashed_self"] += 1
                        elif att_team == vic_team:
                            p_att["team_flashed"] += 1
                            p_att["team_blind_time"] += dur
                        else:
                            p_att["enemies_flashed"] += 1
                            p_att["enemy_blind_time"] += dur

        entry_map = {}
        if kills_df is not None and not kills_df.empty:
            for _, row in kills_df.iterrows():
                round_num = _safe_int(row.get("total_rounds_played"))
                if round_num not in valid_round_nums:
                    continue  # skip warmup entry kills
                tick = _safe_int(row.get("tick"))
                if round_num not in entry_map or tick < entry_map[round_num]["tick"]:
                    entry_map[round_num] = {
                        "tick": tick,
                        "attacker_steamid": row.get("attacker_steamid"),
                        "attacker_name": row.get("attacker_name"),
                        "victim_steamid": row.get("user_steamid"),
                        "victim_name": row.get("user_name"),
                    }

        for round_num, fk in entry_map.items():
            p_att = get_stat_player(fk["attacker_steamid"], fk["attacker_name"])
            if p_att:
                p_att["entry_kills"] += 1
                p_att["entry_attempts"] += 1
            p_vic = get_stat_player(fk["victim_steamid"], fk["victim_name"])
            if p_vic:
                p_vic["entry_deaths"] += 1
                p_vic["entry_attempts"] += 1

        if kills_df is not None and not kills_df.empty:
            kills_list = [
                {
                    "tick": _safe_int(row.get("tick")),
                    "round": _safe_int(row.get("total_rounds_played")),
                    "attacker_steamid": _safe_str(row.get("attacker_steamid")),
                    "attacker_team": _safe_str(row.get("attacker_team_name")),
                    "victim_steamid": _safe_str(row.get("user_steamid")),
                    "victim_team": _safe_str(row.get("user_team_name")),
                }
                for _, row in kills_df.iterrows()
                if _safe_int(row.get("tick")) >= match_start_tick and _safe_int(row.get("tick")) <= match_end_tick and _safe_int(row.get("total_rounds_played")) in valid_round_nums
            ]

            for idx, k in enumerate(kills_list):
                for jdx in range(idx + 1, len(kills_list)):
                    k_next = kills_list[jdx]
                    if k_next["round"] != k["round"]:
                        break
                    if k_next["tick"] - k["tick"] > 256:
                        break
                    if (
                        k_next["victim_steamid"] == k["attacker_steamid"]
                        and k_next["attacker_team"] == k["victim_team"]
                    ):
                        p_trade_killer = get_stat_player(k_next["attacker_steamid"], None)
                        p_victim = get_stat_player(k["victim_steamid"], None)
                        if p_trade_killer:
                            p_trade_killer["trade_kills"] += 1
                            p_trade_killer["kast_rounds"].add(k_next["round"])
                        if p_victim:
                            p_victim["deaths_traded"] += 1
                        break

        deaths_by_round = {}
        if kills_df is not None and not kills_df.empty:
            for _, row in kills_df.iterrows():
                round_num = _safe_int(row.get("total_rounds_played"))
                if round_num not in valid_round_nums:
                    continue  # skip warmup deaths
                vic_id = _safe_str(row.get("user_steamid"))
                if vic_id:
                    deaths_by_round.setdefault(round_num, set()).add(vic_id)

        # KAST survival: a player survives a round if they weren't killed in it.
        # Iterate over actual valid round numbers, not a sequential range.
        for steamid, p in raw_players.items():
            for rn in valid_round_nums:
                if steamid not in deaths_by_round.get(rn, set()):
                    p["kast_rounds"].add(rn)

        for steamid, p in raw_players.items():
            rc = p["rounds_played"] if p["rounds_played"] > 0 else tot_r
            if rc == 0:
                rc = 1
            p["adr"] = round(p["damage_dealt"] / rc, 1)
            p["kast"] = round((len(p["kast_rounds"]) / rc) * 100, 1)
            p["hs_pct"] = round((p["headshots"] / p["kills"]) * 100, 1) if p["kills"] > 0 else 0.0

            p["utility_thrown"] = (
                p["utility_smokes"]
                + p["utility_flashes"]
                + p["utility_hes"]
                + p["utility_molotovs"]
                + p["utility_decoys"]
            )
            p["utility_damage"] = p["he_damage"] + p["fire_damage"]
            p["enemy_blind_time"] = round(p["enemy_blind_time"], 2)
            p["team_blind_time"] = round(p["team_blind_time"], 2)

            multikills = {2: 0, 3: 0, 4: 0, 5: 0}
            for r, kc in p["kills_per_round"].items():
                if kc >= 2:
                    multikills[min(kc, 5)] += 1
            p["multikills"] = multikills

            if "kast_rounds" in p:
                del p["kast_rounds"]
            if "kills_per_round" in p:
                del p["kills_per_round"]

        player_stats = raw_players
    except Exception as e:
        logger.warning(f"Error computing player statistics: {e}")

    output["player_stats"] = player_stats

    # --- Player trajectories (sampled per TRAJECTORY_SAMPLE_TICKS) ---
    try:
        tick_data = parser.parse_ticks(
            ["X", "Y", "Z", "name", "team_name"],
        )
        if tick_data is not None and not tick_data.empty:
            # Filter to every Nth tick
            sampled = tick_data[tick_data["tick"] % TRAJECTORY_SAMPLE_TICKS == 0]
            # We don't have round from ticks directly — use kill/round data to bucket
            # For now, output all positions without round grouping (Phase 3 refinement)
            for player_name, grp in sampled.groupby("name"):
                grp_clean = grp.dropna(subset=["X"])
                positions = [
                    {
                        "tick": int(t),
                        "x": round(float(x), 2),
                        "y": round(float(y), 2),
                        "z": round(float(z), 2),
                    }
                    for t, x, y, z in zip(grp_clean["tick"], grp_clean["X"], grp_clean["Y"], grp_clean["Z"])
                ]
                if positions:
                    team = _safe_str(grp["team_name"].iloc[0]) if len(grp) > 0 else ""
                    output["trajectories"].append(
                        {
                            "round": 0,  # Full-match trajectory — refined in Phase 3
                            "player": str(player_name),
                            "team": team,
                            "positions": positions,
                        }
                    )
    except Exception as e:
        logger.warning(f"Trajectory data skipped: {e}")

    logger.info(
        f"Parsed — Rounds: {output['metadata']['total_rounds']} | "
        f"Warmup excluded: {len(warmup_rounds)} | "
        f"Kills: {len(output['kills'])} | "
        f"Grenades: {len(output['grenades'])} | "
        f"First Contacts: {len(output['first_contacts'])} | "
        f"Trajectories: {len(output['trajectories'])} players"
    )
    return output


# ---------------------------------------------------------------------------
# GCS upload
# ---------------------------------------------------------------------------


def upload_to_gcs(data: dict, match_id: str) -> str:
    """Upload parsed JSON output to GCS and return the gs:// URI."""
    from google.cloud import storage  # noqa: PLC0415

    bucket_name = os.environ["GCS_BUCKET"].strip()
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob_path = f"parsed/{match_id}/scout_output.json"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(json.dumps(data, indent=2), content_type="application/json")
    uri = f"gs://{bucket_name}/{blob_path}"
    logger.info(f"Uploaded: {uri}")
    return uri


# ---------------------------------------------------------------------------
# DB write
# ---------------------------------------------------------------------------


def write_to_db(data: dict, match_id: str, parse_duration: float | None = None) -> None:
    """Write parsed Scout output to PostgreSQL (or SQLite in local/test mode)."""
    from pathlib import Path as _Path
    import sys

    # Ensure repo root on path for db imports when called as module
    _repo = _Path(__file__).parent.parent.parent.resolve()
    if str(_repo) not in sys.path:
        sys.path.insert(0, str(_repo))

    from db.database import SessionLocal
    from db.models import (
        FirstContact,
        Grenade,
        Kill,
        Match,
        MatchStatus,
        PlayerTrajectory,
        Round,
    )

    db = SessionLocal()
    try:
        match = db.get(Match, match_id)
        if match is None:
            match = Match(match_id=match_id)
            db.add(match)

        import math

        def sanitize_nan(val):
            if isinstance(val, float):
                return None if (math.isnan(val) or math.isinf(val)) else val
            elif isinstance(val, dict):
                return {k: sanitize_nan(v) for k, v in val.items()}
            elif isinstance(val, list):
                return [sanitize_nan(x) for x in val]
            return val

        def clean_float(val):
            if val is None:
                return None
            try:
                f = float(val)
                return None if (math.isnan(f) or math.isinf(f)) else f
            except (ValueError, TypeError):
                return None

        meta = data.get("metadata", {})
        match.map_name = meta.get("map", "unknown")
        match.tickrate = meta.get("tickrate", 64)
        match.total_rounds = meta.get("total_rounds", 0)
        match.status = MatchStatus.COMPLETE
        match.player_stats_json = json.dumps(sanitize_nan(data.get("player_stats", {})))
        if parse_duration is not None:
            match.parse_duration_seconds = parse_duration

        db.query(Kill).filter(Kill.match_id == match_id).delete()
        db.query(Grenade).filter(Grenade.match_id == match_id).delete()
        db.query(Round).filter(Round.match_id == match_id).delete()
        db.query(FirstContact).filter(FirstContact.match_id == match_id).delete()
        db.query(PlayerTrajectory).filter(PlayerTrajectory.match_id == match_id).delete()

        for k in data.get("kills", []):
            db.add(
                Kill(
                    match_id=match_id,
                    round_num=k["round"],
                    tick=k["tick"],
                    attacker=k["attacker"],
                    attacker_team=k["attacker_team"],
                    victim=k["victim"],
                    victim_team=k["victim_team"],
                    weapon=k["weapon"],
                    headshot=k["headshot"],
                    attacker_steamid=k.get("attacker_steamid"),
                    victim_steamid=k.get("victim_steamid"),
                    attacker_x=clean_float(k.get("attacker_x")),
                    attacker_y=clean_float(k.get("attacker_y")),
                    attacker_z=clean_float(k.get("attacker_z")),
                    victim_x=clean_float(k.get("victim_x")),
                    victim_y=clean_float(k.get("victim_y")),
                    victim_z=clean_float(k.get("victim_z")),
                )
            )

        for g in data.get("grenades", []):
            db.add(
                Grenade(
                    match_id=match_id,
                    round_num=g["round"],
                    tick=g["tick"],
                    thrower=g["thrower"],
                    team=g["team"],
                    grenade_type=g["type"],
                    throw_x=clean_float(g.get("throw_x")),
                    throw_y=clean_float(g.get("throw_y")),
                )
            )

        for r in data.get("rounds", []):
            db.add(
                Round(
                    match_id=match_id,
                    round_num=r["round_num"],
                    winner_side=r["winner_side"],
                    reason=r["reason"],
                    ct_eq_val=r["ct_eq_val"],
                    t_eq_val=r["t_eq_val"],
                    ct_score=r["ct_score"],
                    t_score=r["t_score"],
                )
            )

        for fc in data.get("first_contacts", []):
            db.add(
                FirstContact(
                    match_id=match_id,
                    round_num=fc["round"],
                    tick=fc["tick"],
                    attacker=fc["attacker"],
                    attacker_team=fc["attacker_team"],
                    victim=fc["victim"],
                    weapon=fc["weapon"],
                    headshot=fc["headshot"],
                    attacker_steamid=fc.get("attacker_steamid"),
                    victim_steamid=fc.get("victim_steamid"),
                    attacker_x=fc["attacker_x"],
                    attacker_y=fc["attacker_y"],
                    victim_x=fc["victim_x"],
                    victim_y=fc["victim_y"],
                )
            )

        for traj in data.get("trajectories", []):
            db.add(
                PlayerTrajectory(
                    match_id=match_id,
                    round_num=traj["round"],
                    player=traj["player"],
                    team=traj["team"],
                    positions_json=json.dumps(traj["positions"]),
                )
            )

        db.commit()
        logger.info(f"DB write complete for match {match_id}")
    except Exception as exc:
        db.rollback()
        logger.error(f"DB write failed: {exc}")
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DemoSage Scout — CS2 demo parser")
    ap.add_argument("--demo", required=True, help="Absolute path to .dem file")
    ap.add_argument("--match-id", required=True, help="Unique match identifier")
    ap.add_argument("--upload", action="store_true", help="Upload result to GCS")
    ap.add_argument("--write-db", action="store_true", help="Write parsed data to DB")
    args = ap.parse_args()

    result = parse_demo(args.demo)

    out_path = Path(f"/tmp/{args.match_id}_scout.json")
    out_path.write_text(json.dumps(result, indent=2))
    logger.info(f"Saved locally: {out_path}")

    if args.upload:
        upload_to_gcs(result, args.match_id)

    if args.write_db:
        write_to_db(result, args.match_id)
