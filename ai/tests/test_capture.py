import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import capture as capture_service

client = TestClient(app)


class FakeCapture:
    def __init__(self, opened=True, frame=None):
        self.opened = opened
        self.frame = frame
        self.released = False
        self.pos_ms = 0

    def isOpened(self):
        return self.opened

    def set(self, prop, value):
        if prop == 3:  # CAP_PROP_POS_MSEC
            self.pos_ms = value
        return True

    def read(self):
        if self.frame is None:
            return False, None
        return True, self.frame

    def release(self):
        self.released = True


@pytest.fixture(autouse=True)
def _no_real_cameras(monkeypatch):
    def fail_open(source, camera_type, timeout_ms):
        return FakeCapture(opened=False)

    monkeypatch.setattr(capture_service, "open_capture", fail_open)


def test_usb_device_index_parsing():
    assert capture_service.usb_device_index("0") == 0
    assert capture_service.usb_device_index("/dev/video0") == 0
    assert capture_service.usb_device_index("/dev/video7") == 7
    assert capture_service.usb_device_index("not-a-device") is None


def test_resolve_video_path(tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    video = media / "demo.mp4"
    video.write_bytes(b"data")

    assert capture_service.resolve_video_path(str(video)) == str(video)
    assert capture_service.resolve_video_path("demo.mp4", str(media)) == str(video)
    assert capture_service.resolve_video_path("missing.mp4", str(media)) == "missing.mp4"


def test_capture_route_requires_source():
    response = client.get("/capture")
    assert response.status_code == 422


def test_capture_route_rejects_unknown_type():
    response = client.get("/capture", params={"source": "x", "type": "bogus"})
    assert response.status_code == 400


def test_capture_route_returns_502_when_source_cannot_open():
    response = client.get("/capture", params={"source": "/dev/video0", "type": "usb"})
    assert response.status_code == 502
    assert "Cannot open" in response.json()["detail"]


def test_capture_route_returns_jpeg(monkeypatch):
    frame = np.zeros((16, 16, 3), dtype=np.uint8)

    def good_open(source, camera_type, timeout_ms):
        return FakeCapture(opened=True, frame=frame)

    monkeypatch.setattr(capture_service, "open_capture", good_open)

    response = client.get(
        "/capture",
        params={"source": "rtsp://example.test/live", "type": "rtsp"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8")
