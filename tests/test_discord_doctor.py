"""scripts/discord_doctor.py: the checks behind each PASS/FAIL line. The
network calls live in main(); everything it decides is in these functions."""

from scripts.discord_doctor import (
    check_application,
    check_commands,
    check_endpoint,
    check_env,
    describe_channels,
    load_env_file,
)
from scripts.register_discord_commands import STRAT_COMMAND
from tests.discord_fakes import GUILD_CHANNELS

API = "https://api.example.test"
ENV = {
    "DISCORD_APP_ID": "123",
    "DISCORD_PUBLIC_KEY": "ab" * 32,
    "DISCORD_BOT_TOKEN": "token",
    "DISCORD_WEBHOOK_SECRET": "secret",
}


class TestEnv:
    """Docstring for TestEnv."""

    def test_complete_settings_pass(self):
        """Docstring for test_complete_settings_pass."""
        assert all(c.ok for c in check_env(ENV))

    def test_missing_and_placeholder_values_fail_without_leaking_values(self):
        """Docstring for test_missing_and_placeholder_values_fail_without_leaking_values."""
        env = {**ENV, "DISCORD_BOT_TOKEN": "", "DISCORD_WEBHOOK_SECRET": "pick_any_local_secret_for_bind_codes"}
        failed = {c.name for c in check_env(env) if not c.ok}
        assert failed == {"DISCORD_BOT_TOKEN is set", "DISCORD_WEBHOOK_SECRET is set"}
        assert all("ab" * 32 not in c.line() and "secret" not in c.detail for c in check_env(ENV))

    def test_public_key_must_be_64_hex(self):
        """Docstring for test_public_key_must_be_64_hex."""
        checks = check_env({**ENV, "DISCORD_PUBLIC_KEY": "not-a-key"})
        assert [c.ok for c in checks if "64 hex" in c.name] == [False]

    def test_env_file_parsing(self, tmp_path):
        """Docstring for test_env_file_parsing."""
        f = tmp_path / ".env"
        f.write_text('# comment\nDISCORD_APP_ID=42\nDISCORD_BOT_TOKEN="quoted"\n\nNOT A LINE\n', encoding="utf-8")
        assert load_env_file(f) == {"DISCORD_APP_ID": "42", "DISCORD_BOT_TOKEN": "quoted"}
        assert load_env_file(tmp_path / "missing") == {}


class TestApplication:
    """Docstring for TestApplication."""

    def test_matching_application_passes(self):
        """Docstring for test_matching_application_passes."""
        app = {"id": "123", "verify_key": "AB" * 32, "interactions_endpoint_url": f"{API}/api/discord/interactions", "flags": 1 << 18}
        assert all(c.ok for c in check_application(app, ENV, API + "/"))

    def test_message_content_intent_is_required(self):
        """Docstring for test_message_content_intent_is_required."""
        app = {"id": "123", "verify_key": "ab" * 32, "interactions_endpoint_url": f"{API}/api/discord/interactions"}
        off = {c.name: c for c in check_application({**app, "flags": 0}, ENV, API)}
        assert not off["Message Content intent is on (needed by /strat ingest)"].ok
        on = {c.name: c for c in check_application({**app, "flags": 1 << 19}, ENV, API)}
        assert on["Message Content intent is on (needed by /strat ingest)"].ok

    def test_wrong_key_and_missing_endpoint_fail(self):
        """Docstring for test_wrong_key_and_missing_endpoint_fail."""
        app = {"id": "123", "verify_key": "cd" * 32, "interactions_endpoint_url": None}
        checks = {c.name: c for c in check_application(app, ENV, API)}
        assert not checks["public key matches the application"].ok
        assert not checks["Interactions Endpoint URL points at the API"].ok
        assert f"{API}/api/discord/interactions" in checks["Interactions Endpoint URL points at the API"].detail


class TestCommands:
    """Docstring for TestCommands."""

    def test_registered_command_set_passes(self):
        """Docstring for test_registered_command_set_passes."""
        assert check_commands([STRAT_COMMAND], "global").ok

    def test_not_registered_fails(self):
        """Docstring for test_not_registered_fails."""
        assert not check_commands([], "global").ok

    def test_stale_registration_names_what_is_missing(self):
        """A server registered before /strat channels existed."""
        stale = {"name": "strat", "options": [o for o in STRAT_COMMAND["options"] if o["name"] not in ("channels", "ingest")]}
        check = check_commands([stale], "guild 1")
        assert not check.ok and "channels" in check.detail and "ingest" in check.detail

    def test_create_and_view_do_not_require_a_map(self):
        """The map comes from the channel, so the option must be optional."""
        subs = {o["name"]: o for o in STRAT_COMMAND["options"]}
        for name in ("create", "view"):
            map_opt = next(o for o in subs[name]["options"] if o["name"] == "map")
            assert map_opt["required"] is False
        # Discord rejects a command whose required options come after optional ones.
        for sub in STRAT_COMMAND["options"]:
            flags = [o.get("required", False) for o in sub.get("options", [])]
            assert flags == sorted(flags, reverse=True), sub["name"]


class TestEndpoint:
    """Docstring for TestEndpoint."""

    def test_signature_refusal_is_the_pass(self):
        """Docstring for test_signature_refusal_is_the_pass."""
        assert check_endpoint(401, '{"detail":"Bad request signature"}').ok

    def test_unconfigured_service_fails_with_the_reason(self):
        """Docstring for test_unconfigured_service_fails_with_the_reason."""
        check = check_endpoint(401, '{"detail":"DISCORD_PUBLIC_KEY is not configured"}')
        assert not check.ok and "not set on the API service" in check.detail

    def test_accepting_an_unsigned_request_fails(self):
        """Docstring for test_accepting_an_unsigned_request_fails."""
        assert not check_endpoint(200, '{"type":1}').ok


class TestChannels:
    """Docstring for TestChannels."""

    def test_finds_the_group_and_reports_ignored_channels(self):
        """Docstring for test_finds_the_group_and_reports_ignored_channels."""
        check, lines = describe_channels(GUILD_CHANNELS)
        assert check.ok and "3 map channels" in check.detail
        text = "\n".join(lines)
        assert "group 'Maps'" in text and "#de-inferno -> de_inferno" in text
        assert "#training" in text and "#strat-general" in text

    def test_a_server_without_map_channels_fails(self):
        """Docstring for test_a_server_without_map_channels_fails."""
        channels = [{"id": "c1", "type": 4, "name": "General"}, {"id": "c2", "type": 0, "name": "chat", "parent_id": "c1"}]
        assert not describe_channels(channels)[0].ok
