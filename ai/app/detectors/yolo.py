from typing import List, Optional

import cv2
import numpy as np
from ultralytics import YOLO

from app.detectors.base import BaseDetector, Detection

# COCO class id -> name for the YOLOv11 model.
COCO_NAMES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    4: "airplane",
    5: "bus",
    6: "train",
    7: "truck",
    8: "boat",
}


class YoloDetector(BaseDetector):
    """YOLO detector backed by a real model, optionally filtered to a
    set of COCO classes. Enables true inference for person and vehicle."""

    def __init__(
        self,
        detector_name: str,
        model_name: str = "yolo11n.pt",
        class_filter: Optional[List[int]] = None,
        class_names: Optional[dict] = None,
        confidence_threshold: float = 0.5,
    ):
        self._detector_name = detector_name
        self._model = YOLO(model_name)
        self._class_filter = class_filter
        self._class_names = class_names or COCO_NAMES
        self._conf_threshold = confidence_threshold

    @property
    def name(self) -> str:
        return self._detector_name

    def detect(
        self,
        image: np.ndarray,
        confidence_threshold: float | None = None,
    ) -> List[Detection]:
        conf = confidence_threshold if confidence_threshold is not None else self._conf_threshold
        results = self._model(image, verbose=False, conf=conf)[0]
        detections: list[Detection] = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            if self._class_filter is not None and cls_id not in self._class_filter:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(
                Detection(
                    class_name=self._class_names.get(cls_id, str(cls_id)),
                    confidence=round(conf, 4),
                    bbox=(x1, y1, x2, y2),
                )
            )
        return detections

    def draw(self, image: np.ndarray, detections: List[Detection]) -> np.ndarray:
        annotated = image.copy()
        for d in detections:
            x1, y1, x2, y2 = d.bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
            label = f"{d.class_name} {d.confidence:.2f}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw + 4, y1), (0, 255, 0), -1)
            cv2.putText(annotated, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
        return annotated
