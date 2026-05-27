"""
validate_parse.py
=================
Runs parse_demo against demos/DemolitionNuke.dem and produces a validation
report with assertions.

Run from project root:
    py scratch/validate_parse.py
"""

from pathlib import Path
import sys
import time

# Ensure project root is on sys.path so `services.scout.parse_demo` imports work
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.scout.parse_demo import parse_demo  # noqa: E402

DEMO_PATH = str(ROOT / "demos" / "DemolitionNuke.dem")

print("=" * 70)
print("CS2 Demo Validation Report")
print(f"Demo: {DEMO_PATH}")
print("=" * 70)
print("Parsing... (may take 2-5 minutes for a 419 MB demo)")
print()

t0 = time.time()
output = parse_demo(DEMO_PATH)
elapsed = time.time() - t0

print()
print(f"Parse completed in {elapsed:.1f}s")
print()

# ── Metadata ──────────────────────────────────────────────────────────────────
meta = output.get("metadata", {})
total_rounds = meta.get("total_rounds", 0)
warmup_excluded = meta.get("warmup_rounds_excluded", [])
map_name = meta.get("map", "unknown")
tickrate = meta.get("tickrate", 0)

print("── METADATA ─────────────────────────────────────────────────────────────")
print(f"  map                    : {map_name}")
print(f"  tickrate               : {tickrate}")
print(f"  total_rounds           : {total_rounds}")
print(f"  warmup_rounds_excluded : {warmup_excluded}")
print()

# ── Event counts ──────────────────────────────────────────────────────────────
kills = output.get("kills", [])
grenades = output.get("grenades", [])
first_contacts = output.get("first_contacts", [])
rounds = output.get("rounds", [])

print("── EVENT COUNTS ──────────────────────────────────────────────────────────")
print(f"  kills         : {len(kills)}")
print(f"  grenades      : {len(grenades)}")
print(f"  first_contacts: {len(first_contacts)}")
print(f"  rounds        : {len(rounds)}")
print()

# ── Round-side breakdown ───────────────────────────────────────────────────────
ct_wins = sum(1 for r in rounds if r.get("winner_side") == "CT")
t_wins = sum(1 for r in rounds if r.get("winner_side") == "T")
empty_winner_rounds = [r["round_num"] for r in rounds if not r.get("winner_side")]

print("── ROUND SIDE BREAKDOWN ──────────────────────────────────────────────────")
print(f"  CT rounds won  : {ct_wins}")
print(f"  T  rounds won  : {t_wins}")
print(f"  CT + T         : {ct_wins + t_wins}")
print(f"  total_rounds   : {total_rounds}")
if empty_winner_rounds:
    print(f"  ⚠  Rounds with empty winner_side: {empty_winner_rounds}")
else:
    print("  ✓  No rounds with empty winner_side")
print()

# ── Anomalies ─────────────────────────────────────────────────────────────────
round_kill_counts: dict[int, int] = {}
for k in kills:
    rn = k.get("round", 0)
    round_kill_counts[rn] = round_kill_counts.get(rn, 0) + 1

zero_kill_rounds = [r["round_num"] for r in rounds if round_kill_counts.get(r["round_num"], 0) == 0]

print("── ANOMALIES ─────────────────────────────────────────────────────────────")
if zero_kill_rounds:
    print(f"  ⚠  Rounds with 0 kills ({len(zero_kill_rounds)}): {zero_kill_rounds}")
else:
    print("  ✓  All rounds have at least 1 kill")
print()

# ── Per-player stats (top 5 by kills) ─────────────────────────────────────────
player_stats = output.get("player_stats", {})

players_sorted = sorted(
    player_stats.values(),
    key=lambda p: p.get("kills", 0),
    reverse=True,
)

print("── TOP-5 PLAYERS BY KILLS ───────────────────────────────────────────────")
print(f"  {'Name':<20} {'Team':<12} {'K':>4} {'D':>4} {'KAST%':>6} {'ADR':>6}")
print(f"  {'-'*20} {'-'*12} {'-'*4} {'-'*4} {'-'*6} {'-'*6}")
for p in players_sorted[:5]:
    name = p.get("name", "?")[:20]
    team = p.get("team", "?")[:12]
    k = p.get("kills", 0)
    d = p.get("deaths", 0)
    kast = p.get("kast", 0.0)
    adr = p.get("adr", 0.0)
    print(f"  {name:<20} {team:<12} {k:>4} {d:>4} {kast:>6.1f} {adr:>6.1f}")
print()

# ── All-player summary ────────────────────────────────────────────────────────
print(f"  Total unique players tracked: {len(player_stats)}")
print()

# ── Round-by-round table ──────────────────────────────────────────────────────
print("── ROUND TABLE (all rounds) ─────────────────────────────────────────────")
print(f"  {'Rnd':>4} {'Winner':>6} {'Reason':<30} {'CT$':>7} {'T$':>7} {'Score':>8}")
print(f"  {'-'*4} {'-'*6} {'-'*30} {'-'*7} {'-'*7} {'-'*8}")
for r in rounds:
    score = f"{r.get('ct_score',0)}-{r.get('t_score',0)}"
    print(
        f"  {r['round_num']:>4} {r.get('winner_side','?'):>6} "
        f"{r.get('reason',''):<30} "
        f"{r.get('ct_eq_val',0):>7} {r.get('t_eq_val',0):>7} "
        f"{score:>8}"
    )
print()

# ── Assertions ────────────────────────────────────────────────────────────────
print("── ASSERTIONS ───────────────────────────────────────────────────────────")

errors: list[str] = []

# 1. total_rounds >= 15
try:
    assert total_rounds >= 15, f"total_rounds={total_rounds} < 15"
    print(f"  ✓  total_rounds >= 15  (got {total_rounds})")
except AssertionError as e:
    errors.append(str(e))
    print(f"  ✗  {e}")

# 2. warmup_rounds_excluded not empty
try:
    assert len(warmup_excluded) > 0, "warmup_rounds_excluded is empty — no warmup detected"
    print(f"  ✓  warmup detected: {warmup_excluded}")
except AssertionError as e:
    errors.append(str(e))
    print(f"  ✗  {e}")

# 3. CT_wins + T_wins == total_rounds
try:
    assert ct_wins + t_wins == total_rounds, (
        f"CT_wins({ct_wins}) + T_wins({t_wins}) = {ct_wins+t_wins} ≠ total_rounds({total_rounds})"
    )
    print(f"  ✓  CT_wins + T_wins == total_rounds  ({ct_wins} + {t_wins} = {total_rounds})")
except AssertionError as e:
    errors.append(str(e))
    print(f"  ✗  {e}")

print()
print("=" * 70)
if errors:
    print(f"RESULT: {len(errors)} assertion(s) FAILED")
    for err in errors:
        print(f"  - {err}")
    sys.exit(1)
else:
    print("RESULT: All assertions PASSED ✓")
print("=" * 70)
