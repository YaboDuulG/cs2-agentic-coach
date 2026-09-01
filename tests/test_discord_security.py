"""
Discord security primitives: Ed25519 interaction signatures (real keypair,
generated in-test) and the HMAC bind-code roundtrip.
"""

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import pytest

from services.discord_bot.security import make_bind_code, verify_bind_code, verify_signature

TIMESTAMP = "1725148800"
BODY = b'{"type":1}'


@pytest.fixture()
def keypair():
    """Docstring for keypair."""
    private = Ed25519PrivateKey.generate()
    public_hex = private.public_key().public_bytes_raw().hex()
    return private, public_hex


class TestVerifySignature:
    """Docstring for TestVerifySignature."""

    def test_valid_signature_passes(self, keypair):
        """Docstring for test_valid_signature_passes."""
        private, public_hex = keypair
        signature = private.sign(TIMESTAMP.encode() + BODY).hex()
        assert verify_signature(public_hex, signature, TIMESTAMP, BODY) is True

    def test_tampered_body_rejected(self, keypair):
        """Docstring for test_tampered_body_rejected."""
        private, public_hex = keypair
        signature = private.sign(TIMESTAMP.encode() + BODY).hex()
        assert verify_signature(public_hex, signature, TIMESTAMP, b'{"type":2}') is False

    def test_tampered_timestamp_rejected(self, keypair):
        """Docstring for test_tampered_timestamp_rejected."""
        private, public_hex = keypair
        signature = private.sign(TIMESTAMP.encode() + BODY).hex()
        assert verify_signature(public_hex, signature, "1725148801", BODY) is False

    def test_wrong_key_rejected(self, keypair):
        """Docstring for test_wrong_key_rejected."""
        private, _ = keypair
        other_public_hex = Ed25519PrivateKey.generate().public_key().public_bytes_raw().hex()
        signature = private.sign(TIMESTAMP.encode() + BODY).hex()
        assert verify_signature(other_public_hex, signature, TIMESTAMP, BODY) is False

    def test_garbage_hex_rejected(self, keypair):
        """Docstring for test_garbage_hex_rejected."""
        _, public_hex = keypair
        assert verify_signature(public_hex, "not-hex-at-all", TIMESTAMP, BODY) is False
        assert verify_signature("zz", "aa" * 64, TIMESTAMP, BODY) is False


class TestBindCodes:
    """Docstring for TestBindCodes."""

    def test_roundtrip(self, monkeypatch):
        """Docstring for test_roundtrip."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
        code = make_bind_code("team-abc-123")
        assert code.startswith("team-abc-123.")
        assert verify_bind_code(code) == "team-abc-123"

    def test_tampered_team_id_rejected(self, monkeypatch):
        """Docstring for test_tampered_team_id_rejected."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
        code = make_bind_code("team-abc-123")
        mac = code.rpartition(".")[2]
        assert verify_bind_code(f"team-evil-999.{mac}") is None

    def test_tampered_mac_rejected(self, monkeypatch):
        """Docstring for test_tampered_mac_rejected."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
        code = make_bind_code("team-abc-123")
        flipped = code[:-1] + ("0" if code[-1] != "0" else "1")
        assert verify_bind_code(flipped) is None

    def test_malformed_code_rejected(self, monkeypatch):
        """Docstring for test_malformed_code_rejected."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
        assert verify_bind_code("no-separator") is None
        assert verify_bind_code("") is None
        assert verify_bind_code(".deadbeef0123") is None

    def test_different_secret_rejected(self, monkeypatch):
        """Docstring for test_different_secret_rejected."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "secret-one")
        code = make_bind_code("team-abc-123")
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "secret-two")
        assert verify_bind_code(code) is None

    def test_unset_secret_fails_closed(self, monkeypatch):
        """Docstring for test_unset_secret_fails_closed."""
        monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
        code = make_bind_code("team-abc-123")
        monkeypatch.delenv("DISCORD_WEBHOOK_SECRET")
        assert verify_bind_code(code) is None
        with pytest.raises(ValueError):
            make_bind_code("team-abc-123")
