import pytest

from api.auth import verify_shared_secret
from api.main import app


@pytest.fixture(autouse=True)
def override_auth_dependency():
    """Automatically bypass shared secret authentication during pytest runs."""
    app.dependency_overrides[verify_shared_secret] = lambda: "test-secret"
    yield
    app.dependency_overrides.clear()
