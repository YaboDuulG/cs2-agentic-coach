"""
Per-round telemetry endpoint tests (2D demo viewer data).
"""

import json
import os

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
os.environ.setdefault("LOCAL_MODE", "true")

from fastapi.testclient import TestClient

from api.main import app
from db.database import engine, get_session
from db.models import Base, Grenade, Kill, Match, PlayerTrajectory

client = TestClient(app)

MATCH_ID = "telemetry-match-0000"


def setup_module(_m):
    """Docstring for setup_module."""
    # Created here, not at import time: another module in the suite drops the
    # shared engine's tables during its teardown, which runs after imports.
    Base.metadata.create_all(engine)
    gen = get_session()
    db = next(gen)
    db.add(
        Match(
            match_id=MATCH_ID, map_name="de_mirage", tickrate=64, total_rounds=2,
            user_id="owner-1",
        )
    )
    db.add(
        PlayerTrajectory(
            match_id=MATCH_ID, round_num=1, player="111", team="CT",
            positions_json=json.dumps(
                [{"tick": 100, "x": 1.0, "y": 2.0, "z": 0.0},
                 {"tick": 228, "x": 5.0, "y": 6.0, "z": 0.0}]
            ),
        )
    )
    db.add(
        Kill(
            match_id=MATCH_ID, round_num=1, tick=200, attacker="111", victim="222",
            weapon="ak47", headshot=True, attacker_x=3.0, attacker_y=4.0,
            victim_x=5.0, victim_y=6.0,
        )
    )
    db.add(
        Grenade(
            match_id=MATCH_ID, round_num=1, tick=150, thrower="111",
            grenade_type="Smoke Grenade", throw_x=10.0, throw_y=20.0,
        )
    )
    db.commit()
    db.close()


def test_round_telemetry_shape():
    """Docstring for test_round_telemetry_shape."""
    r = client.get(f"/api/jobs/{MATCH_ID}/rounds/1/telemetry?user_id=owner-1")
    assert r.status_code == 200
    data = r.json()
    assert data["map"] == "de_mirage"
    assert data["tickrate"] == 64
    assert data["players"][0]["player"] == "111"
    assert data["players"][0]["points"][1]["tick"] == 228
    assert data["kills"][0]["headshot"] is True
    assert data["grenades"][0]["type"] == "Smoke Grenade"


def test_round_without_data_is_empty_not_error():
    """Docstring for test_round_without_data_is_empty_not_error."""
    r = client.get(f"/api/jobs/{MATCH_ID}/rounds/9/telemetry?user_id=owner-1")
    assert r.status_code == 200
    assert r.json()["players"] == []


def test_other_user_forbidden():
    """Docstring for test_other_user_forbidden."""
    r = client.get(f"/api/jobs/{MATCH_ID}/rounds/1/telemetry?user_id=intruder")
    assert r.status_code == 403


def test_unknown_match_404():
    """Docstring for test_unknown_match_404."""
    r = client.get("/api/jobs/nope/rounds/1/telemetry?user_id=owner-1")
    assert r.status_code == 404
