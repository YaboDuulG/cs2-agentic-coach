"""
Smoke tests for the FastAPI application.
These run in CI without any GCP credentials or cloud services.
"""

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_root_endpoint():
    """Root endpoint should return 200 with service info."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "DemoSage API"
    assert data["version"] == "0.1.0"
    assert "status" in data


def test_health_check():
    """Health endpoint should return 200."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_check():
    """Readiness endpoint should return 200."""
    response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_upload_demo_no_file():
    """Upload demo without a file should return 422."""
    response = client.post("/api/upload/demo")
    assert response.status_code == 422


def test_upload_demo_wrong_extension():
    """Upload demo with wrong extension should return 400."""
    response = client.post(
        "/api/upload/demo",
        files={"file": ("match.mp4", b"fake content", "video/mp4")},
    )
    assert response.status_code == 400
    assert "dem" in response.json()["detail"].lower()


def test_upload_audio_no_match_id():
    """Audio upload without match_id should return 400."""
    response = client.post(
        "/api/upload/audio",
        files={"file": ("comms.mp3", b"fake audio", "audio/mpeg")},
        data={"match_id": ""},
    )
    assert response.status_code == 400
    assert "match_id" in response.json()["detail"].lower()


def test_upload_audio_wrong_extension():
    """Audio upload with wrong extension should return 400."""
    response = client.post(
        "/api/upload/audio",
        files={"file": ("comms.avi", b"fake content", "video/avi")},
        data={"match_id": "test-match-001"},
    )
    assert response.status_code == 400
