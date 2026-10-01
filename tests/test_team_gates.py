"""Team is a hard paywall on the server, not only in the UI: creating a team,
spinning up a practice server and opening a training session all return 402
without the Team season (seats inherit the owner's). Also covers the roster
endpoint (leave / remove) and the practice-server console."""

from datetime import datetime, timedelta
import os

from fastapi.testclient import TestClient
import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
os.environ["LOCAL_MODE"] = "true"

from api.main import app
from api.routes import servers as servers_route
from db.database import SessionLocal, engine
from db.models import Base, PracticeServer, Subscription, Team, TeamMember, TrainingSession
from services.billing.entitlements import _clear_cache

client = TestClient(app)

OWNER = "user_owner"
MEMBER = "user_member"
FREE = "user_free"


@pytest.fixture()
def db():
    """Fresh tables, empty entitlement cache."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    for model in (TrainingSession, PracticeServer, TeamMember, Team, Subscription):
        session.query(model).delete()
    session.commit()
    _clear_cache()
    yield session
    session.close()
    _clear_cache()


def _season(db, user_id: str) -> None:
    """Docstring for _season."""
    db.add(
        Subscription(
            user_id=user_id,
            plan="pro",
            status="active",
            season=59,
            season_until=datetime.now() + timedelta(days=60),
        )
    )
    db.commit()


def _team(db, owner: str = OWNER, members: tuple[str, ...] = (MEMBER,)) -> str:
    """Docstring for _team."""
    db.add(Team(id="t1", name="Alpha", owner_user_id=owner, invite_code="ALPHA001"))
    db.add(TeamMember(team_id="t1", user_id=owner, role="owner"))
    for m in members:
        db.add(TeamMember(team_id="t1", user_id=m, role="member"))
    db.commit()
    return "t1"


class TestCreateTeamGate:
    """Docstring for TestCreateTeamGate."""

    def test_free_user_gets_402_with_upgrade_metadata(self, db):
        """Docstring for test_free_user_gets_402_with_upgrade_metadata."""
        r = client.post("/api/teams", json={"name": "No Plan", "user_id": FREE})
        assert r.status_code == 402
        assert r.json()["detail"]["locked"] is True
        assert db.query(Team).count() == 0

    def test_season_holder_creates_a_team(self, db):
        """Docstring for test_season_holder_creates_a_team."""
        _season(db, OWNER)
        r = client.post("/api/teams", json={"name": "Alpha", "user_id": OWNER})
        assert r.status_code == 200, r.text
        assert len(r.json()["invite_code"]) == 8

    def test_plan_header_is_the_clerk_fallback(self, db):
        """Docstring for test_plan_header_is_the_clerk_fallback."""
        r = client.post(
            "/api/teams", json={"name": "Header", "user_id": "user_hdr"}, headers={"x-user-plan": "pro"}
        )
        assert r.status_code == 200, r.text

    def test_join_by_code_stays_open(self, db):
        """Docstring for test_join_by_code_stays_open."""
        _team(db, members=())
        r = client.post("/api/teams/join", json={"invite_code": "alpha001", "user_id": FREE})
        assert r.status_code == 200
        assert r.json()["status"] == "joined"


class TestRoster:
    """Docstring for TestRoster."""

    def test_member_leaves(self, db):
        """Docstring for test_member_leaves."""
        _team(db)
        r = client.delete(f"/api/teams/t1/members/{MEMBER}", params={"user_id": MEMBER})
        assert r.status_code == 200
        assert r.json()["status"] == "left"
        assert db.query(TeamMember).filter_by(user_id=MEMBER).count() == 0

    def test_owner_removes_a_member(self, db):
        """Docstring for test_owner_removes_a_member."""
        _team(db)
        r = client.delete(f"/api/teams/t1/members/{MEMBER}", params={"user_id": OWNER})
        assert r.status_code == 200
        assert r.json()["status"] == "removed"

    def test_owner_cannot_leave(self, db):
        """Docstring for test_owner_cannot_leave."""
        _team(db)
        r = client.delete(f"/api/teams/t1/members/{OWNER}", params={"user_id": OWNER})
        assert r.status_code == 400
        assert db.query(TeamMember).filter_by(user_id=OWNER).count() == 1

    def test_member_cannot_remove_others(self, db):
        """Docstring for test_member_cannot_remove_others."""
        _team(db, members=(MEMBER, "user_other"))
        r = client.delete("/api/teams/t1/members/user_other", params={"user_id": MEMBER})
        assert r.status_code == 403

    def test_unknown_member_is_404(self, db):
        """Docstring for test_unknown_member_is_404."""
        _team(db)
        r = client.delete("/api/teams/t1/members/nobody", params={"user_id": OWNER})
        assert r.status_code == 404


class TestServerGate:
    """Docstring for TestServerGate."""

    def test_member_without_season_gets_402(self, db):
        """Docstring for test_member_without_season_gets_402."""
        _team(db)
        r = client.post(
            "/api/teams/t1/servers", json={"mode": "practice", "region": "eu"}, headers={"x-clerk-user-id": MEMBER}
        )
        assert r.status_code == 402
        assert db.query(PracticeServer).count() == 0

    def test_seat_inherits_the_owners_season(self, db, monkeypatch):
        """Docstring for test_seat_inherits_the_owners_season."""
        monkeypatch.setattr(servers_route, "check_cs2_update_active", lambda: (False, ""))
        _team(db)
        _season(db, OWNER)
        r = client.post(
            "/api/teams/t1/servers", json={"mode": "practice", "region": "eu"}, headers={"x-clerk-user-id": MEMBER}
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "active"

    def test_training_session_requires_season(self, db):
        """Docstring for test_training_session_requires_season."""
        _team(db)
        r = client.post(
            "/api/teams/t1/training-sessions",
            params={"user_id": MEMBER},
            json={"mode": "practice", "map_name": "de_mirage", "region": "eu"},
        )
        assert r.status_code == 402
        _season(db, OWNER)
        _clear_cache()
        r = client.post(
            "/api/teams/t1/training-sessions",
            params={"user_id": MEMBER},
            json={"mode": "practice", "map_name": "de_mirage", "region": "eu"},
        )
        assert r.status_code == 200, r.text


class TestConsole:
    """Docstring for TestConsole."""

    def _server(self, db, host_id: str, status: str = "active") -> str:
        """Docstring for _server."""
        db.add(
            PracticeServer(
                id="srv1",
                team_id="t1",
                vultr_instance_id=host_id,
                rcon_password="r",
                server_password="s",
                status=status,
                expires_at=datetime.now() + timedelta(hours=1),
            )
        )
        db.commit()
        return "srv1"

    def test_non_member_is_403(self, db):
        """Docstring for test_non_member_is_403."""
        _team(db)
        self._server(db, "dh_1")
        r = client.post("/api/servers/srv1/console", json={"command": "status"}, headers={"x-clerk-user-id": FREE})
        assert r.status_code == 403

    def test_local_server_has_no_console(self, db):
        """Docstring for test_local_server_has_no_console."""
        _team(db)
        self._server(db, "local-123")
        r = client.get("/api/servers/srv1/console", headers={"x-clerk-user-id": MEMBER})
        assert r.status_code == 503

    def test_stopped_server_is_409(self, db):
        """Docstring for test_stopped_server_is_409."""
        _team(db)
        self._server(db, "dh_1", status="terminated")
        r = client.post("/api/servers/srv1/console", json={"command": "status"}, headers={"x-clerk-user-id": MEMBER})
        assert r.status_code == 409

    def test_command_is_sent_and_tail_returned(self, db, monkeypatch):
        """Docstring for test_command_is_sent_and_tail_returned."""
        _team(db)
        self._server(db, "dh_1")
        sent: list[tuple[str, str]] = []
        monkeypatch.setattr(servers_route, "send_console_command", lambda host, line: sent.append((host, line)))
        monkeypatch.setattr(servers_route, "read_console", lambda host, max_lines=50: ["hostname: Alpha practice", "status ok"])
        r = client.post("/api/servers/srv1/console", json={"command": "  status "}, headers={"x-clerk-user-id": MEMBER})
        assert r.status_code == 200, r.text
        assert sent == [("dh_1", "status")]
        assert r.json()["lines"][-1] == "status ok"

    def test_dathost_failure_is_502(self, db, monkeypatch):
        """Docstring for test_dathost_failure_is_502."""
        _team(db)
        self._server(db, "dh_1")

        def boom(host, line):
            raise ValueError("Console command failed: 500")

        monkeypatch.setattr(servers_route, "send_console_command", boom)
        r = client.post("/api/servers/srv1/console", json={"command": "status"}, headers={"x-clerk-user-id": MEMBER})
        assert r.status_code == 502
