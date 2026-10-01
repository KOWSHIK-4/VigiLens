"""Outbound address guard applied to camera sources before they are opened.

``/capture`` hands a caller-supplied source to ``cv2.VideoCapture``. Without a
check on the destination, a source aimed at loopback or the cloud metadata
endpoint makes this worker a proxy for addresses the caller cannot reach.
"""

import socket

import pytest

from app import ssrf
from app.services import capture as capture_service


class _FakeCap:
    def set(self, prop, value):
        return True

    def isOpened(self):
        return True

    def read(self):
        return False, None

    def release(self):
        pass


@pytest.mark.parametrize(
    "source",
    [
        "rtsp://127.0.0.1:8554/live",
        "http://127.0.0.1:5432/",
        "rtsp://localhost:554/stream",
        "http://LOCALHOST/admin",
        "http://169.254.169.254/latest/meta-data/",
        "rtsp://169.254.169.254/latest/meta-data/",
        "http://[::1]:8080/",
        "http://[fd00:ec2::254]/latest/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://instance-data/latest/meta-data/",
        "http://[fe80::1]/",
        "file:///etc/passwd",
        "gopher://127.0.0.1:11211/",
    ],
)
def test_blocks_destinations_that_can_never_be_a_camera(source):
    with pytest.raises(ValueError):
        ssrf.assert_source_allowed(source)


@pytest.mark.parametrize(
    "source",
    [
        # RFC1918 space is where on-prem cameras actually live.
        "rtsp://10.0.0.42:554/live",
        "http://192.168.1.100/",
        "http://172.16.4.9/cgi-bin/stream",
        "https://cam.example.com/live",
        "rtsps://cam.example.com:322/live",
    ],
)
def test_permits_private_and_public_camera_destinations(source):
    ssrf.assert_source_allowed(source)


def test_permits_a_local_path_source():
    """Device and file sources are not network destinations."""
    for source in ("/dev/video0", "0", "/data/media/clip.mp4", "clip.mp4"):
        ssrf.assert_source_allowed(source)


def test_blocks_a_hostname_that_resolves_to_loopback(monkeypatch):
    """The literal-IP check alone is bypassed by using a hostname."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port or 80))]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(ValueError):
        ssrf.assert_source_allowed("http://rebind.attacker.test/")


def test_allows_an_unresolvable_host_so_capture_reports_the_real_error(monkeypatch):
    """A DNS fault must surface as a capture failure, not a guard rejection."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        raise socket.gaierror("temporary failure in name resolution")

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", fake_getaddrinfo)

    ssrf.assert_source_allowed("http://cam.internal.test/live")


def test_is_network_source_classifies_each_camera_type():
    assert ssrf.is_network_source("rtsp", "rtsp://cam.test/live") is True
    assert ssrf.is_network_source("ip", "http://cam.test/live") is True
    assert ssrf.is_network_source("usb", "/dev/video0") is False
    assert ssrf.is_network_source("video_file", "/data/clip.mp4") is False


class _RecordingVideoCapture:
    """Stands in for cv2.VideoCapture and records constructor calls."""

    def __init__(self):
        self.calls = []

    def __call__(self, source, api=None, params=None):
        self.calls.append({"source": source, "api": api, "params": params})
        return _FakeCap()


def test_open_capture_refuses_a_blocked_source_before_opening_any_socket(monkeypatch):
    recorder = _RecordingVideoCapture()
    monkeypatch.setattr(capture_service.cv2, "VideoCapture", recorder)

    with pytest.raises(capture_service.CaptureError):
        capture_service.open_capture("rtsp://127.0.0.1:8554/live", "rtsp", 1234)

    assert recorder.calls == []


def test_open_capture_still_allows_local_device_sources(monkeypatch):
    recorder = _RecordingVideoCapture()
    monkeypatch.setattr(capture_service.cv2, "VideoCapture", recorder)

    capture_service.open_capture("/dev/video0", "usb", 1234)

    assert len(recorder.calls) == 1