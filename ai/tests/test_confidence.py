"""Tests for detector-specific confidence thresholds at inference time.

Covers the `confidence` query parameter on /detect/image, /detect/video
and /detect/webcam: out-of-range values are rejected by validation, the
default is preserved, and the override is passed down to the detector.
"""

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import detector as detector_module

client = TestClient(app)


def test_detect_image_rejects_out_of_range_confidence():
    response = client.post(
        "/detect/image",
        params={"confidence": 1.5},
        files={"file": ("img.jpg", b"fake", "image/jpeg")},
    )
    assert response.status_code == 422


def test_detect_video_rejects_out_of_range_confidence():
    response = client.post(
        "/detect/video",
        params={"confidence": 0.0},
        files={"file": ("v.mp4", b"data", "video/mp4")},
    )
    assert response.status_code == 422


def test_webcam_rejects_out_of_range_confidence():
    response = client.get("/detect/webcam", params={"confidence": 2.0})
    assert response.status_code == 422


def test_detect_image_passes_confidence_override(monkeypatch):
    captured: dict = {}

    def fake_detect_image(image_data, detector_name=None, confidence_threshold=None):
        captured["detector"] = detector_name
        captured["confidence"] = confidence_threshold
        return [], np.zeros((10, 10, 3), dtype=np.uint8)

    monkeypatch.setattr(detector_module.detector_service, "detect_image", fake_detect_image)

    response = client.post(
        "/detect/image",
        params={"confidence": 0.7},
        files={"file": ("img.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200
    assert captured["confidence"] == 0.7


def test_detect_image_defaults_confidence(monkeypatch):
    captured: dict = {}

    def fake_detect_image(image_data, detector_name=None, confidence_threshold=None):
        captured["confidence"] = confidence_threshold
        return [], np.zeros((10, 10, 3), dtype=np.uint8)

    monkeypatch.setattr(detector_module.detector_service, "detect_image", fake_detect_image)

    response = client.post(
        "/detect/image",
        files={"file": ("img.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200
    assert captured["confidence"] == 0.5


def test_detect_image_passes_detector_name_with_override(monkeypatch):
    captured: dict = {}

    def fake_detect_image(image_data, detector_name=None, confidence_threshold=None):
        captured["detector"] = detector_name
        captured["confidence"] = confidence_threshold
        return [], np.zeros((10, 10, 3), dtype=np.uint8)

    monkeypatch.setattr(detector_module.detector_service, "detect_image", fake_detect_image)

    response = client.post(
        "/detect/image",
        params={"detector": "vehicle_detector", "confidence": 0.85},
        files={"file": ("img.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200
    assert captured["detector"] == "vehicle_detector"
    assert captured["confidence"] == 0.85
