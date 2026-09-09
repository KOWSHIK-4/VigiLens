"""Inference management hardening tests.

Covers inference timeouts, retries, model availability, invalid inputs,
and the enhanced health endpoint model status reporting.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.detectors.yolo import DetectorStatus, InferenceError, YoloDetector
from app.main import app
from app.services.detector import detector_service

client = TestClient(app)


class _CountingFakeModel:
    """Records how many inference attempts happened."""

    def __init__(self, counter, failure_count=0, error=None):
        self.counter = counter
        self.failure_count = failure_count
        self.error = error

    def __call__(self, image, verbose=False, conf=0.5):
        self.counter["attempts"] += 1
        if self.counter["attempts"] <= self.failure_count:
            raise self.error or RuntimeError("model inference exploded")
        return [_FakeResults()]


class _FakeResults:
    def __init__(self, box_count=1):
        self.boxes = _FakeBoxes(box_count)


class _FakeBoxes:
    def __init__(self, count=1):
        self._count = count

    def __iter__(self):
        for _ in range(self._count):
            yield _FakeBox()


class _FakeBox:
    def __init__(self):
        self.cls = np.array([0.0])
        self.conf = np.array([0.95])
        self.xyxy = np.array([[10, 20, 110, 220]], dtype=np.float32)


def test_detector_reports_status_fields():
    """The DetectorStatus dataclass exposes the runtime state fields."""
    status = DetectorStatus(name="person_detector", model_loaded=True)
    assert status.model_loaded is True
    assert status.total_inferences == 0
    assert status.consecutive_failures == 0
    assert status.last_inference_at is None


def test_empty_image_raises_invalid_input(monkeypatch):
    """Empty images must be rejected as invalid input, not passed to the model."""
    counter = {"attempts": 0}

    def fake_model(image, verbose=False, conf=0.5):
        counter["attempts"] += 1
        return _FakeResults(0)

    detector = YoloDetector.__new__(YoloDetector)
    detector._detector_name = "test_detector"
    detector._class_filter = None
    detector._class_names = {0: "person"}
    detector._conf_threshold = 0.5
    detector._inference_timeout_s = 5.0
    detector._max_retries = 1
    detector._infer_lock = __import__("threading").Lock()
    detector._model = fake_model
    detector._model_name = "fake.pt"
    detector._status = DetectorStatus(name="test_detector", model_loaded=True)

    with pytest.raises(InferenceError) as exc_info:
        detector.detect(np.array([], dtype=np.uint8))
    assert exc_info.value.reason == "invalid_input"
    assert counter["attempts"] == 0


def test_retries_transient_inference_failures(monkeypatch):
    """Transient failures are retried up to max_retries with backoff."""
    counter = {"attempts": 0}
    detector = YoloDetector.__new__(YoloDetector)
    detector._detector_name = "test_detector"
    detector._class_filter = None
    detector._class_names = {0: "person"}
    detector._conf_threshold = 0.5
    detector._inference_timeout_s = 5.0
    detector._max_retries = 3
    detector._infer_lock = __import__("threading").Lock()
    detector._model = _CountingFakeModel(counter, failure_count=2)
    detector._model_name = "fake.pt"
    detector._status = DetectorStatus(name="test_detector", model_loaded=True)

    monkeypatch.setattr("app.detectors.yolo.time.sleep", lambda s: None)

    image = np.zeros((64, 64, 3), dtype=np.uint8)
    detections = detector.detect(image, confidence_threshold=0.5)
    assert counter["attempts"] == 3  # 2 failures + 1 success
    assert len(detections) == 1
    assert detector.status.consecutive_failures == 0
    assert detector.status.total_failures == 2
    assert detector.status.total_inferences == 1


def test_gives_up_after_exhausting_retries(monkeypatch):
    """Persistent failures raise InferenceError after all retries."""
    counter = {"attempts": 0}
    detector = YoloDetector.__new__(YoloDetector)
    detector._detector_name = "test_detector"
    detector._class_filter = None
    detector._class_names = {0: "person"}
    detector._conf_threshold = 0.5
    detector._inference_timeout_s = 5.0
    detector._max_retries = 2
    detector._infer_lock = __import__("threading").Lock()
    detector._model = _CountingFakeModel(counter, failure_count=99)
    detector._model_name = "fake.pt"
    detector._status = DetectorStatus(name="test_detector", model_loaded=True)

    monkeypatch.setattr("app.detectors.yolo.time.sleep", lambda s: None)

    image = np.zeros((64, 64, 3), dtype=np.uint8)
    with pytest.raises(InferenceError) as exc_info:
        detector.detect(image)
    assert exc_info.value.reason == "inference_error"
    assert counter["attempts"] == 2
    assert detector.status.consecutive_failures == 2


def test_model_unavailable_rejected_before_inference():
    """A detector without a loaded model raises model_unavailable."""
    detector = YoloDetector.__new__(YoloDetector)
    detector._detector_name = "test_detector"
    detector._class_filter = None
    detector._class_names = {0: "person"}
    detector._conf_threshold = 0.5
    detector._inference_timeout_s = 5.0
    detector._max_retries = 1
    detector._infer_lock = __import__("threading").Lock()
    detector._model = None
    detector._model_name = "missing.pt"
    detector._status = DetectorStatus(name="test_detector", model_loaded=False)

    image = np.zeros((64, 64, 3), dtype=np.uint8)
    with pytest.raises(InferenceError) as exc_info:
        detector.detect(image)
    assert exc_info.value.reason == "model_unavailable"


def test_detector_list_includes_model_status():
    """The detector catalog now reports model_loaded and status fields."""
    detectors = detector_service.list()
    person = next(
        (d for d in detectors if d["key"] == "person_detector"), None
    )
    assert person is not None
    assert "model_loaded" in person
    assert "total_inferences" in person
    assert "consecutive_failures" in person


def test_detect_image_rejects_empty_file():
    """An empty upload must be rejected before inference."""
    response = client.post(
        "/detect/image",
        files={"file": ("img.jpg", b"", "image/jpeg")},
    )
    assert response.status_code == 400


def test_detect_image_rejects_undecodable_image(monkeypatch):
    """Corrupt image bytes must fail with a clear 400, not a 500."""
    response = client.post(
        "/detect/image",
        params={"detector": "person_detector"},
        files={"file": ("img.jpg", b"this-is-not-a-jpeg", "image/jpeg")},
    )
    assert response.status_code == 400
    assert "Could not decode" in response.json()["detail"]


def test_health_reports_detector_status():
    """The health endpoint must report detector model status."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "vigilens-ai"
    assert "detectors" in body
    assert body["detectors"]["detector_count"] == 2
    keys = set(body["detectors"]["detectors"].keys())
    assert "person_detector" in keys
    assert "vehicle_detector" in keys