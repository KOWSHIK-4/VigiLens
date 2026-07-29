from typing import List
import numpy as np
import cv2
from ultralytics import YOLO

from app.detectors.base import BaseDetector, Detection


class PersonDetector(BaseDetector):

    MODEL_NAME = "yolo11n.pt"
    PERSON_CLASS_ID = 0
    CONFIDENCE_THRESHOLD = 0.5

    def __init__(self):
        self._model = YOLO(self.MODEL_NAME)

    @property
    def name(self) -> str:
        return "person_detector"

    def detect(self, image: np.ndarray) -> List[Detection]:
        results = self._model(image, verbose=False, conf=self.CONFIDENCE_THRESHOLD)[0]
        detections: list[Detection] = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            if cls_id != self.PERSON_CLASS_ID:
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            detections.append(
                Detection(
                    class_name="person",
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
