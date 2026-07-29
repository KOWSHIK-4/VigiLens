import uuid
from pathlib import Path
from typing import List
import cv2
import numpy as np

from app.detectors.base import Detection

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"


def save_annotated_image(image: np.ndarray, detections: List[Detection]) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    path = str(OUTPUT_DIR / filename)

    annotated = image.copy()
    for d in detections:
        x1, y1, x2, y2 = d.bbox
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"{d.class_name} {d.confidence:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw + 4, y1), (0, 255, 0), -1)
        cv2.putText(annotated, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

    cv2.imwrite(path, annotated)
    return path


def save_annotated_video(input_path: str, output_filename: str, draw_frame_fn) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = str(OUTPUT_DIR / output_filename)

    cap = cv2.VideoCapture(input_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        annotated = draw_frame_fn(frame)
        writer.write(annotated)

    cap.release()
    writer.release()
    return out_path
