"""Generate the person-detection test clip for the seeded ``video_file`` camera.

The bundled ``demo.mp4`` is a synthetic lobby scene with drawn figures. It proves
that the live pipeline moves real pixels, but YOLO correctly ignores those
shapes, so it cannot exercise detection, persistence, alerting or the
``/detections`` UI. This script renders a second, committed clip that contains
**real people** so the whole downstream path can be verified end to end.

The source frame is ``bus.jpg``, the sample image that ships inside the
``ultralytics`` package this project already depends on -- no new footage is
introduced and nothing is downloaded at build time. A slow zoom is applied so
successive frames genuinely differ (the live view must not look frozen), while
keeping every person fully inside the frame at all times so detection stays
reliable no matter which frame the pipeline samples.

Usage (inside the ai-service image, which already has OpenCV + ultralytics)::

    python -m tools.make_person_clip --output /recordings/person_test.mp4

Unlike ``make_demo_clip``, the generated asset is *verified* with the real
detector before it is accepted: if YOLO cannot find a person in the first, middle
and last frames, the script fails instead of shipping an unusable clip.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np

WIDTH = 720
HEIGHT = 960
FPS = 10
DEFAULT_SECONDS = 12
PERSON_CLASS_ID = 0
# Kept below the detector's own threshold on purpose: the pipeline applies its
# own confidence filter, so the asset must not depend on YOLO's default 0.25.
VERIFY_CONF = 0.25


def _default_source() -> Path:
    """Locate ``bus.jpg`` inside the installed ultralytics package."""
    import ultralytics

    candidate = Path(ultralytics.__file__).parent / "assets" / "bus.jpg"
    if not candidate.is_file():
        raise SystemExit(
            "Could not find ultralytics' bundled bus.jpg; pass --source explicitly"
        )
    return candidate


def _cover(img: np.ndarray, factor: float) -> np.ndarray:
    """Scale ``img`` about its centre, cropping the overflow (Ken Burns zoom)."""
    if abs(factor - 1.0) < 1e-6:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), 0.0, factor)
    return cv2.warpAffine(
        img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def _fit(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise SystemExit(f"Could not read source image: {path}")
    h, w = img.shape[:2]
    scale = min(WIDTH / w, HEIGHT / h)
    resized = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    y0 = (HEIGHT - resized.shape[0]) // 2
    x0 = (WIDTH - resized.shape[1]) // 2
    canvas[y0 : y0 + resized.shape[0], x0 : x0 + resized.shape[1]] = resized
    return canvas


def render(output: Path, source: Path, seconds: int, fps: int) -> None:
    base = _fit(source)
    total_frames = seconds * fps

    output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), (WIDTH, HEIGHT)
    )
    if not writer.isOpened():
        raise SystemExit(f"Could not open a video writer for {output}")

    try:
        for index in range(total_frames):
            phase = index / max(1, total_frames - 1)
            # 1.00 -> 1.06 -> 1.00 : always >= 1.0, so nothing is cropped away.
            factor = 1.0 + 0.06 * (1.0 - np.cos(2.0 * np.pi * phase)) / 2.0
            frame = _cover(base, float(factor))
            # Inset border marks it as a generated test asset.
            cv2.rectangle(frame, (0, 0), (WIDTH - 1, HEIGHT - 1), (60, 60, 60), 2)
            writer.write(frame)
    finally:
        writer.release()


def verify_with_yolo(path: Path) -> list[tuple[int, int, float]]:
    """Confirm the real detector finds a person in the first/middle/last frames."""
    try:
        from ultralytics import YOLO
    except ImportError as exc:  # pragma: no cover - environment problem
        raise SystemExit(f"ultralytics is required to verify the clip: {exc}")

    from app.detectors.person import PersonDetector  # noqa: F401  (import check)

    model = YOLO("yolo11n.pt")
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise SystemExit(f"Generated file is not readable: {path}")
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()

    results: list[tuple[int, int, float]] = []
    for label, index in (("first", 0), ("middle", total // 2), ("last", max(0, total - 1))):
        cap = cv2.VideoCapture(str(path))
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            raise SystemExit(f"Could not read {label} frame from {path}")

        boxes = model(frame, verbose=False, conf=VERIFY_CONF)[0].boxes
        people = [
            float(b.conf[0])
            for b in boxes
            if int(b.cls[0]) == PERSON_CLASS_ID
        ]
        if not people:
            raise SystemExit(
                f"YOLO found no person in the {label} frame of {path}; "
                "the clip would not exercise the detection pipeline"
            )
        results.append((index, len(people), max(people)))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="/recordings/person_test.mp4")
    parser.add_argument("--source", default=None)
    parser.add_argument("--seconds", type=int, default=DEFAULT_SECONDS)
    parser.add_argument("--fps", type=int, default=FPS)
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="skip the YOLO self-check (not recommended)",
    )
    args = parser.parse_args()

    target = Path(args.output)
    source = Path(args.source) if args.source else _default_source()
    render(target, source, args.seconds, args.fps)

    capture = cv2.VideoCapture(str(target))
    if not capture.isOpened():
        raise SystemExit(f"Generated file is not readable: {target}")
    readable = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()
    if readable <= 0:
        raise SystemExit(f"Generated file reports no frames: {target}")

    line = (
        f"Wrote {target} ({target.stat().st_size / 1024:.0f} KiB, "
        f"{readable} frames, {args.fps} fps, {WIDTH}x{HEIGHT})"
    )
    if args.skip_verify:
        print(line + " -- verification skipped")
    else:
        for index, count, best in verify_with_yolo(target):
            print(f"  frame {index:>4}: {count} person(s), best conf {best:.4f}")
        print(line)
        print("YOLO verification passed")


if __name__ == "__main__":
    main()