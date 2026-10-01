import type { JobKill, JobPayload, JobRound } from "@/lib/api/hooks";

/**
 * Pure derivations from the job payload. No React, no fetching: every function
 * here is unit-testable with a plain object.
 *
 * Convention used everywhere in the debrief: "Team A" is the team that was CT
 * in round 1, "Team B" the team that was T. Sides swap at halftime (after
 * round 12 in MR12) and every three rounds in overtime, so a round's winner
 * ("CT" | "T") is attributed to a team through `teamAIsCT(round)`.
 */

export type Side = "CT" | "T";
export type TeamKey = "a" | "b";

export const TICKRATE = 64;
export const TRADE_WINDOW_TICKS = 5 * TICKRATE;
export const HALFTIME_ROUND = 12;
export const REGULATION_ROUNDS = 24;

export function sideOf(raw: string | null | undefined): Side | null {
  const s = (raw ?? "").toUpperCase();
  if (s === "CT" || s.startsWith("COUNTER")) return "CT";
  if (s === "T" || s.startsWith("TERROR")) return "T";
  return null;
}

/** Is Team A (CT in round 1) on CT in this round? Handles halftime and OT halves. */
export function teamAIsCT(round: number): boolean {
  if (round <= REGULATION_ROUNDS) return round <= HALFTIME_ROUND;
  const otHalf = Math.floor((round - REGULATION_ROUNDS - 1) / 3);
  return otHalf % 2 === 0;
}

/** True between `round` and `round + 1` when the teams change sides. */
export function sideSwitchAfter(round: number): boolean {
  return teamAIsCT(round) !== teamAIsCT(round + 1);
}

/** Which team was on `side` during `round`. */
export function teamOnSide(side: Side, round: number): TeamKey {
  return (side === "CT") === teamAIsCT(round) ? "a" : "b";
}

/** Actual side in `round` for a player whose starting side is `start`. */
export function sideInRound(start: Side, round: number): Side {
  return teamAIsCT(round) === (start === "CT") ? "CT" : "T";
}

export function roundWinner(r: JobRound): TeamKey | null {
  const side = sideOf(r.winner);
  return side ? teamOnSide(side, r.round) : null;
}

export function teamScores(rounds: JobRound[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const r of rounds) {
    const w = roundWinner(r);
    if (w === "a") a++;
    else if (w === "b") b++;
  }
  return { a, b };
}

/** Clan tags per starting side, falling back to Team A / Team B. */
export function teamNames(stats: JobPayload["player_stats"]): { a: string; b: string } {
  let a = "";
  let b = "";
  for (const p of Object.values(stats ?? {})) {
    const clan = (p.clan ?? "").trim();
    if (!clan) continue;
    const side = sideOf(p.team);
    if (side === "CT" && !a) a = clan;
    if (side === "T" && !b) b = clan;
  }
  if (a && a === b) b = "";
  return { a: a || "Team A", b: b || "Team B" };
}

export interface AnnotatedKill {
  kill: JobKill;
  firstBlood: boolean;
  /** The killer died to anyone within the trade window. */
  traded: boolean;
  /** Killer's side in this round (starting side adjusted for the swap). */
  killerSide: Side | null;
  victimSide: Side | null;
}

/** Kills grouped by round, in tick order, with first-blood and trade flags. */
export function annotateKills(kills: JobKill[]): Map<number, AnnotatedKill[]> {
  const byRound = new Map<number, JobKill[]>();
  for (const k of kills) {
    const list = byRound.get(k.round);
    if (list) list.push(k);
    else byRound.set(k.round, [k]);
  }
  const out = new Map<number, AnnotatedKill[]>();
  for (const [round, list] of [...byRound.entries()].sort((x, y) => x[0] - y[0])) {
    const ordered = [...list].sort((x, y) => x.tick - y.tick);
    out.set(
      round,
      ordered.map((kill, i) => {
        const ks = sideOf(kill.killer_team);
        const vs = sideOf(kill.victim_team);
        return {
          kill,
          firstBlood: i === 0,
          traded: ordered.some(
            (later) =>
              later.tick > kill.tick && later.tick <= kill.tick + TRADE_WINDOW_TICKS && sameActor(later.victim, later.victim_steamid, kill.killer, kill.attacker_steamid),
          ),
          killerSide: ks ? sideInRound(ks, round) : null,
          victimSide: vs ? sideInRound(vs, round) : null,
        };
      }),
    );
  }
  return out;
}

function sameActor(name1: string, id1: string | null, name2: string, id2: string | null): boolean {
  if (id1 && id2) return id1 === id2;
  return name1.trim().toLowerCase() === name2.trim().toLowerCase();
}

export interface OpeningDuelRow {
  key: string;
  name: string;
  side: Side | null;
  firstKills: number;
  firstDeaths: number;
  net: number;
}

/** First kill of each round, tallied per player and sorted by net. */
export function openingDuels(annotated: Map<number, AnnotatedKill[]>): OpeningDuelRow[] {
  const tally = new Map<string, OpeningDuelRow>();
  const bump = (key: string, name: string, side: Side | null, field: "firstKills" | "firstDeaths") => {
    const row = tally.get(key) ?? { key, name, side, firstKills: 0, firstDeaths: 0, net: 0 };
    row[field] += 1;
    row.net = row.firstKills - row.firstDeaths;
    tally.set(key, row);
  };
  for (const list of annotated.values()) {
    const first = list[0];
    if (!first) continue;
    const k = first.kill;
    bump(k.attacker_steamid ?? k.killer, k.killer, sideOf(k.killer_team), "firstKills");
    bump(k.victim_steamid ?? k.victim, k.victim, sideOf(k.victim_team), "firstDeaths");
  }
  return [...tally.values()].sort((x, y) => y.net - x.net || y.firstKills - x.firstKills || x.name.localeCompare(y.name));
}

export interface PlayerRow {
  key: string;
  name: string;
  side: Side | null;
  kills: number;
  deaths: number;
  kd: number;
  headshots: number;
  hsRate: number;
  openingKills: number;
  trades: number;
}

/** Scoreboard rows keyed by SteamID64 when present, else by name. */
export function playerRows(annotated: Map<number, AnnotatedKill[]>, stats: JobPayload["player_stats"]): PlayerRow[] {
  const rows = new Map<string, PlayerRow>();
  const get = (key: string, name: string, side: Side | null) => {
    let row = rows.get(key);
    if (!row) {
      row = { key, name, side, kills: 0, deaths: 0, kd: 0, headshots: 0, hsRate: 0, openingKills: 0, trades: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const [id, p] of Object.entries(stats ?? {})) get(id, p.name, sideOf(p.team));
  for (const list of annotated.values()) {
    for (const { kill, firstBlood, traded } of list) {
      const killer = get(kill.attacker_steamid ?? kill.killer, kill.killer, sideOf(kill.killer_team));
      killer.kills++;
      if (kill.headshot) killer.headshots++;
      if (firstBlood) killer.openingKills++;
      get(kill.victim_steamid ?? kill.victim, kill.victim, sideOf(kill.victim_team)).deaths++;
      if (traded) {
        // The kill that answered this one within the window is the trade.
        const answer = list.find((o) => o.kill.tick > kill.tick && o.kill.tick <= kill.tick + TRADE_WINDOW_TICKS && sameActor(o.kill.victim, o.kill.victim_steamid, kill.killer, kill.attacker_steamid));
        if (answer) get(answer.kill.attacker_steamid ?? answer.kill.killer, answer.kill.killer, sideOf(answer.kill.killer_team)).trades++;
      }
    }
  }
  for (const r of rows.values()) {
    r.kd = r.deaths === 0 ? r.kills : r.kills / r.deaths;
    r.hsRate = r.kills === 0 ? 0 : r.headshots / r.kills;
  }
  return [...rows.values()].filter((r) => r.kills + r.deaths > 0).sort((x, y) => y.kills - x.kills || x.deaths - y.deaths);
}

export interface EconomyPoint {
  round: number;
  a: number;
  b: number;
  winner: TeamKey | null;
}

/** Spend per team per round, in dollars, with the winner attributed to a team. */
export function economySeries(rounds: JobRound[]): EconomyPoint[] {
  return [...rounds]
    .sort((x, y) => x.round - y.round)
    .map((r) => {
      const aIsCT = teamAIsCT(r.round);
      return {
        round: r.round,
        a: aIsCT ? r.ct_spend : r.t_spend,
        b: aIsCT ? r.t_spend : r.ct_spend,
        winner: roundWinner(r),
      };
    });
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Bounding box of every kill coordinate, padded by a fraction of each range. */
export function killBounds(kills: JobKill[], pad = 0.05): Bounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const k of kills) {
    for (const [x, y] of [
      [k.attacker_x, k.attacker_y],
      [k.victim_x, k.victim_y],
    ]) {
      if (Number.isFinite(x) && Number.isFinite(y) && !(x === 0 && y === 0)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const px = (maxX - minX || 1) * pad;
  const py = (maxY - minY || 1) * pad;
  return { minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py };
}

export function filterByRound<T extends { round: number }>(items: T[], round: number | null): T[] {
  return round == null ? items : items.filter((i) => i.round === round);
}
