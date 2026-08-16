import logging
import os
import threading
import time
import uuid
from pathlib import Path

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.detector import detector_service
from app.services.tracker import IouTracker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/detect", tags=["detection"])

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"


# --- Shared webcam stats (single-user) ---
_webcam_stats: dict = {}
_stats_lock = threading.Lock()


def _update_stats(
    fps: float,
    persons: int,
    confidence: float,
    total_persons: int,
    image_width: int = 0,
    image_height: int = 0,
) -> None:
    with _stats_lock:
        _webcam_stats.update(
            fps=round(fps, 1),
            persons=persons,
            confidence=round(confidence, 4),
            total_persons=total_persons,
            image_width=image_width,
            image_height=image_height,
        )


class _FPSCounter:
    def __init__(self):
        self._start = time.perf_counter()
        self._count = 0
        self._fps = 0.0

    def update(self) -> float:
        self._count += 1
        elapsed = time.perf_counter() - self._start
        if elapsed >= 1.0:
            self._fps = self._count / elapsed
            self._count = 0
            self._start = time.perf_counter()
        return self._fps


def _draw_overlay(
    image: np.ndarray,
    fps: float,
    person_count: int,
    max_conf: float,
) -> None:
    overlay = image.copy()
    cv2.rectangle(overlay, (0, 0), (260, 105), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.4, image, 0.6, 0, image)
    cv2.putText(image, f"FPS: {fps:.1f}", (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)
    cv2.putText(image, f"Persons: {person_count}", (10, 52),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)
    if max_conf > 0:
        cv2.putText(image, f"Conf: {max_conf:.0%}", (10, 76),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)

    cv2.putText(image, "VigiLens Live", (10, 98),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)


@router.post("/image")
async def detect_image(
    file: UploadFile = File(...),
    detector: str | None = None,
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        image_data = await file.read()
        detections, image = detector_service.detect_image(image_data, detector)

        dets_json = [
            {
                "class_name": d.class_name,
                "confidence": d.confidence,
                "bbox": {"x1": d.bbox[0], "y1": d.bbox[1], "x2": d.bbox[2], "y2": d.bbox[3]},
            }
            for d in detections
        ]

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = str(OUTPUT_DIR / f"{uuid.uuid4().hex}.jpg")
        detector_obj = detector_service.get(detector)
        annotated = detector_obj.draw(image, detections)
        cv2.imwrite(out_path, annotated)

        h, w = image.shape[:2]
        return {
            "success": True,
            "detections": dets_json,
            "count": len(detections),
            "output_path": out_path,
            "image_width": int(w),
            "image_height": int(h),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.exception("Image detection failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/video")
async def detect_video(
    file: UploadFile = File(...),
    detector: str | None = None,
):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video")

    suffix = Path(file.filename).suffix or ".mp4"
    tmp_path = str(OUTPUT_DIR / f"in_{uuid.uuid4().hex}{suffix}")

    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        all_detections, out_path = detector_service.detect_video_frames(tmp_path, detector)

        return {
            "success": True,
            "frames": all_detections,
            "output_path": out_path,
            "filename": file.filename,
        }
    except Exception as e:
        logger.exception("Video detection failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/detectors")
async def list_detectors():
    """Catalog of registered inference models in this service."""
    return {"success": True, "detectors": detector_service.list(), "count": len(detector_service.list())}


@router.get("/webcam/stats")
async def webcam_stats():
    return _webcam_stats


@router.get("/webcam")
async def detect_webcam(
    camera_id: str = "default",
    snapshot_enabled: bool = True,
):
    def save_detection(
        cam_id: str,
        detections: list,
        image_path: str,
    ) -> None:
        try:
            headers = {}
            if settings.backend_internal_key:
                headers["X-Internal-Key"] = settings.backend_internal_key
            with httpx.Client(timeout=3.0, headers=headers) as client:
                for det in detections:
                    client.post(
                        f"{settings.backend_url}/api/detections/internal",
                        json={
                            "camera_id": cam_id,
                            "label": det["class_name"],
                            "confidence": det["confidence"],
                            "image_url": image_path,
                            "detector_key": "person",
                            "class_name": det["class_name"],
                            "track_id": det.get("track_id"),
                            "bounding_box": det["bbox"],
                            "metadata": {
                                "detector_type": "person_detector",
                                "source": "webcam",
                            },
                        },
                    )
        except Exception:
            logger.debug("Failed to save detection to backend", exc_info=True)

    def generate():
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            logger.error("Could not open webcam")
            return

        person_detector = detector_service.get("person_detector")
        tracker = IouTracker()
        fps_counter = _FPSCounter()
        frame_no = 0
        total_persons = 0
        snapshot_interval = 30
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_no += 1
                detections = person_detector.detect(frame)
                tracked = tracker.update(
                    [
                        {
                            "class_name": d.class_name,
                            "confidence": d.confidence,
                            "bbox": {
                                "x1": int(d.bbox[0]),
                                "y1": int(d.bbox[1]),
                                "x2": int(d.bbox[2]),
                                "y2": int(d.bbox[3]),
                            },
                        }
                        for d in detections
                    ]
                )
                annotated = person_detector.draw(frame, detections)

                fps = fps_counter.update()
                person_count = len(tracked)
                total_persons += person_count
                max_conf = max((d["confidence"] for d in tracked), default=0.0)
                image_height, image_width = frame.shape[:2]

                _update_stats(fps, person_count, max_conf, total_persons, image_width, image_height)
                _draw_overlay(annotated, fps, person_count, max_conf)

                if tracked and frame_no % snapshot_interval == 0:
                    image_path = ""
                    if snapshot_enabled:
                        snapshot_name = f"webcam_{int(time.time())}_{frame_no}.jpg"
                        image_path = str(OUTPUT_DIR / snapshot_name)
                        cv2.imwrite(image_path, annotated)

                    threading.Thread(
                        target=save_detection,
                        args=(camera_id, tracked, image_path),
                        daemon=True,
                    ).start()

                _, buffer = cv2.imencode(".jpg", annotated)
                yield (
                    b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                    + buffer.tobytes()
                    + b"\r\n"
                )
        finally:
            cap.release()

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
