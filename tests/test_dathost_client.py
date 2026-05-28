from unittest.mock import MagicMock, patch

import pytest

from services.warlord.dathost_client import provision_practice_server


@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("DATHOST_EMAIL", "test@test.com")
    monkeypatch.setenv("DATHOST_PASSWORD", "test-password")


@patch("services.warlord.dathost_client.is_valve_update_window", return_value=False)
@patch("requests.post")
def test_provision_practice_server_competitive(mock_post, mock_update_window):
    """Verify that 'practice' mode maps to competitive / classic_competitive."""
    # Mock the two calls: 1) Create server, 2) Start server
    mock_resp_create = MagicMock()
    mock_resp_create.json.return_value = {
        "id": "server-123",
        "ip": "127.0.0.1",
        "ports": {"game": 27015},
    }
    mock_resp_create.raise_for_status = MagicMock()

    mock_resp_start = MagicMock()
    mock_resp_start.raise_for_status = MagicMock()

    mock_post.side_effect = [mock_resp_create, mock_resp_start]

    res = provision_practice_server(
        match_id="match-abc",
        webhook_url="https://webhook.com",
        mode="practice",
    )

    # First call is Create server
    create_call_args = mock_post.call_args_list[0]
    files_payload = create_call_args.kwargs["files"]

    # In dathost_client, multipart data is structured as {key: (None, str(val))}
    assert files_payload["cs2_settings.game_mode"][1] == "competitive"
    assert files_payload["csgo_settings.game_mode"][1] == "classic_competitive"
    assert res["game_mode"] == "competitive"


@patch("services.warlord.dathost_client.is_valve_update_window", return_value=False)
@patch("requests.post")
def test_provision_practice_server_deathmatch(mock_post, mock_update_window):
    """Verify that 'tradefire' (deathmatch) mode maps to ffa_deathmatch / deathmatch."""
    mock_resp_create = MagicMock()
    mock_resp_create.json.return_value = {
        "id": "server-456",
        "ip": "127.0.0.1",
        "ports": {"game": 27015},
    }
    mock_resp_create.raise_for_status = MagicMock()

    mock_resp_start = MagicMock()
    mock_resp_start.raise_for_status = MagicMock()

    mock_post.side_effect = [mock_resp_create, mock_resp_start]

    res = provision_practice_server(
        match_id="match-xyz",
        webhook_url="https://webhook.com",
        mode="tradefire",
    )

    create_call_args = mock_post.call_args_list[0]
    files_payload = create_call_args.kwargs["files"]

    assert files_payload["cs2_settings.game_mode"][1] == "ffa_deathmatch"
    assert files_payload["csgo_settings.game_mode"][1] == "deathmatch"
    assert res["game_mode"] == "deathmatch"
