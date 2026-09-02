"""Module docstring."""
import json
import logging
from typing import Any

logger = logging.getLogger("great_khan")

def _compute_stats(match_id: str) -> dict[str, Any] | None:
    """Pull match data from DB and compute summary statistics."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import FirstContact, Kill, Match, Round  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return None

            kills = db.query(Kill).filter(Kill.match_id == match_id).all()
            rounds = db.query(Round).filter(Round.match_id == match_id).all()
            first_contacts = db.query(FirstContact).filter(FirstContact.match_id == match_id).all()

            # Win rates
            ct_wins = sum(1 for r in rounds if r.winner_side == "CT")
            t_wins = sum(1 for r in rounds if r.winner_side == "T")

            # Top killers
            killer_counts: dict[str, int] = {}
            weapon_counts: dict[str, int] = {}
            for k in kills:
                if k.attacker:
                    killer_counts[k.attacker] = killer_counts.get(k.attacker, 0) + 1
                if k.weapon:
                    weapon_counts[k.weapon] = weapon_counts.get(k.weapon, 0) + 1

            top_killers = sorted(killer_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            top_weapons = sorted(weapon_counts.items(), key=lambda x: x[1], reverse=True)[:5]

            # First contacts
            ct_fc = sum(1 for fc in first_contacts if fc.attacker_team == "CT")
            t_fc = sum(1 for fc in first_contacts if fc.attacker_team == "T")
            total_fc = len(first_contacts) or 1

            # Economy
            ct_spends = [r.ct_eq_val for r in rounds if r.ct_eq_val is not None and r.ct_eq_val > 0]
            t_spends = [r.t_eq_val for r in rounds if r.t_eq_val is not None and r.t_eq_val > 0]

            # Worst rounds (lost despite high spend)
            worst_rounds = []
            for r in rounds:
                spend = r.ct_eq_val if r.winner_side == "T" else r.t_eq_val
                if spend and spend > 10000:
                    worst_rounds.append(
                        {
                            "round": r.round_num,
                            "loser": "CT" if r.winner_side == "T" else "T",
                            "spend": spend,
                            "winner": r.winner_side,
                        }
                    )
            worst_rounds = sorted(worst_rounds, key=lambda x: x["spend"], reverse=True)[:5]

            # Group players into rosters based on starting side
            starting_ct_players = []
            starting_t_players = []
            ct_clans = {}
            t_clans = {}
            uploader_team_label = ""
            user_team = None

            if match.player_stats_json:
                try:
                    p_stats = json.loads(match.player_stats_json)
                    for p_id, p_info in p_stats.items():
                        if p_id == "nan":
                            continue
                        p_name = p_info.get("name", p_id)
                        p_side = p_info.get("team")
                        p_clan = p_info.get("clan", "")

                        if p_side == "CT":
                            starting_ct_players.append(p_name)
                            if p_clan:
                                ct_clans[p_clan] = ct_clans.get(p_clan, 0) + 1
                        elif p_side in ("TERRORIST", "T"):
                            starting_t_players.append(p_name)
                            if p_clan:
                                t_clans[p_clan] = t_clans.get(p_clan, 0) + 1

                except Exception:
                    pass

            team_a_name = "Team A"
            if ct_clans:
                best_clan = max(ct_clans, key=ct_clans.get)
                if ct_clans[best_clan] >= 2:
                    team_a_name = best_clan

            team_b_name = "Team B"
            if t_clans:
                best_clan = max(t_clans, key=t_clans.get)
                if t_clans[best_clan] >= 2:
                    team_b_name = best_clan

            if match.player_stats_json and match.uploader_steam_id:
                try:
                    p_stats = json.loads(match.player_stats_json)
                    if match.uploader_steam_id in p_stats:
                        user_team = p_stats[match.uploader_steam_id].get("team")
                        if user_team == "CT":
                            uploader_team_label = team_a_name
                        elif user_team in ("TERRORIST", "T"):
                            uploader_team_label = team_b_name
                except Exception:
                    pass

            team_rosters = {
                f"{team_a_name} (started CT, swapped to T at halftime)": starting_ct_players,
                f"{team_b_name} (started T, swapped to CT at halftime)": starting_t_players,
            }

            # Map rounds to Team A vs Team B (halftime at round 12)
            round_details = []
            for r in rounds:
                round_num = r.round_num
                winner_side = r.winner_side

                if round_num <= 12:
                    ct_team = team_a_name
                    t_team = team_b_name
                else:
                    ct_team = team_b_name
                    t_team = team_a_name

                winner_team = (
                    team_a_name
                    if (winner_side == "CT" and ct_team == team_a_name)
                    or (winner_side == "T" and t_team == team_a_name)
                    else team_b_name
                )

                round_details.append(
                    {
                        "round_num": round_num,
                        "winner_side": winner_side,
                        "winner_team": winner_team,
                        f"{team_a_name}_side": "CT" if round_num <= 12 else "T",
                        f"{team_b_name}_side": "T" if round_num <= 12 else "CT",
                        "ct_eq_val": r.ct_eq_val,
                        "t_eq_val": r.t_eq_val,
                    }
                )

            return {
                "map_name": match.map_name,
                "total_rounds": match.total_rounds,
                "ct_wins": ct_wins,
                "t_wins": t_wins,
                "top_killers": [{"player": p, "kills": k} for p, k in top_killers],
                "top_weapons": [{"weapon": w, "kills": k} for w, k in top_weapons],
                "ct_avg_spend": sum(ct_spends) / len(ct_spends) if ct_spends else 0,
                "t_avg_spend": sum(t_spends) / len(t_spends) if t_spends else 0,
                "ct_first_contact_pct": ct_fc / total_fc,
                "t_first_contact_pct": t_fc / total_fc,
                "worst_rounds": worst_rounds,
                "user_notes": match.notes,
                "user_team": user_team,
                "uploader_steam_id": match.uploader_steam_id,
                "team_id": getattr(match, "team_id", None),
                "is_recon": getattr(match, "is_recon", False),
                "team_rosters": team_rosters,
                "round_history": round_details,
                "uploader_team_label": uploader_team_label,
            }
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to compute stats for {match_id}: {e}")
        return None
