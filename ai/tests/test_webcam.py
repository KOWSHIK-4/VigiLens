"""Tests for the live webcam stream helpers.

No real camera is needed: we exercise the pure helpers (device
resolution, detector key mapping) and the per-stream stats registry.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.routes.detection import (
    backend_detector_key,
    resolve_ai_detector_name,
    resolve_webcam_device,
)
from app.services.stats import StreamStatsRegistry, stream_stats

client = TestClient(app)


def test_resolve_ai_detector_name_maps_backend_keys():
    assert resolve_ai_detector_name("person") == "person_detector"
    assert resolve_ai_detector_name("vehicle") == "vehicle_detector"
    assert resolve_ai_detector_name("person_detector") == "person_detector"
    assert resolve_ai_detector_name("custom") == "custom"


def test_backend_detector_key_reverse_maps():
    assert backend_detector_key("person_detector") == "person"
    assert backend_detector_key("vehicle_detector") == "vehicle"
    assert backend_detector_key("custom") == "custom"


def test_resolve_webcam_device():
    assert resolve_webcam_device("0") == 0
    assert resolve_webcam_device("video2") == 2
    assert resolve_webcam_device("/dev/video7") == 7
    assert resolve_webcam_device("") == 0
    assert resolve_webcam_device("not-a-device") == "not-a-device"


def test_stream_stats_are_isolated_per_stream():
    registry = StreamStatsRegistry()
    registry.update("cam-a", "person", {"fps": 12.0, "objects": 3})
    registry.update("cam-b", "vehicle", {"fps": 8.0, "objects": 1})

    a = registry.get("cam-a", "person")
    b = registry.get("cam-b", "vehicle")

    assert a["objects"] == 3
    assert b["objects"] == 1
    assert a["fps"] == 12.0


def test_stream_stats_fall_back_to_most_recent():
    registry = StreamStatsRegistry()
    registry.update("cam-a", "person", {"fps": 10.0})
    registry.update("cam-b", "vehicle", {"fps": 20.0})

    assert registry.get()["fps"] == 20.0
    assert registry.get("cam-a", "person")["fps"] == 10.0
    assert registry.get("cam-x", "person") == {}


def test_webcam_stats_endpoint_returns_most_recent_stream():
    stream_stats.clear()
    stream_stats.update("cam-1", "person", {"fps": 15.0, "objects": 2, "confidence": 0.8})
    stream_stats.update("cam-2", "vehicle", {"fps": 5.0, "objects": 0, "confidence": 0.0})

    response = client.get("/detect/webcam/stats")
    assert response.status_code == 200
    assert response.json()["fps"] == 5.0


def test_webcam_stats_endpoint_scoped_by_stream():
    stream_stats.clear()
    stream_stats.update("cam-1", "person", {"fps": 15.0, "objects": 2})

    response = client.get(
        "/detect/webcam/stats",
        params={"camera_id": "cam-1", "detector": "person"},
    )
    assert response.status_code == 200
    assert response.json()["objects"] == 2


def test_webcam_stats_rejects_missing_internal_key_when_auth_required(monkeypatch):
    monkeypatch.setenv("AI_STATS_REQUIRE_AUTH", "true")
    stream_stats.clear()
    response = client.get("/detect/webcam/stats")
    assert response.status_code == 401


def test_webcam_stats_accepts_valid_internal_key_when_auth_required(monkeypatch):
    monkeypatch.setenv("AI_STATS_REQUIRE_AUTH", "true")
    stream_stats.clear()
    stream_stats.update("cam-1", "person", {"fps": 10.0, "objects": 1})
    response = client.get(
        "/detect/webcam/stats",
        headers={"X-Internal-Key": "dev-internal-key-change-in-production"},
    )
    assert response.status_code == 200


def test_webcam_route_rejects_unknown_detector():
    response = client.get("/detect/webcam", params={"detector": "does_not_exist"})
    assert response.status_code == 404
