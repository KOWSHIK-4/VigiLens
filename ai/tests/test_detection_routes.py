from fastapi.testclient import TestClient

from app.config import DEFAULT_INTERNAL_KEY
from app.main import app

client = TestClient(app)


def test_detectors_catalog_endpoint():
    response = client.get("/detect/detectors")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["count"] == 2


def test_detect_image_rejects_non_image_files():
    response = client.post(
        "/detect/image",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 400


def test_detectors_requires_internal_key_when_auth_forced(monkeypatch):
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    response = client.get("/detect/detectors")
    assert response.status_code == 401


def test_detectors_accepts_internal_key_when_auth_forced(monkeypatch):
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    response = client.get(
        "/detect/detectors",
        headers={"X-Internal-Key": "dev-internal-key-change-in-production"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_detectors_rejects_incorrect_internal_key_when_auth_forced(monkeypatch):
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    response = client.get(
        "/detect/detectors",
        headers={"X-Internal-Key": "wrong-key"},
    )
    assert response.status_code == 401


def test_detectors_legacy_alias_still_forces_auth(monkeypatch):
    # Backward-compatible alias for the canonical AI_REQUIRE_AUTH.
    monkeypatch.setenv("AI_STATS_REQUIRE_AUTH", "true")
    response = client.get("/detect/detectors")
    assert response.status_code == 401


def test_detectors_canonical_flag_takes_precedence_over_alias_absence(monkeypatch):
    # A deployment using only the canonical flag must be protected even when
    # the legacy alias is absent.
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    monkeypatch.delenv("AI_STATS_REQUIRE_AUTH", raising=False)
    response = client.get("/detect/detectors")
    assert response.status_code == 401


def test_detect_image_requires_internal_key_when_auth_forced(monkeypatch):
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    response = client.post(
        "/detect/image",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 401


def test_detectors_guarded_in_production_even_with_default_key(monkeypatch):
    # Production always requires the header, even when the shared secret is
    # unchanged from the bundled development default.
    monkeypatch.delenv("AI_REQUIRE_AUTH", raising=False)
    monkeypatch.delenv("AI_STATS_REQUIRE_AUTH", raising=False)
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setattr("app.config.settings.backend_internal_key", DEFAULT_INTERNAL_KEY)

    response = client.get("/detect/detectors")
    assert response.status_code == 401

    accepted = client.get(
        "/detect/detectors",
        headers={"X-Internal-Key": DEFAULT_INTERNAL_KEY},
    )
    assert accepted.status_code == 200
