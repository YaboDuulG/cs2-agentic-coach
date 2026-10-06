"""services/warlord/rcon_client.py: the LLM may only issue known practice
commands; nobody may issue the lock-out commands; the Warlord node reports
what it refused instead of running it."""

from unittest.mock import AsyncMock, patch

import pytest

from services.warlord import rcon_client
from services.warlord.rcon_client import check_command, execute_batch_commands, filter_commands

SAFE = [
    "mp_pause_match",
    "mp_unpause_match",
    "mp_restartgame 1",
    "mp_warmup_pausetimer 1",
    "sv_cheats 1",
    "sv_infinite_ammo 1",
    "bot_kick",
    "bot_kick all",
    "bot_add_ct",
    "changelevel de_mirage",
    "map de_inferno",
    "mp_freezetime 0",
    "mp_roundtime 60",
    "exec practice",
    "say Practice starts in 2 minutes",
    "status",
]

NEVER = [
    "quit",
    "exit",
    "_restart",
    "rcon_password hunter2",
    "sv_password letmein",
    "host_workshop_map 123",
    "sv_downloadurl http://evil.example",
    "logaddress_add 1.2.3.4:27500",
    "banid 0 STEAM_1:0:1 kick",
    "kickid 3",
    "sv_lan 1",
    "sv_setsteamaccount ABC",
    "tv_enable 1",
    "writeconfig",
]

UNKNOWN_FOR_THE_LLM = [
    "sv_gravity 100",
    "mp_teammates_are_enemies 1",
    "noclip",
    "give weapon_awp",
    "changelevel ../../etc/passwd",
    "changelevel de_mirage; quit",
    "mp_restartgame 1\nquit",
    "exec ../server.cfg",
    "bot_add_ct 5",
    "sv_cheats 2",
]


class TestPolicy:
    """Docstring for TestPolicy."""

    @pytest.mark.parametrize("cmd", SAFE)
    def test_practice_commands_pass_the_allowlist(self, cmd):
        """Docstring for test_practice_commands_pass_the_allowlist."""
        assert check_command(cmd, strict=True) is None

    @pytest.mark.parametrize("cmd", NEVER)
    def test_lockout_commands_are_refused_for_everyone(self, cmd):
        """Docstring for test_lockout_commands_are_refused_for_everyone."""
        assert check_command(cmd, strict=True) is not None
        assert check_command(cmd, strict=False) is not None

    @pytest.mark.parametrize("cmd", UNKNOWN_FOR_THE_LLM)
    def test_unknown_or_malformed_commands_are_refused_for_the_llm(self, cmd):
        """Docstring for test_unknown_or_malformed_commands_are_refused_for_the_llm."""
        assert check_command(cmd, strict=True) is not None

    def test_the_console_runs_unknown_but_not_denied_commands(self):
        """A person at their own server's console gets the denylist only."""
        assert check_command("sv_gravity 100", strict=False) is None
        assert check_command("noclip", strict=False) is None
        assert check_command("quit", strict=False) == "not allowed through DemoSage"

    def test_chaining_is_refused_even_for_the_console(self):
        """Docstring for test_chaining_is_refused_even_for_the_console."""
        assert check_command("status; quit", strict=False) is not None
        assert check_command("status\nquit", strict=False) is not None

    def test_case_and_whitespace_do_not_dodge_the_check(self):
        """Docstring for test_case_and_whitespace_do_not_dodge_the_check."""
        assert check_command("  QUIT  ", strict=False) is not None
        assert check_command("Rcon_Password x", strict=True) is not None
        assert check_command("  MP_PAUSE_MATCH ", strict=True) is None

    def test_filter_splits_allowed_from_refused(self):
        """Docstring for test_filter_splits_allowed_from_refused."""
        allowed, refused = filter_commands(["sv_cheats 1", "quit", 42, "bot_kick"])  # type: ignore[list-item]
        assert allowed == ["sv_cheats 1", "bot_kick"]
        assert [c for c, _ in refused] == ["quit", "42"]


class TestExecution:
    """Docstring for TestExecution."""

    async def test_a_refused_command_refuses_the_whole_batch(self, monkeypatch):
        """Docstring for test_a_refused_command_refuses_the_whole_batch."""
        ran = []
        monkeypatch.setattr(rcon_client, "Client", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not connect")))
        with pytest.raises(ValueError) as e:
            await execute_batch_commands("127.0.0.1", 27015, "pw", ["sv_cheats 1", "quit"])
        assert "quit" in str(e.value) and ran == []

    async def test_an_allowed_batch_runs_every_command(self, monkeypatch):
        """Docstring for test_an_allowed_batch_runs_every_command."""
        ran = []

        class FakeClient:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cmd):
                ran.append(cmd)
                return f"ok {cmd}"

        monkeypatch.setattr(rcon_client, "Client", FakeClient)
        out = await execute_batch_commands("127.0.0.1", 27015, "pw", ["sv_cheats 1", " bot_kick "])
        assert ran == ["sv_cheats 1", "bot_kick"] and out == ["ok sv_cheats 1", "ok bot_kick"]


class TestWarlordNode:
    """The agent path: the model's output goes through the allowlist."""

    async def _run(self, monkeypatch, llm_json: str):
        """Docstring for _run."""
        import os

        os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
        from agents.khan import nodes
        from db.database import SessionLocal, engine
        from db.models import Base, Match, PracticeServer, Team

        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            db.query(PracticeServer).delete()
            db.query(Match).delete()
            db.query(Team).delete()
            db.add(Team(id="t-w", name="W", owner_user_id="o", invite_code="WARLORD1"))
            from datetime import datetime, timedelta

            db.add(PracticeServer(id="s-w", team_id="t-w", vultr_instance_id="dh", ip_address="10.0.0.1:27015",
                                  rcon_password="r", server_password="s", status="active",
                                  expires_at=datetime.now() + timedelta(hours=1)))
            db.add(Match(match_id="m-w", demo_id="d-w", team_id="t-w", user_id="o"))
            db.commit()

        monkeypatch.setenv("GEMINI_API_KEY", "fake")

        class FakeLLM:
            def __init__(self, *a, **k):
                pass

            async def ainvoke(self, prompt):
                class R:
                    content = llm_json
                    usage_metadata = None

                return R()

        import langchain_google_genai

        monkeypatch.setattr(langchain_google_genai, "ChatGoogleGenerativeAI", FakeLLM)
        executed = AsyncMock(return_value=[])
        with patch("services.warlord.rcon_client.execute_batch_commands", executed):
            result = await nodes.warlord_node({"match_id": "m-w", "user_query": "set up practice"})
        return result["final_report"], executed

    async def test_safe_commands_run_and_refused_ones_are_reported(self, monkeypatch):
        """Docstring for test_safe_commands_run_and_refused_ones_are_reported."""
        report, executed = await self._run(monkeypatch, '{"commands": ["sv_cheats 1", "quit", "mp_warmup_pausetimer 1"]}')
        executed.assert_awaited_once()
        assert executed.await_args.args[3] == ["sv_cheats 1", "mp_warmup_pausetimer 1"]
        assert "Refused 1" in report["summary"]
        assert any("Refused: quit" in f for f in report["key_findings"])

    async def test_only_refused_commands_means_nothing_runs(self, monkeypatch):
        """Docstring for test_only_refused_commands_means_nothing_runs."""
        report, executed = await self._run(monkeypatch, '{"commands": ["quit", "rcon_password x"]}')
        executed.assert_not_awaited()
        assert "won't run that" in report["summary"]
