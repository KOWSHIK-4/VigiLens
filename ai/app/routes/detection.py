import logging
import os
import threading
import time
import uuid
from pathlib import Path

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.capture import usb_device_index
from app.services.detector import detector_service
from app.services.stats import stream_stats
from app.services.tracker import IouTracker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/detect", tags=["detection"])

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

# Keep at most this many annotated snapshots on disk to prevent unbounded
# storage growth during long-running live streams.
_MAX_OUTPUT_FILES = 500


def _prune_output_dir() -> None:
    """Remove oldest files in OUTPUT_DIR when the count exceeds the cap."""
    try:
        if not OUTPUT_DIR.exists():
            return
        files = sorted(OUTPUT_DIR.iterdir(), key=lambda f: f.stat().st_mtime)
        if len(files) <= _MAX_OUTPUT_FILES:
            return
        for stale in files[: len(files) - _MAX_OUTPUT_FILES]:
            try:
                stale.unlink()
            except OSError:
                pass
    except Exception:
        logger.debug("Output pruning failed", exc_info=True)

# Backend detector keys map to the AI service's registered model names.
BACKEND_DETECTOR_MAP = {
    "person": "person_detector",
    "vehicle": "vehicle_detector",
}


def resolve_ai_detector_name(detector: str) -> str:
    """Translate a backend detector key to an AI service detector name."""
    return BACKEND_DETECTOR_MAP.get(detector, detector)


def backend_detector_key(ai_detector_name: str) -> str:
    """Reverse map an AI detector name back to the backend detector key."""
    for key, name in BACKEND_DETECTOR_MAP.items():
        if name == ai_detector_name:
            return key
    return ai_detector_name


def resolve_webcam_device(device: str) -> int | str:
    """Resolve a webcam device selector to an OpenCV-friendly value.

    ``0``, ``video0`` and ``/dev/video0`` become the device index 0;
    any other value is passed to OpenCV as-is (e.g. a platform path).
    """
    value = (device or "0").strip()
    if not value:
        return 0
    if value.isdigit():
        return int(value)
    index = usb_device_index(value)
    if index is not None:
        return index
    return value


def _open_webcam(device: int | str) -> cv2.VideoCapture:
    """Open a webcam device, falling back to the default backend."""
    if isinstance(device, int):
        cap = cv2.VideoCapture(device, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(device)
    else:
        cap = cv2.VideoCapture(device)
    return cap


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
    cv2.putText(image, f"Objects: {person_count}", (10, 52),
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
    confidence: float = Query(0.5, ge=0.01, le=1.0, description="Confidence floor (0..1)"),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        image_data = await file.read()
        detections, image = detector_service.detect_image(image_data, detector, confidence)

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
        _prune_output_dir()

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
    confidence: float = Query(0.5, ge=0.01, le=1.0, description="Confidence floor (0..1)"),
):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video")

    suffix = Path(file.filename).suffix or ".mp4"
    tmp_path = str(OUTPUT_DIR / f"in_{uuid.uuid4().hex}{suffix}")

    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        all_detections, out_path = detector_service.detect_video_frames(tmp_path, detector, confidence)

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
async def webcam_stats(
    request: Request,
    camera_id: str | None = Query(None, description="Stream camera id"),
    detector: str | None = Query(None, description="Stream detector key"),
):
    """Live stats for a stream, or the most recent stream when unspecified."""
    _verify_internal_key(request)
    return stream_stats.get(camera_id, detector)


MAX_CONSECUTIVE_READ_FAILURES = 10
RECONNECT_ATTEMPTS = 3
RECONNECT_DELAY_SECONDS = 1.0


def _verify_internal_key(request: Request) -> None:
    """Verify the X-Internal-Key header matches the shared secret.

    In production the check is always enforced. In development it can be
    disabled by setting AI_STATS_REQUIRE_AUTH=false.
    """
    required = settings.backend_internal_key
    if not required:
        return
    node_env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development"))
    if node_env != "production":
        if os.getenv("AI_STATS_REQUIRE_AUTH", "").lower() not in ("1", "true"):
            return
    provided = request.headers.get("x-internal-key", "")
    if provided != required:
        raise HTTPException(status_code=401, detail="Invalid or missing internal key")


@router.get("/webcam")
async def detect_webcam(
    request: Request,
    camera_id: str = "default",
    detector: str = "person",
    device: str = "0",
    snapshot_enabled: bool = True,
    confidence: float = Query(0.5, ge=0.01, le=1.0, description="Confidence floor (0..1)"),
):
    ai_detector_name = resolve_ai_detector_name(detector)
    try:
        detector_obj = detector_service.get(ai_detector_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    stream_key = backend_detector_key(ai_detector_name)

    def save_detection(
        cam_id: str,
        detections: list,
        image_path: str,
    ) -> None:
        try:
            headers = {}
            if settings.backend_internal_key:
                headers["X-Internal-Key"] = settings.backend_internal_key
            with httpx.Client(timeout=10.0, headers=headers) as client:
                for det in detections:
                    client.post(
                        f"{settings.backend_url}/api/detections/internal",
                        json={
                            "camera_id": cam_id,
                            "label": det["class_name"],
                            "confidence": det["confidence"],
                            "image_url": image_path,
                            "detector_key": stream_key,
                            "class_name": det["class_name"],
                            "track_id": det.get("track_id"),
                            "bounding_box": det["bbox"],
                            "metadata": {
                                "detector_type": ai_detector_name,
                                "source": "webcam",
                            },
                        },
                    )
        except Exception:
            logger.warning("Failed to save detection to backend", exc_info=True)

    def generate():
        device_value = resolve_webcam_device(device)
        cap = _open_webcam(device_value)
        if not cap.isOpened():
            logger.error("Could not open webcam device %r", device_value)
            err_img = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(
                err_img,
                "Camera unavailable - device not found or in use",
                (30, 240),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 255),
                2,
            )
            _, buf = cv2.imencode(".jpg", err_img)
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                + buf.tobytes()
                + b"\r\n"
            )
            return

        tracker = IouTracker()
        fps_counter = _FPSCounter()
        frame_no = 0
        consecutive_failures = 0
        total_objects = 0
        snapshot_interval = 30
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures > MAX_CONSECUTIVE_READ_FAILURES:
                        logger.warning(
                            "Webcam read failed repeatedly, attempting reconnect"
                        )
                        cap.release()
                        reconnected = False
                        for _ in range(RECONNECT_ATTEMPTS):
                            time.sleep(RECONNECT_DELAY_SECONDS)
                            cap = _open_webcam(device_value)
                            if cap.isOpened():
                                reconnected = True
                                break
                        if not reconnected:
                            logger.error(
                                "Webcam disconnected and could not be reopened"
                            )
                            break
                        tracker.reset()
                        consecutive_failures = 0
                    continue

                consecutive_failures = 0
                frame_no += 1
                detections = detector_obj.detect(frame, confidence_threshold=confidence)
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
                annotated = detector_obj.draw(frame, detections)

                fps = fps_counter.update()
                object_count = len(tracked)
                total_objects += object_count
                max_conf = max((d["confidence"] for d in tracked), default=0.0)
                image_height, image_width = frame.shape[:2]

                stats = {
                    "fps": round(fps, 1),
                    "objects": object_count,
                    "confidence": round(max_conf, 4),
                    "total_objects": total_objects,
                    "image_width": int(image_width),
                    "image_height": int(image_height),
                }
                if stream_key == "person":
                    stats["persons"] = object_count
                    stats["total_persons"] = total_objects
                stream_stats.update(camera_id, stream_key, stats)
                _draw_overlay(annotated, fps, object_count, max_conf)

                if tracked and frame_no % snapshot_interval == 0:
                    image_path = ""
                    if snapshot_enabled:
                        snapshot_name = f"webcam_{int(time.time())}_{frame_no}.jpg"
                        image_path = str(OUTPUT_DIR / snapshot_name)
                        cv2.imwrite(image_path, annotated)
                        if frame_no % (snapshot_interval * 10) == 0:
                            _prune_output_dir()

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
