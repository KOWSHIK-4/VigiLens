import logging
import os
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from app.services.detector import detector_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/detect", tags=["detection"])

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"


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

        return {
            "success": True,
            "detections": dets_json,
            "count": len(detections),
            "output_path": out_path,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
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


@router.get("/webcam")
async def detect_webcam():
    def generate():
        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)
        detector = detector_service.get("person_detector")
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                detections = detector.detect(frame)
                annotated = detector.draw(frame, detections)
                _, buffer = cv2.imencode(".jpg", annotated)
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")
        finally:
            cap.release()

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
