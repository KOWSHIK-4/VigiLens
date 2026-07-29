import logging
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from app.config import settings
from app.models.base import BaseDetectionModel

logger = logging.getLogger(__name__)


class YOLOModel(BaseDetectionModel):
    def __init__(self, model_name: str = "yolo11n.pt"):
        self._model_name = model_name
        self._model: YOLO | None = None

    @property
    def name(self) -> str:
        return self._model_name

    def load(self) -> None:
        model_path = Path(settings.model_path) / self._model_name
        if not model_path.exists():
            logger.info("Downloading model %s...", self._model_name)
            self._model = YOLO(self._model_name)
            Path(settings.model_path).mkdir(parents=True, exist_ok=True)
            self._model.export(format="onnx")
        else:
            logger.info("Loading model from %s", model_path)
            self._model = YOLO(str(model_path))

        logger.info("Model %s loaded successfully", self._model_name)

    def predict(self, image: np.ndarray) -> list[dict]:
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        results = self._model(image, conf=settings.confidence_threshold)
        detections = []

        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue

            for i in range(len(boxes)):
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                confidence = float(boxes.conf[i])
                class_id = int(boxes.cls[i])
                label = result.names[class_id]

                detections.append({
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "confidence": round(confidence, 4),
                    "label": label,
                    "class_id": class_id,
                })

        return detections

    def predict_video(self, video_path: str, frame_skip: int = 5) -> list[dict]:
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        cap = cv2.VideoCapture(video_path)
        all_detections = []
        frame_count = 0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            if frame_count % frame_skip == 0:
                frame_detections = self.predict(frame)
                for det in frame_detections:
                    det["frame"] = frame_count
                    all_detections.append(det)

            frame_count += 1

        cap.release()
        return all_detections
