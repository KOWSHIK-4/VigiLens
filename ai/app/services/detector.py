import logging
from pathlib import Path
from typing import List

import cv2
import numpy as np

from app.detectors.base import BaseDetector, Detection

logger = logging.getLogger(__name__)


class DetectorService:
    def __init__(self):
        self._detectors: dict[str, BaseDetector] = {}

    def register(self, detector: BaseDetector) -> None:
        self._detectors[detector.name] = detector
        logger.info("Registered detector: %s", detector.name)

    def get(self, name: str | None = None) -> BaseDetector:
        if name is None:
            name = "person_detector"
        if name not in self._detectors:
            raise KeyError(f"Detector '{name}' not registered. Available: {list(self._detectors.keys())}")
        return self._detectors[name]

    def detect_image(self, image_data: bytes, detector_name: str | None = None) -> tuple[List[Detection], np.ndarray]:
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode image data")
        detector = self.get(detector_name)
        detections = detector.detect(image)
        return detections, image

    def detect_video_frames(self, video_path: str, detector_name: str | None = None) -> tuple[list, str]:
        detector = self.get(detector_name)

        cap = cv2.VideoCapture(video_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")

        out_dir = Path(__file__).resolve().parent.parent / "output"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(out_dir / f"processed_{Path(video_path).stem}.mp4")
        writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))

        all_detections: list[list[dict]] = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            detections = detector.detect(frame)
            annotated = detector.draw(frame, detections)
            writer.write(annotated)
            all_detections.append(
                [{"class_name": d.class_name, "confidence": d.confidence, "bbox": list(d.bbox)} for d in detections]
            )

        cap.release()
        writer.release()
        return all_detections, out_path


detector_service = DetectorService()

from app.detectors import PersonDetector
detector_service.register(PersonDetector())
