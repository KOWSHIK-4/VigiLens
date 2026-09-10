"""Processor scheduling hint tests.

The backend forwards its stored ``preferred_processor`` value as a
``processor`` query parameter on /detect/image, /detect/video and
/detect/webcam. These tests cover validation of that parameter and the
device resolution that translates it into a torch device selection.
"""

import types

import numpy as np
from app.detectors.yolo import PROCESSOR_HINTS, resolve_device
from app.main import app
from app.services import detector as detector_module
from fastapi.testclient import TestClient

client = TestClient(app)


def test_processor_hints_enum():
    assert PROCESSOR_HINTS == {"auto", "cpu", "gpu"}


def test_resolve_device_cpu_forced():
    assert resolve_device("cpu") == "cpu"


def test_resolve_device_auto_and_none_let_ultralytics_decide():
    assert resolve_device("auto") is None
    assert resolve_device(None) is None


def test_resolve_device_gpu_falls_back_to_cpu_without_cuda(monkeypatch):
    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setattr("app.detectors.yolo._torch", fake_torch)
    assert resolve_device("gpu") == "cpu"


def test_resolve_device_gpu_falls_back_to_cpu_when_torch_missing(monkeypatch):
    monkeypatch.setattr("app.detectors.yolo._torch", None)
    assert resolve_device("gpu") == "cpu"


def test_resolve_device_gpu_uses_cuda_when_available(monkeypatch):
    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setattr("app.detectors.yolo._torch", fake_torch)
    assert resolve_device("gpu") == "cuda:0"


def test_detect_image_rejects_unknown_processor():
    response = client.post(
        "/detect/image",
        params={"processor": "tpu"},
        files={"file": ("img.jpg", b"fake", "image/jpeg")},
    )
    assert response.status_code == 422


def test_detect_video_rejects_unknown_processor():
    response = client.post(
        "/detect/video",
        params={"processor": "tpu"},
        files={"file": ("v.mp4", b"data", "video/mp4")},
    )
    assert response.status_code == 422


def test_webcam_rejects_unknown_processor():
    response = client.get("/detect/webcam", params={"processor": "tpu"})
    assert response.status_code == 422


def test_detect_image_forwards_processor_hint(monkeypatch):
    captured: dict = {}

    def fake_detect_image(image_data, detector_name=None, confidence_threshold=None, processor=None):
        captured["processor"] = processor
        return [], np.zeros((10, 10, 3), dtype=np.uint8)

    monkeypatch.setattr(detector_module.detector_service, "detect_image", fake_detect_image)

    response = client.post(
        "/detect/image",
        params={"processor": "gpu"},
        files={"file": ("img.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200
    assert captured["processor"] == "gpu"


def test_detect_image_defaults_processor_to_none(monkeypatch):
    captured: dict = {}

    def fake_detect_image(image_data, detector_name=None, confidence_threshold=None, processor=None):
        captured["processor"] = processor
        return [], np.zeros((10, 10, 3), dtype=np.uint8)

    monkeypatch.setattr(detector_module.detector_service, "detect_image", fake_detect_image)

    response = client.post(
        "/detect/image",
        files={"file": ("img.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200
    assert captured["processor"] is None