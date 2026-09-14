from fastapi.testclient import TestClient

from app.main import app
from app.services.detector import detector_service

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "vigilens-ai"
    assert body["version"] == "1.0.0"
    assert body["uptime"] >= 0


def test_health_live_returns_ok():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "vigilens-ai"}


def test_health_ready_ok_when_models_loaded(monkeypatch):
    monkeypatch.setattr(
        detector_service,
        "status_summary",
        lambda: {
            "detector_count": 2,
            "detectors": {
                "person_detector": {"model_loaded": True, "consecutive_failures": 0},
                "vehicle_detector": {"model_loaded": True, "consecutive_failures": 0},
            }
        },
    )
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["status"] == "ok"


def test_health_ready_503_when_detector_failing(monkeypatch):
    monkeypatch.setattr(
        detector_service,
        "status_summary",
        lambda: {
            "detector_count": 2,
            "detectors": {
                "person_detector": {"model_loaded": True, "consecutive_failures": 3},
                "vehicle_detector": {"model_loaded": True, "consecutive_failures": 0},
            }
        },
    )
    response = client.get("/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["ready"] is False
    assert body["status"] == "degraded"


def test_health_ready_503_when_models_not_loaded(monkeypatch):
    monkeypatch.setattr(
        detector_service,
        "status_summary",
        lambda: {
            "detector_count": 2,
            "detectors": {
                "person_detector": {"model_loaded": False, "consecutive_failures": 0},
                "vehicle_detector": {"model_loaded": True, "consecutive_failures": 0},
            }
        },
    )
    assert client.get("/health/ready").status_code == 503


def test_health_probes_are_open_beyond_internal_key(monkeypatch):
    # Health probes are deliberately unauthenticated so infrastructure can
    # always reach them; the machine-to-machine guard must not apply here.
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code in (200, 503)
    assert client.get("/health").status_code == 200
