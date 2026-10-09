"""services/assistant/tools.py: every tool runs as the caller and refuses
everything that is not theirs. User A owns a personal match and captains a
team with a team match and a strat; user B has their own match and is on no
team. Each tool is called as B against A's things and must fail, and as A
and must succeed. Tier redaction is checked through the findings tool."""

import json
import os
import uuid

import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.database import SessionLocal, engine
from db.models import (
    Base,
    Demo,
    Grenade,
    Kill,
    KnowledgeEmbedding,
    Match,
    MatchStatus,
    Round,
    Strat,
    StratRevision,
    Subscription,
    SyncOutbox,
    Team,
    TeamMember,
)
from services.assistant import policy
from services.assistant.tools import REGISTRY, ToolContext, run_tool, tool_schemas
from services.billing.entitlements import Tier, _clear_cache
from services.stratbook.service import create_strat

A, B = "user_a", "user_b"


def _demo(db, demo_id: str, *, rounds: int = 2) -> Demo:
    """Docstring for _demo."""
    demo = Demo(demo_id=demo_id, map_name="de_mirage", status=MatchStatus.COMPLETE, total_rounds=rounds, tickrate=64,
                player_stats_json=json.dumps({"76561198000000001": {"name": "alpha", "team": "CT", "clan": ""}}))
    db.add(demo)
    for n in range(1, rounds + 1):
        db.add(Round(demo_id=demo_id, round_num=n, winner_side="CT" if n % 2 else "T", reason="elimination",
                     ct_eq_val=4000 * n, t_eq_val=3000 * n, ct_score=n, t_score=0))
        db.add(Kill(demo_id=demo_id, round_num=n, tick=1000 * n, attacker="alpha", attacker_team="CT", victim="bravo",
                    victim_team="T", weapon="ak47", headshot=True, attacker_x=0, attacker_y=0, attacker_z=0,
                    victim_x=1, victim_y=1, victim_z=0))
        db.add(Grenade(demo_id=demo_id, round_num=n, tick=900 * n, thrower="alpha", team="CT", grenade_type="smoke",
                       throw_x=0, throw_y=0))
    return demo


COACHING = {
    "summary": "Lost on retakes.",
    "findings": [{"claim": "slow rotate", "rounds": [2]}],
    "report_v2": {
        "mode": "SELF_IMPROVEMENT",
        "summary": {"score": 61, "grade": "C", "headline": "Rotations cost the half"},
        "key_findings": [
            {"round": 2, "category": "Rotation", "severity": "HIGH", "observation": "rotated 11s late", "benchmark": "4.2s", "drill": "call rotations on first contact"},
            {"round": 5, "category": "Utility", "severity": "MEDIUM", "observation": "no CT smoke", "benchmark": "1 per execute", "drill": "assign the smoke"},
        ],
    },
}


@pytest.fixture()
def db():
    """Docstring for db."""
    Base.metadata.create_all(engine)
    _clear_cache()
    s = SessionLocal()
    # create_strat enqueues outbox rows; clear them so the Discord suites start empty.
    for model in (SyncOutbox, KnowledgeEmbedding, StratRevision, Strat, Subscription, TeamMember, Team, Grenade, Kill, Round, Match, Demo):
        s.query(model).delete()
    s.commit()
    yield s
    s.rollback()
    s.query(SyncOutbox).delete()
    s.commit()
    s.close()


@pytest.fixture()
def world(db):
    """Docstring for world."""
    team = Team(id=str(uuid.uuid4()), name="Night Shift", owner_user_id=A, invite_code=uuid.uuid4().hex[:8])
    db.add(team)
    db.add(TeamMember(team_id=team.id, user_id=A, role="owner"))
    _demo(db, "demo-a")
    _demo(db, "demo-t")
    _demo(db, "demo-b")
    db.add(Match(match_id="m-a", demo_id="demo-a", user_id=A, coaching_notes=json.dumps(COACHING)))
    db.add(Match(match_id="m-t", demo_id="demo-t", user_id=A, team_id=team.id, is_recon=True, match_name="Rivals"))
    db.add(Match(match_id="m-b", demo_id="demo-b", user_id=B, coaching_notes=json.dumps(COACHING)))
    db.commit()
    strat = create_strat(db, team_id=team.id, title="A exec", map_name="de_mirage", side="T", buy_type="full_buy",
                         canvas={"steps": [{"t": 0, "label": "smokes", "positions": {"p1": {"x": 0.1, "y": 0.2}}, "utility": []}]},
                         description="Deep smokes then palace", utility=[{"type": "smoke", "callout": "CT"}], author_id=A)
    db.add(KnowledgeEmbedding(content="Title: Banana control\nMap: de_inferno\nSteps:\n- smoke car\n- molly sandbags",
                              embedding=[0.0] * 768, source="team_strategy",
                              metadata_json=json.dumps({"team_id": team.id, "title": "Banana control", "map_name": "de_inferno",
                                                        "side": "T", "summary": "Take banana early", "steps": ["smoke car", "molly sandbags"], "author": "cap"})))
    db.commit()
    return {"team": team, "strat": strat}


def ctx(db, user: str, plan: str | None = None) -> ToolContext:
    """Docstring for ctx."""
    return ToolContext(db=db, user_id=user, plan_header=plan)


# --- registry ---------------------------------------------------------------


def test_every_tool_has_a_strict_schema_and_no_writes_yet():
    """Docstring for test_every_tool_has_a_strict_schema_and_no_writes_yet."""
    schemas = tool_schemas()
    assert {s["name"] for s in schemas} == set(REGISTRY)
    for s in schemas:
        assert s["description"] and s["parameters"]["type"] == "object"
        assert s["parameters"]["additionalProperties"] is False
    assert not any(t.writes for t in REGISTRY.values())


def test_unknown_tool_and_bad_arguments_come_back_as_data(db):
    """Docstring for test_unknown_tool_and_bad_arguments_come_back_as_data."""
    assert run_tool(ctx(db, A), "nope", {})["status"] == 404
    assert run_tool(ctx(db, A), "get_round", {"match_id": "m-a", "round": 0})["status"] == 400
    assert run_tool(ctx(db, A), "list_my_matches", {"scope": "everything"})["status"] == 400


# --- isolation: B against A's things ----------------------------------------


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_match_summary", {"match_id": "m-a"}),
        ("get_match_findings", {"match_id": "m-a"}),
        ("get_round", {"match_id": "m-a", "round": 1}),
        ("get_match_summary", {"match_id": "m-t"}),
        ("get_round", {"match_id": "m-t", "round": 1}),
    ],
)
def test_b_cannot_read_a_matches(db, world, name, args):
    """Docstring for test_b_cannot_read_a_matches."""
    out = run_tool(ctx(db, B), name, args)
    assert out["status"] == 404 and "not found" in out["error"]


def test_b_cannot_read_a_team(db, world):
    """Docstring for test_b_cannot_read_a_team."""
    team_id = world["team"].id
    assert run_tool(ctx(db, B), "list_team_strats", {"team_id": team_id})["status"] == 403
    assert run_tool(ctx(db, B), "search_team_strategies", {"team_id": team_id, "query": "banana"})["status"] == 403
    assert run_tool(ctx(db, B), "get_strat", {"strat_id": world["strat"].id})["status"] == 404
    assert run_tool(ctx(db, B), "list_team_strats", {"team_id": "ghost"})["status"] == 404


def test_lists_are_scoped_to_the_caller(db, world):
    """Docstring for test_lists_are_scoped_to_the_caller."""
    a = run_tool(ctx(db, A), "list_my_matches", {"scope": "all"})["matches"]
    assert {m["match_id"] for m in a} == {"m-a", "m-t"}
    assert {m["mode"] for m in a} == {"personal", "scouting"}
    assert next(m for m in a if m["match_id"] == "m-t")["opponent"] == "Rivals"
    b = run_tool(ctx(db, B), "list_my_matches", {})["matches"]
    assert [m["match_id"] for m in b] == ["m-b"]
    assert run_tool(ctx(db, A), "list_my_matches", {"scope": "personal"})["matches"][0]["match_id"] == "m-a"
    assert run_tool(ctx(db, B), "list_my_teams", {})["teams"] == []
    assert run_tool(ctx(db, A), "list_my_teams", {})["teams"][0]["role"] == "owner"


# --- the happy path, as A ---------------------------------------------------


def test_summary_and_round_carry_what_a_coach_needs(db, world):
    """Docstring for test_summary_and_round_carry_what_a_coach_needs."""
    s = run_tool(ctx(db, A), "get_match_summary", {"match_id": "m-a"})
    assert (s["map"], s["mode"], s["total_rounds"], s["final_score"]) == ("de_mirage", "personal", 2, {"ct": 2, "t": 0})
    assert s["players"][0]["name"] == "alpha"
    r = run_tool(ctx(db, A), "get_round", {"match_id": "m-a", "round": 2})
    assert r["winner"] == "T" and r["economy"] == {"ct": 8000, "t": 6000}
    assert r["kills"][0]["attacker"] == "alpha" and r["kills"][0]["headshot"] is True
    assert r["grenades"][0]["type"] == "smoke" and r["first_kill_tick"] == 2000
    assert run_tool(ctx(db, A), "get_round", {"match_id": "m-a", "round": 9})["status"] == 404


def test_findings_are_redacted_by_tier(db, world):
    """Free sees one takeaway and a lock; Solo Pro sees everything."""
    free = run_tool(ctx(db, A), "get_match_findings", {"match_id": "m-a"})
    assert len(free["findings"]) == 1 and "drill" not in free["findings"][0]
    assert free["locked"]["hidden_insights_count"] == 1

    db.add(Subscription(user_id=A, plan="basic", status="active"))
    db.commit()
    _clear_cache()
    pro = run_tool(ctx(db, A), "get_match_findings", {"match_id": "m-a"})
    assert len(pro["findings"]) == 2 and pro["findings"][0]["drill"]
    assert pro["summary"]["grade"] == "C" and "locked" not in pro


def test_pending_coaching_is_reported_not_errored(db, world):
    """Docstring for test_pending_coaching_is_reported_not_errored."""
    out = run_tool(ctx(db, A), "get_match_findings", {"match_id": "m-t"})
    assert out["status"] == "pending"


def test_strats_and_strategy_search(db, world):
    """Docstring for test_strats_and_strategy_search."""
    team_id = world["team"].id
    lst = run_tool(ctx(db, A), "list_team_strats", {"team_id": team_id, "map_name": "de_mirage"})["strats"]
    assert lst[0]["title"] == "A exec" and lst[0]["status"] == "DRAFT" and lst[0]["revisions"] == 1
    assert run_tool(ctx(db, A), "list_team_strats", {"team_id": team_id, "map_name": "de_nuke"})["strats"] == []
    one = run_tool(ctx(db, A), "get_strat", {"strat_id": world["strat"].id})
    assert one["description"] == "Deep smokes then palace" and one["steps"][0]["players"] == 1 and one["utility"][0]["callout"] == "CT"
    hit = run_tool(ctx(db, A), "search_team_strategies", {"team_id": team_id, "query": "banana sandbags"})["strategies"]
    assert hit[0]["title"] == "Banana control"
    miss = run_tool(ctx(db, A), "search_team_strategies", {"team_id": team_id, "query": "overpass"})["strategies"]
    assert miss == []


def test_my_plan_reflects_the_subscription(db, world):
    """Docstring for test_my_plan_reflects_the_subscription."""
    assert run_tool(ctx(db, A), "my_plan", {})["tier"] == "FREE"
    db.add(Subscription(user_id=A, plan="pro", status="active"))
    db.commit()
    _clear_cache()
    assert run_tool(ctx(db, A), "my_plan", {})["tier"] == "TEAM"


# --- policy ---------------------------------------------------------------------


def test_assistant_is_paid_only_with_a_daily_budget():
    """Docstring for test_assistant_is_paid_only_with_a_daily_budget."""
    from services.billing.entitlements import TIER_ENTITLEMENTS

    assert not policy.assistant_allowed(set(TIER_ENTITLEMENTS[Tier.FREE]))
    assert policy.assistant_allowed(set(TIER_ENTITLEMENTS[Tier.SOLO_PRO]))
    assert policy.assistant_allowed(set(TIER_ENTITLEMENTS[Tier.TEAM]))
    assert policy.daily_budget(Tier.FREE) == 0
    assert 0 < policy.daily_budget(Tier.SOLO_PRO) < policy.daily_budget(Tier.TEAM) < policy.daily_budget(Tier.TEAM, is_admin=True)
