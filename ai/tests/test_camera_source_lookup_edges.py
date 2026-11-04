"""Fallback and malformed-response tests for camera source lookup."""

import httpx

from app.services.camera_source import resolve_camera_source

CAMERA_ID = "1fb60624-4288-42dd-ac8f-9e650ce8a21e"


class Response:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


def test_missing_backend_url_skips_lookup(monkeypatch):
    def unexpected_get(*args, **kwargs):
        raise AssertionError("HTTP lookup should not run without backend URL")

    monkeypatch.setattr("app.services.camera_source.settings.backend_url", "")
    monkeypatch.setattr(httpx, "get", unexpected_get)

    assert resolve_camera_source(CAMERA_ID) is None


def test_empty_data_payload_returns_none(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: Response({"data": None}),
    )

    assert resolve_camera_source(CAMERA_ID) is None


def test_malformed_json_response_falls_back(monkeypatch):
    class InvalidJsonResponse:
        status_code = 200

        def json(self):
            raise ValueError("invalid JSON")

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: InvalidJsonResponse(),
    )

    assert resolve_camera_source(CAMERA_ID) is None


def test_lookup_sends_internal_key_header_when_configured(monkeypatch):
    captured = {}

    def fake_get(url, headers=None, timeout=None):
        captured["headers"] = headers
        return Response({"data": {"url": "/media/demo.mp4", "cameraType": "video_file"}})

    monkeypatch.setattr("app.services.camera_source.settings.backend_url", "http://backend/")
    monkeypatch.setattr("app.services.camera_source.settings.backend_internal_key", "test-internal-key")
    monkeypatch.setattr(httpx, "get", fake_get)

    resolved = resolve_camera_source(CAMERA_ID)

    assert resolved is not None
    assert captured["headers"]["X-Internal-Key"] == "test-internal-key"
