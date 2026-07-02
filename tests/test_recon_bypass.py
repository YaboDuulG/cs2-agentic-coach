"""Module docstring."""
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

# Mock demoparser2 which is not installed in CI environment
sys.modules["demoparser2"] = MagicMock()

from fastapi import HTTPException
import pytest

# Set up Python path so that services/scout modules are importable
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "scout"))
sys.path.insert(0, str(Path(__file__).parent.parent))

# Set LOCAL_MODE=true for testing
import os

os.environ["LOCAL_MODE"] = "true"

from services.scout.service import ParseRequest, parse_match


@pytest.mark.asyncio
async def test_scout_recon_validation_bypass():
    """Verify that when is_recon is True, the uploader Steam ID check is bypassed in Scout parse."""

    # Mock parse_demo to return a dummy parse outcome
    mock_result = {
        "metadata": {"map": "de_mirage", "total_rounds": 10},
        "kills": [],
        "grenades": [],
        "trajectories": [],
        "player_stats": {
            # Let's say uploader_steam_id is NOT in the players list
            "76561198000000000": {"name": "Other Player"}
        },
    }

    # Mock db Session and Match object
    mock_match_obj = MagicMock()
    mock_match_obj.match_id = "test-recon-match"
    mock_match_obj.user_id = "test-user-id"
    mock_match_obj.uploader_steam_id = "76561198999999999"  # Uploader Steam ID
    mock_match_obj.is_recon = True  # Bypassed!

    mock_db = MagicMock()
    mock_db.get.return_value = mock_match_obj

    # Mock other functions called inside parse_match
    with (
        patch("services.scout.service.LOCAL_MODE", True),
        patch("parse_demo.parse_demo", return_value=mock_result) as mock_parse_demo,
        patch("parse_demo.write_to_db") as mock_write_to_db,
        patch("services.scout.service._trigger_coaching"),
        patch("services.scout.service._mark_failed"),
        patch("db.database.SessionLocal", return_value=mock_db),
    ):
        req = ParseRequest(match_id="test-recon-match", dem_path="dummy.dem")

        # This should execute successfully and NOT raise ValueError / abort
        res = await parse_match(req)

        assert res.match_id == "test-recon-match"
        assert res.status == "complete"
        assert res.map == "de_mirage"

        # Verify parse_demo was called
        mock_parse_demo.assert_called_once_with("dummy.dem")
        # Verify db was queried
        mock_db.get.assert_called_once()
        # Verify write_to_db was called
        mock_write_to_db.assert_called_once()


@pytest.mark.asyncio
async def test_scout_no_recon_validation_fails():
    """Verify that when is_recon is False, the uploader Steam ID check is NOT bypassed and fails if uploader is missing from stats."""

    mock_result = {
        "metadata": {"map": "de_mirage", "total_rounds": 10},
        "kills": [],
        "grenades": [],
        "trajectories": [],
        "player_stats": {"76561198000000000": {"name": "Other Player"}},
    }

    mock_match_obj = MagicMock()
    mock_match_obj.match_id = "test-normal-match"
    mock_match_obj.user_id = "test-user-id"
    mock_match_obj.uploader_steam_id = "76561198999999999"  # Not in player_stats
    mock_match_obj.is_recon = False

    mock_db = MagicMock()
    mock_db.get.return_value = mock_match_obj

    with (
        patch("services.scout.service.LOCAL_MODE", True),
        patch("parse_demo.parse_demo", return_value=mock_result),
        patch("parse_demo.write_to_db"),
        patch("services.scout.service._trigger_coaching"),
        patch("services.scout.service._mark_failed"),
        patch("db.database.SessionLocal", return_value=mock_db),
    ):
        req = ParseRequest(match_id="test-normal-match", dem_path="dummy.dem")

        # Since uploader_steam_id is not in player_stats, this should raise HTTPException / fail
        with pytest.raises(HTTPException) as excinfo:
            await parse_match(req)

        assert excinfo.value.status_code == 500
        assert "was not found in this CS2 match" in str(excinfo.value.detail)
