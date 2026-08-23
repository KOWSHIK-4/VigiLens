"""Timeout handling and open behavior of the capture service."""

import cv2

from app.services import capture as capture_service


class _FakeCap:
    def __init__(self):
        self.props = {}

    def set(self, prop, value):
        self.props[prop] = value
        return True

    def isOpened(self):
        return True

    def read(self):
        return False, None

    def release(self):
        pass


class _RecordingVideoCapture:
    """Stands in for cv2.VideoCapture and records constructor calls."""

    CAP_FFMPEG = cv2.CAP_FFMPEG
    CAP_PROP_OPEN_TIMEOUT_MSEC = cv2.CAP_PROP_OPEN_TIMEOUT_MSEC
    CAP_PROP_READ_TIMEOUT_MSEC = cv2.CAP_PROP_READ_TIMEOUT_MSEC

    def __init__(self):
        self.calls = []

    def __call__(self, source, api=None, params=None):
        cap = _FakeCap()
        self.calls.append({"source": source, "api": api, "params": params, "cap": cap})
        return cap


def test_open_capture_network_applies_timeouts_at_construction(monkeypatch):
    recorder = _RecordingVideoCapture()
    monkeypatch.setattr(capture_service.cv2, "VideoCapture", recorder)

    capture_service.open_capture("rtsp://example.test/live", "rtsp", 1234)

    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["source"] == "rtsp://example.test/live"
    assert call["api"] == cv2.CAP_FFMPEG
    assert call["params"] == [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
        1234,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC,
        1234,
    ]


def test_open_capture_local_source_opens_without_construction_params(monkeypatch):
    recorder = _RecordingVideoCapture()
    monkeypatch.setattr(capture_service.cv2, "VideoCapture", recorder)

    capture_service.open_capture("/dev/video0", "usb", 1234)

    call = recorder.calls[0]
    assert call["params"] is None
    # Local opens are fast; the timeouts are applied to the opened capture.
    assert call["cap"].props[cv2.CAP_PROP_OPEN_TIMEOUT_MSEC] == 1234
    assert call["cap"].props[cv2.CAP_PROP_READ_TIMEOUT_MSEC] == 1234


def test_open_capture_zero_timeout_skips_network_params(monkeypatch):
    recorder = _RecordingVideoCapture()
    monkeypatch.setattr(capture_service.cv2, "VideoCapture", recorder)

    capture_service.open_capture("rtsp://example.test/live", "rtsp", 0)

    assert recorder.calls[0]["params"] is None
