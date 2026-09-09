import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from threading import Lock
from typing import List, Optional

import cv2
import numpy as np
from ultralytics import YOLO

from app.detectors.base import BaseDetector, Detection

logger = logging.getLogger(__name__)

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

DEFAULT_INFERENCE_TIMEOUT_S = 30.0
DEFAULT_MAX_RETRIES = 2
RETRY_BACKOFF_BASE_S = 0.5


class InferenceError(Exception):
    """Raised when model inference fails after all retries are exhausted."""

    def __init__(self, message: str, reason: str, attempts: int = 1):
        super().__init__(message)
        self.reason = reason
        self.attempts = attempts


@dataclass
class DetectorStatus:
    """Runtime status of a registered detector."""
    name: str
    model_loaded: bool
    last_inference_at: float | None = None
    last_inference_duration_ms: float | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    total_inferences: int = 0
    total_failures: int = 0


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
        inference_timeout_s: float = DEFAULT_INFERENCE_TIMEOUT_S,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ):
        self._detector_name = detector_name
        self._class_filter = class_filter
        self._class_names = class_names or COCO_NAMES
        self._conf_threshold = confidence_threshold
        self._inference_timeout_s = inference_timeout_s
        self._max_retries = max_retries
        # Detector instances are shared across request threads (image
        # uploads, video jobs and live streams); ultralytics models are not
        # thread-safe, so inference is serialized.
        self._infer_lock = Lock()
        self._status = DetectorStatus(
            name=detector_name,
            model_loaded=False,
        )
        self._model = None
        self._model_name = model_name
        self._load_model()

    def _load_model(self) -> None:
        """Load the YOLO model, tracking success/failure in status."""
        try:
            self._model = YOLO(self._model_name)
            self._status.model_loaded = True
            logger.info("Model loaded: %s (%s)", self._detector_name, self._model_name)
        except Exception as exc:
            self._status.model_loaded = False
            self._status.last_error = str(exc)
            logger.error("Failed to load model %s: %s", self._model_name, exc)

    @property
    def name(self) -> str:
        return self._detector_name

    @property
    def status(self) -> DetectorStatus:
        return self._status

    def _run_inference(self, image: np.ndarray, conf: float) -> List[Detection]:
        """Run YOLO inference with timeout protection.

        Executes model inference in a thread pool with a hard timeout to
        prevent a stalled model from blocking the server indefinitely.
        """
        if self._model is None:
            raise InferenceError(
                f"Model not loaded for detector '{self._detector_name}'",
                reason="model_unavailable",
            )

        def _infer() -> List[Detection]:
            with self._infer_lock:
                results = self._model(image, verbose=False, conf=conf)[0]
            detections: list[Detection] = []
            for box in results.boxes:
                cls_id = int(box.cls[0])
                if self._class_filter is not None and cls_id not in self._class_filter:
                    continue
                box_conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                detections.append(
                    Detection(
                        class_name=self._class_names.get(cls_id, str(cls_id)),
                        confidence=round(box_conf, 4),
                        bbox=(x1, y1, x2, y2),
                    )
                )
            return detections

        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(_infer)
            return future.result(timeout=self._inference_timeout_s)
        except FuturesTimeoutError:
            raise InferenceError(
                f"Inference timed out after {self._inference_timeout_s}s "
                f"for detector '{self._detector_name}'",
                reason="timeout",
            )
        except InferenceError:
            raise
        except Exception as exc:
            raise InferenceError(
                f"Inference failed for detector '{self._detector_name}': {exc}",
                reason="inference_error",
            )
        finally:
            executor.shutdown(wait=False)

    def detect(
        self,
        image: np.ndarray,
        confidence_threshold: float | None = None,
    ) -> List[Detection]:
        conf = confidence_threshold if confidence_threshold is not None else self._conf_threshold

        if image is None or image.size == 0:
            raise InferenceError(
                "Empty or None image passed to detector",
                reason="invalid_input",
            )

        last_exc: InferenceError | None = None
        for attempt in range(1, self._max_retries + 1):
            started = time.monotonic()
            try:
                detections = self._run_inference(image, conf)
                duration_ms = (time.monotonic() - started) * 1000
                self._status.last_inference_at = time.time()
                self._status.last_inference_duration_ms = round(duration_ms, 2)
                self._status.consecutive_failures = 0
                self._status.total_inferences += 1
                return detections
            except InferenceError as exc:
                last_exc = exc
                self._status.total_failures += 1
                self._status.consecutive_failures += 1
                self._status.last_error = f"{exc.reason}: {exc}"
                if attempt < self._max_retries:
                    backoff = RETRY_BACKOFF_BASE_S * (2 ** (attempt - 1))
                    logger.warning(
                        "Inference attempt %d/%d failed for %s (%s), retrying in %.1fs",
                        attempt, self._max_retries, self._detector_name,
                        exc.reason, backoff,
                    )
                    time.sleep(backoff)
                else:
                    logger.error(
                        "Inference failed after %d attempts for %s: %s",
                        self._max_retries, self._detector_name, exc,
                    )
        assert last_exc is not None
        raise last_exc

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
