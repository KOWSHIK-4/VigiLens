"""Tests for resolving a camera's configured capture source.

The live stream must open the feed the operator configured rather than
guessing a local device, so these cover the backend lookup, its guards and the
fallback to the legacy ``?device=`` selector.
"""

import httpx

from app.routes.detection import _resolve_stream_source
from app.services.camera_source import (
    ResolvedSource,
    _looks_like_camera_id,
    resolve_camera_source,
)

CAMERA_ID = "1fb60624-4288-42dd-ac8f-9e650ce8a21e"


def _stub_backend(monkeypatch, response=None, error=None):
    """Replace httpx.get with a recording stub for the backend lookup."""
    calls: list[str] = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        if error is not None:
            raise error
        return response

    monkeypatch.setattr(httpx, "get", fake_get)
    return calls


class _Response:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_camera_id_shape_guard_skips_device_selectors():
    assert _looks_like_camera_id(CAMERA_ID) is True
    # Legacy selectors must never be sent to the backend as camera ids.
    assert _looks_like_camera_id("default") is False
    assert _looks_like_camera_id("0") is False
    assert _looks_like_camera_id("/dev/video0") is False
    assert _looks_like_camera_id("") is False
    assert _looks_like_camera_id("not-a-uuid") is False


def test_resolve_camera_source_reads_configured_url(monkeypatch):
    calls = _stub_backend(
        monkeypatch,
        response=_Response(
            payload={
                "data": {
                    "cameraId": CAMERA_ID,
                    "url": "/recordings/demo.mp4",
                    "cameraType": "video_file",
                }
            }
        ),
    )

    resolved = resolve_camera_source(CAMERA_ID)

    assert resolved is not None
    assert resolved.source == "/recordings/demo.mp4"
    assert resolved.camera_type == "video_file"
    # A file source must be flagged so the stream rewinds at EOF instead of
    # treating end-of-file as a dropped connection.
    assert resolved.is_file is True
    assert f"/api/cameras/internal/{CAMERA_ID}/stream-source" in calls[0]


def test_resolve_camera_source_marks_network_sources_as_not_files(monkeypatch):
    _stub_backend(
        monkeypatch,
        response=_Response(
            payload={"data": {"url": "rtsp://cam/stream", "cameraType": "rtsp"}}
        ),
    )

    resolved = resolve_camera_source(CAMERA_ID)

    assert resolved is not None
    assert resolved.is_file is False


def test_resolve_camera_source_merges_feed_credentials(monkeypatch):
    _stub_backend(
        monkeypatch,
        response=_Response(
            payload={
                "data": {
                    "url": "rtsp://cam/stream",
                    "cameraType": "rtsp",
                    "username": "operator",
                    "password": "s3cret",
                }
            }
        ),
    )

    resolved = resolve_camera_source(CAMERA_ID)

    assert resolved is not None
    # OpenCV authenticates network feeds through URL userinfo.
    assert resolved.source == "rtsp://operator:s3cret@cam/stream"


def test_resolve_camera_source_ignores_device_selector_ids(monkeypatch):
    calls = _stub_backend(monkeypatch, response=_Response(payload={}))

    assert resolve_camera_source("default") is None
    assert calls == []


def test_resolve_camera_source_returns_none_on_unknown_camera(monkeypatch):
    _stub_backend(monkeypatch, response=_Response(status_code=404, payload={}))
    assert resolve_camera_source(CAMERA_ID) is None


def test_resolve_camera_source_returns_none_on_backend_error(monkeypatch):
    _stub_backend(
        monkeypatch, error=httpx.ConnectError("backend down")
    )
    # A backend outage must not break streaming; the caller falls back.
    assert resolve_camera_source(CAMERA_ID) is None


def test_resolve_camera_source_rejects_unsupported_camera_type(monkeypatch):
    _stub_backend(
        monkeypatch,
        response=_Response(
            payload={"data": {"url": "rtsp://cam", "cameraType": "satellite"}}
        ),
    )
    assert resolve_camera_source(CAMERA_ID) is None


def test_resolve_stream_source_prefers_the_selected_camera(monkeypatch):
    seen: list[str] = []

    def fake_resolve(camera_id):
        seen.append(camera_id)
        return ResolvedSource("/recordings/demo.mp4", "video_file", True)

    monkeypatch.setattr("app.routes.detection.resolve_camera_source", fake_resolve)

    resolved = _resolve_stream_source(CAMERA_ID, "0")

    # The configured feed wins over the legacy device selector.
    assert resolved.source == "/recordings/demo.mp4"
    assert resolved.camera_type == "video_file"
    assert resolved.is_file is True
    assert seen == [CAMERA_ID]


def test_resolve_stream_source_falls_back_to_legacy_device(monkeypatch):
    monkeypatch.setattr(
        "app.routes.detection.resolve_camera_source",
        lambda _id: None,
    )

    resolved = _resolve_stream_source("default", "2")

    # Direct webcam streaming keeps working when there is no camera to resolve.
    assert resolved.source == 2
    assert resolved.camera_type == "usb"
    assert resolved.is_file is False