"""Generate the bundled demo clip used by the seeded ``video_file`` camera.

The seed ships a ``Demo Recording`` camera pointing at ``/recordings/demo.mp4``
so a fresh deployment has one camera that genuinely plays. That clip has to be
a real, decodable MP4 -- OpenCV refuses to open a placeholder -- and it has to
be committed, because a Docker image layer is the only thing that can make the
path exist inside the ``ai-service`` container.

This script renders it from code so the asset is reproducible instead of an
opaque binary: no footage is redistributed, and the clip can be regenerated at
a different size or length by re-running this.

Usage (inside the ai-service image, which already has OpenCV + FFmpeg)::

    python -m tools.make_demo_clip --output /recordings/demo.mp4

Rendered content is synthetic: a lobby-like scene with a moving figure, a
sweeping timestamp and a moving scan bar, so the live view and the detectors
have real per-frame variation to work with.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np

WIDTH = 960
HEIGHT = 540
FPS = 24
DEFAULT_SECONDS = 24


def _gradient_background(width: int, height: int) -> np.ndarray:
    """A vertical wall/floor gradient, so the scene is not a flat colour."""
    top = np.array([58, 74, 96], dtype=np.float32)
    bottom = np.array([28, 32, 40], dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    column = top[None, :] * (1.0 - ramp) + bottom[None, :] * ramp
    return np.repeat(column[:, None, :], width, axis=1).astype(np.uint8)


def _draw_person(
    frame: np.ndarray,
    x: float,
    ground_y: int,
    height: int,
    hue: int,
) -> None:
    """Draw a simple walking figure at ``x`` so successive frames differ."""
    head_r = max(6, height // 9)
    torso_h = height // 3
    body_w = max(10, height // 8)

    head_x = int(x)
    head_y = ground_y - height + head_r
    cv2.circle(frame, (head_x, head_y), head_r, (60, 130, 235), -1)

    torso_top = head_y + head_r
    torso_bottom = torso_top + torso_h
    cv2.rectangle(
        frame,
        (head_x - body_w // 2, torso_top),
        (head_x + body_w // 2, torso_bottom),
        (80, hue, 120),
        -1,
    )

    leg_top = torso_bottom
    leg_bottom = ground_y
    cv2.line(frame, (head_x, leg_top), (head_x - body_w // 2, leg_bottom), (40, 40, 60), max(3, body_w // 3))
    cv2.line(frame, (head_x, leg_top), (head_x + body_w // 2, leg_bottom), (40, 40, 60), max(3, body_w // 3))


def render(output: Path, seconds: int, fps: int) -> None:
    width, height = WIDTH, HEIGHT
    total_frames = seconds * fps

    output.parent.mkdir(parents=True, exist_ok=True)
    # ``mp4v`` is the MPEG-4 Part 2 encoder bundled with OpenCV's FFmpeg
    # backend, so the result plays back through OpenCV with no extra package.
    writer = cv2.VideoWriter(
        str(output),
        cv2.VideoWriter_fourcc(*"mp4v"),
        float(fps),
        (width, height),
    )
    if not writer.isOpened():
        raise SystemExit(f"Could not open a video writer for {output}")

    background = _gradient_background(width, height)
    floor_y = int(height * 0.82)

    try:
        for index in range(total_frames):
            frame = background.copy()

            # Static scene furniture, so frames have a stable reference.
            cv2.rectangle(frame, (0, floor_y), (width, height), (34, 38, 48), -1)
            cv2.line(frame, (0, floor_y), (width, floor_y), (90, 100, 120), 2)
            for door_x in (110, 430, 750):
                cv2.rectangle(
                    frame,
                    (door_x, floor_y - 190),
                    (door_x + 150, floor_y),
                    (26, 30, 38),
                    -1,
                )
                cv2.rectangle(
                    frame,
                    (door_x, floor_y - 190),
                    (door_x + 150, floor_y),
                    (70, 80, 100),
                    2,
                )

            # Two figures crossing the lobby at different speeds and heights.
            t = index / fps
            _draw_person(
                frame,
                (width * 0.12) + (width * 0.62) * ((t / (seconds * 0.8)) % 1.0),
                floor_y,
                int(height * 0.34),
                hue=int(90 + 100 * np.sin(t)),
            )
            _draw_person(
                frame,
                (width * 0.85) - (width * 0.55) * ((t / (seconds * 0.55)) % 1.0),
                floor_y,
                int(height * 0.26),
                hue=int(150 + 80 * np.cos(t * 1.3)),
            )

            # A sweeping scan bar guarantees visible motion in every frame.
            bar_x = int((index / max(1, total_frames - 1)) * width)
            cv2.line(frame, (bar_x, 0), (bar_x, height), (90, 90, 110), 1)

            # Burned-in timestamp, as a real camera feed would have.
            stamp = f"2026-01-01 {int(t // 3600):02d}:{int(t // 60) % 60:02d}:{int(t) % 60:02d}"
            cv2.putText(
                frame, stamp, (24, height - 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (210, 210, 210), 1,
            )
            cv2.putText(
                frame, "VIGILENS DEMO FEED", (24, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (240, 240, 240), 2,
            )

            writer.write(frame)
    finally:
        writer.release()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="/recordings/demo.mp4")
    parser.add_argument("--seconds", type=int, default=DEFAULT_SECONDS)
    parser.add_argument("--fps", type=int, default=FPS)
    args = parser.parse_args()

    target = Path(args.output)
    render(target, args.seconds, args.fps)

    # Verify the asset round-trips: a file OpenCV cannot reopen is useless as
    # a live source, so fail the build rather than shipping a broken clip.
    probe = cv2.VideoCapture(str(target))
    if not probe.isOpened():
        raise SystemExit(f"Generated file is not readable: {target}")
    readable = int(probe.get(cv2.CAP_PROP_FRAME_COUNT))
    probe.release()
    if readable <= 0:
        raise SystemExit(f"Generated file reports no frames: {target}")

    size_kb = target.stat().st_size / 1024
    print(f"Wrote {target} ({size_kb:.0f} KiB, {readable} frames, {args.fps} fps)")


if __name__ == "__main__":
    main()