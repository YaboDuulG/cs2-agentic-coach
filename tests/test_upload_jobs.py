"""
Tests for the presign upload and job status endpoints.
These run in CI without GCP credentials (LOCAL_MODE=true stub paths are tested).
"""

import os

from fastapi.testclient import TestClient

# Force LOCAL_MODE so no GCP calls are made in CI
os.environ["LOCAL_MODE"] = "true"

from api.main import app  # noqa: E402

client = TestClient(app)


class TestPresignEndpoint:
    def test_presign_missing_body(self):
        """Presign with no body should return 422."""
        response = client.post("/api/upload/presign")
        assert response.status_code == 422

    def test_presign_wrong_extension(self):
        """Presign for a non-.dem file should return 400."""
        response = client.post(
            "/api/upload/presign",
            json={"filename": "match.mp4", "size_bytes": 1024},
        )
        assert response.status_code == 400
        assert "dem" in response.json()["detail"].lower()

    def test_presign_valid_dem_local_mode(self):
        """Presign for a valid .dem file in LOCAL_MODE should return stub URL."""
        response = client.post(
            "/api/upload/presign",
            json={"filename": "match.dem", "size_bytes": 1024 * 1024 * 200},
        )
        assert response.status_code == 200
        data = response.json()
        assert "match_id" in data
        assert "upload_url" in data
        assert data["local_mode"] is True

    def test_presign_file_too_large(self):
        """Presign for a file over 2GB should return 413."""
        response = client.post(
            "/api/upload/presign",
            json={"filename": "huge.dem", "size_bytes": 3 * 1024 * 1024 * 1024},
        )
        assert response.status_code == 413


class TestJobStatusEndpoint:
    def test_job_status_local_mode(self):
        """Job status in LOCAL_MODE should return stub done response."""
        response = client.get("/api/jobs/test-match-12345")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "done"
        assert data["match_id"] == "test-match-12345"
        assert "total_rounds" in data
        assert "kills" in data

    def test_job_status_has_expected_fields(self):
        """Job status response should include all fields the frontend expects."""
        response = client.get("/api/jobs/any-match-id")
        assert response.status_code == 200
        data = response.json()
        required_fields = ["status", "match_id", "total_rounds", "total_kills", "kills", "rounds"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    def test_job_status_nan_sanitization(self):
        """Test that NaN values in database results are recursively sanitized to None and headshot is mapped."""
        from unittest.mock import MagicMock, patch

        with patch("api.routes.jobs._get_db") as mock_get_db, patch.dict(os.environ, {"LOCAL_MODE": "false"}):
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db

            # Setup fetch results
            mock_result_match = ("test-match-nan", "de_dust2", "done", None, '{"player1": {"adr": NaN, "kills": 10}}')

            mock_result_kills = [
                ("attacker1", "victim1", "weapon_ak47", 1, "CT", float('nan'), 20.0, 30.0, float('nan'), "steam1", "steam2", 100, True)
            ]

            mock_result_rounds = [
                (1, "CT", 4000, 3500)
            ]

            # Chain the execute returns
            mock_exec = mock_db.execute.return_value
            mock_exec.fetchone.return_value = mock_result_match
            mock_exec.fetchall.side_effect = [mock_result_kills, mock_result_rounds]

            response = client.get("/api/jobs/test-match-nan")
            assert response.status_code == 200
            data = response.json()

            # Check fields
            assert data["status"] == "done"
            assert data["player_stats"]["player1"]["adr"] is None
            assert data["player_stats"]["player1"]["kills"] == 10

            # Check kills list and coordinates sanitization
            assert len(data["kills"]) == 1
            kill = data["kills"][0]
            assert kill["killer"] == "attacker1"
            assert kill["attacker_x"] is None
            assert kill["attacker_y"] == 20.0
            assert kill["victim_x"] == 30.0  # float('nan') was at victim_y, victim_x is 30.0
            assert kill["victim_y"] is None
            assert kill["tick"] == 100
            assert kill["headshot"] is True

