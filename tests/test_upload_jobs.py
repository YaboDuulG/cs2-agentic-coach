"""
Tests for the presign upload and job status endpoints.
These run in CI without GCP credentials (LOCAL_MODE=true stub paths are tested).
"""

import os

import pytest
from fastapi.testclient import TestClient

# Force LOCAL_MODE so no GCP calls are made
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
