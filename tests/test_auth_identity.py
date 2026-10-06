"""api/auth.py: the proxy (shared secret) may speak for any user; a Clerk token
may only speak for its own subject, whatever identity the request also
carries in the header, the query string or the body."""

from datetime import UTC, datetime, timedelta
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt
import pytest

from api.auth import INTERNAL_SERVICE_USER, authenticate, get_current_user

SECRET = "shared-secret-for-tests"


@pytest.fixture(scope="module")
def keys():
    """An RSA keypair standing in for Clerk's."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private_pem, public_pem


@pytest.fixture()
def app(monkeypatch, keys):
    """A tiny app whose only route echoes who the caller resolved to."""
    monkeypatch.setenv("API_SHARED_SECRET", SECRET)
    monkeypatch.setenv("CLERK_PEM_PUBLIC_KEY", keys[1])
    api = FastAPI()

    @api.post("/whoami")
    async def whoami(user: str = Depends(get_current_user)):
        return {"user": user}

    @api.get("/whoami")
    async def whoami_get(user: str = Depends(get_current_user)):
        return {"user": user}

    return TestClient(api)


def token(private_pem: str, sub: str = "user_alice", **claims) -> str:
    """Docstring for token."""
    now = datetime.now(UTC)
    payload = {"sub": sub, "iat": now, "exp": now + timedelta(minutes=5), **claims}
    return jwt.encode(payload, private_pem, algorithm="RS256")


def bearer(value: str) -> dict:
    """Docstring for bearer."""
    return {"Authorization": f"Bearer {value}"}


class TestServicePrincipal:
    """Docstring for TestServicePrincipal."""

    def test_shared_secret_is_the_service_and_may_name_anyone(self, app):
        """Docstring for test_shared_secret_is_the_service_and_may_name_anyone."""
        r = app.post("/whoami", headers={**bearer(SECRET), "x-clerk-user-id": "user_bob"}, json={"user_id": "user_carol"})
        assert r.status_code == 200 and r.json()["user"] == INTERNAL_SERVICE_USER

    def test_wrong_secret_is_not_the_service(self, app):
        """Docstring for test_wrong_secret_is_not_the_service."""
        assert app.get("/whoami", headers=bearer("not-the-secret")).status_code == 401

    def test_secret_works_without_a_clerk_key(self, app, monkeypatch):
        """The production posture: proxies only, no JWT path."""
        monkeypatch.delenv("CLERK_PEM_PUBLIC_KEY")
        assert app.get("/whoami", headers=bearer(SECRET)).json()["user"] == INTERNAL_SERVICE_USER
        assert app.get("/whoami", headers=bearer("garbage")).status_code == 401

    def test_nothing_configured_is_a_server_error(self, app, monkeypatch):
        """Docstring for test_nothing_configured_is_a_server_error."""
        monkeypatch.delenv("CLERK_PEM_PUBLIC_KEY")
        monkeypatch.delenv("API_SHARED_SECRET")
        assert app.get("/whoami", headers=bearer("anything")).status_code == 500


class TestUserPrincipal:
    """Docstring for TestUserPrincipal."""

    def test_token_resolves_to_its_subject(self, app, keys):
        """Docstring for test_token_resolves_to_its_subject."""
        r = app.get("/whoami", headers=bearer(token(keys[0])))
        assert r.status_code == 200 and r.json()["user"] == "user_alice"

    def test_may_name_itself_everywhere(self, app, keys):
        """Docstring for test_may_name_itself_everywhere."""
        r = app.post(
            "/whoami?user_id=user_alice",
            headers={**bearer(token(keys[0])), "x-clerk-user-id": "user_alice"},
            json={"user_id": "user_alice"},
        )
        assert r.status_code == 200 and r.json()["user"] == "user_alice"

    @pytest.mark.parametrize(
        "where",
        ["header", "query", "body"],
    )
    def test_may_not_name_another_user(self, app, keys, where):
        """The impersonation the review called out: a signed-in user naming
        someone else in the identity header, query or body."""
        headers = bearer(token(keys[0]))
        url, body = "/whoami", None
        if where == "header":
            headers["x-clerk-user-id"] = "user_bob"
        elif where == "query":
            url = "/whoami?user_id=user_bob"
        else:
            body = {"user_id": "user_bob"}
        r = app.post(url, headers=headers, json=body)
        assert r.status_code == 403
        assert "other than" in r.json()["detail"]

    def test_body_that_is_not_json_is_ignored(self, app, keys):
        """Docstring for test_body_that_is_not_json_is_ignored."""
        r = app.post("/whoami", headers={**bearer(token(keys[0])), "content-type": "application/json"}, content=b"not json")
        assert r.status_code == 200

    def test_expired_token_is_401(self, app, keys):
        """Docstring for test_expired_token_is_401."""
        old = datetime.now(UTC) - timedelta(hours=2)
        expired = jwt.encode({"sub": "user_alice", "iat": old, "exp": old + timedelta(minutes=1)}, keys[0], algorithm="RS256")
        r = app.get("/whoami", headers=bearer(expired))
        assert r.status_code == 401 and r.json()["detail"] == "Token expired"

    def test_token_from_another_key_is_401(self, app, keys):
        """Docstring for test_token_from_another_key_is_401."""
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        other_pem = other.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        assert app.get("/whoami", headers=bearer(token(other_pem))).status_code == 401

    def test_token_without_subject_is_401(self, app, keys):
        """Docstring for test_token_without_subject_is_401."""
        now = datetime.now(UTC)
        t = jwt.encode({"iat": now, "exp": now + timedelta(minutes=5)}, keys[0], algorithm="RS256")
        assert app.get("/whoami", headers=bearer(t)).status_code == 401


def test_authenticate_prefers_the_secret_in_constant_time(monkeypatch, keys):
    """Docstring for test_authenticate_prefers_the_secret_in_constant_time."""
    from fastapi.security import HTTPAuthorizationCredentials

    monkeypatch.setenv("API_SHARED_SECRET", SECRET)
    monkeypatch.setenv("CLERK_PEM_PUBLIC_KEY", keys[1])
    assert authenticate(HTTPAuthorizationCredentials(scheme="Bearer", credentials=SECRET)).kind == "service"
    p = authenticate(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token(keys[0], sub="user_z")))
    assert (p.kind, p.user_id) == ("user", "user_z")
    assert os.getenv("API_SHARED_SECRET") == SECRET
