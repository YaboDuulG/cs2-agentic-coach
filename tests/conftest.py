"""Module docstring."""
import pytest

from api.auth import get_current_user
from api.main import app


@pytest.fixture(autouse=True)
def override_auth_dependency():
    """Automatically bypass shared secret authentication during pytest runs."""
    app.dependency_overrides[get_current_user] = lambda: "test-user-id"
    yield
    app.dependency_overrides.clear()
