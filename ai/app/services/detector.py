import logging
import uuid
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

    def list(self) -> list[dict]:
        return [
            {
                "key": name,
                "name": detector.__class__.__name__,
                "type": "object_detection",
                "availability": "available",
            }
            for name, detector in self._detectors.items()
        ]

    def detect_image(
        self,
        image_data: bytes,
        detector_name: str | None = None,
        confidence_threshold: float | None = None,
    ) -> tuple[List[Detection], np.ndarray]:
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode image data")
        detector = self.get(detector_name)
        detections = detector.detect(image, confidence_threshold=confidence_threshold)
        return detections, image

    def detect_video_frames(
        self,
        video_path: str,
        detector_name: str | None = None,
        confidence_threshold: float | None = None,
    ) -> tuple[list, str]:
        detector = self.get(detector_name)

        cap = cv2.VideoCapture(video_path)
        try:
            if not cap.isOpened():
                raise ValueError(f"Could not open video '{video_path}'")

            fps = cap.get(cv2.CAP_PROP_FPS)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            # Streams and some containers report zero metadata; fall back to
            # sane defaults instead of handing VideoWriter a 0x0 frame size
            # (which silently produces an empty output file).
            fps = int(fps) if fps and fps > 0 else 25
            if w <= 0 or h <= 0:
                w, h = 640, 480

            fourcc = cv2.VideoWriter_fourcc(*"mp4v")

            out_dir = Path(__file__).resolve().parent.parent / "output"
            out_dir.mkdir(parents=True, exist_ok=True)
            # Unique name per run: two uploads of same-named videos must not
            # overwrite each other's annotated output.
            out_path = str(out_dir / f"processed_{Path(video_path).stem}_{uuid.uuid4().hex[:8]}.mp4")
            writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))
            if not writer.isOpened():
                raise ValueError(f"Could not open output writer at '{out_path}'")

            all_detections: list[list[dict]] = []
            try:
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    detections = detector.detect(frame, confidence_threshold=confidence_threshold)
                    annotated = detector.draw(frame, detections)
                    writer.write(annotated)
                    all_detections.append(
                        [
                            {"class_name": d.class_name, "confidence": d.confidence, "bbox": list(d.bbox)}
                            for d in detections
                        ]
                    )
            finally:
                writer.release()
            return all_detections, out_path
        finally:
            cap.release()


detector_service = DetectorService()

# Imported at the bottom of the module on purpose: registering the
# detector instances below requires the subclasses, which import this
# module's singletons — importing at the top would create a cycle.
from app.detectors import PersonDetector  # noqa: E402
from app.detectors.yolo import YoloDetector  # noqa: E402

detector_service.register(PersonDetector())
# Vehicle detection uses the same YOLO COCO model, filtered to
# motorized road vehicles (car=2, motorcycle=3, bus=5, truck=7).
detector_service.register(
    YoloDetector(
        detector_name="vehicle_detector",
        class_filter=[2, 3, 5, 7],
    )
)
