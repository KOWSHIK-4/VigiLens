"""Robustness of DetectorService.detect_video_frames."""

import numpy as np
import cv2
import pytest

from app.detectors.base import BaseDetector, Detection
from app.services.detector import DetectorService


class _StubDetector(BaseDetector):
    @property
    def name(self) -> str:
        return "stub_detector"

    def detect(self, image, confidence_threshold=None):
        h, w = image.shape[:2]
        return [Detection(class_name="thing", confidence=0.9, bbox=(1, 1, w - 1, h - 1))]

    def draw(self, image, detections):
        return image


def _write_test_video(path, frames=6, size=(64, 48), fps=12.0):
    w, h = size
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    assert writer.isOpened(), "test video writer could not open"
    for i in range(frames):
        frame = np.full((h, w, 3), (i * 20) % 255, dtype=np.uint8)
        writer.write(frame)
    writer.release()


@pytest.fixture()
def service():
    svc = DetectorService()
    svc.register(_StubDetector())
    return svc


def test_detect_video_frames_processes_all_frames(service, tmp_path):
    video = tmp_path / "clip.mp4"
    _write_test_video(video)

    detections, out_path = service.detect_video_frames(str(video), "stub_detector")

    assert len(detections) == 6
    assert all(d[0]["class_name"] == "thing" for d in detections)


def test_detect_video_frames_output_name_is_unique_per_run(service, tmp_path):
    video = tmp_path / "clip.mp4"
    _write_test_video(video)

    _, first = service.detect_video_frames(str(video), "stub_detector")
    _, second = service.detect_video_frames(str(video), "stub_detector")

    assert first != second


def test_detect_video_frames_rejects_unopenable_video(service, tmp_path):
    missing = tmp_path / "does-not-exist.mp4"
    with pytest.raises(ValueError):
        service.detect_video_frames(str(missing), "stub_detector")
