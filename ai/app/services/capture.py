"""Frame capture service.

Grabs a single JPEG-encoded frame from any of the four VigiLens camera
source types:

- ``usb``:        a local webcam device (``/dev/video0``, ``video0``, ``0``)
- ``rtsp`` / ``ip``: a stream URL handed to OpenCV verbatim
- ``video_file``: a video file path (absolute, or relative to ``MEDIA_ROOT``)

Video files advance their read position between captures so the continuous
monitoring scheduler does not keep re-processing the first frame forever.
"""

import logging
from pathlib import Path

import cv2

logger = logging.getLogger(__name__)

SUPPORTED_CAMERA_TYPES = ("usb", "rtsp", "ip", "video_file")


class CaptureError(Exception):
    """Raised when a frame cannot be captured from a source."""


def resolve_video_path(source: str, media_root: str | None = None) -> str:
    """Resolve a video file source to a readable path.

    Absolute paths win; otherwise the source is resolved relative to the
    configured media root when a file exists there.
    """
    path = Path(source)
    if path.is_absolute():
        return str(path)
    if media_root:
        candidate = Path(media_root) / source
        if candidate.exists():
            return str(candidate)
    return str(path)


def usb_device_index(source: str) -> int | None:
    """Extract a webcam device index from a url like ``/dev/video0`` or ``0``."""
    stripped = source.strip()
    if stripped.isdigit():
        return int(stripped)
    marker = "video"
    idx = stripped.rfind(marker)
    if idx != -1:
        suffix = stripped[idx + len(marker):]
        if suffix.isdigit():
            return int(suffix)
    return None


def open_capture(source: str, camera_type: str, open_timeout_ms: int) -> cv2.VideoCapture:
    """Open an OpenCV capture for the source, applying read/open timeouts."""
    cap = cv2.VideoCapture(source)
    if open_timeout_ms > 0:
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, open_timeout_ms)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, open_timeout_ms)
    return cap


def capture_frame(
    source: str,
    camera_type: str,
    media_root: str | None = None,
    video_pos_seconds: float = 0.0,
    open_timeout_ms: int = 5000,
) -> bytes:
    """Capture a single JPEG-encoded frame from the given source.

    Returns the JPEG bytes. Raises :class:`CaptureError` when the source
    cannot be opened or yields no readable frame.
    """
    if camera_type == "usb":
        index = usb_device_index(source)
        if index is None:
            raise CaptureError(f"Cannot parse USB device index from '{source}'")
        cap = open_capture(index, camera_type, open_timeout_ms)
    elif camera_type == "video_file":
        path = resolve_video_path(source, media_root)
        cap = open_capture(path, camera_type, open_timeout_ms)
    else:
        cap = open_capture(source, camera_type, open_timeout_ms)

    try:
        if not cap.isOpened():
            raise CaptureError(f"Cannot open camera source '{source}' ({camera_type})")
        if video_pos_seconds > 0:
            cap.set(cv2.CAP_PROP_POS_MSEC, int(video_pos_seconds * 1000))
        ok, frame = cap.read()
        if not ok or frame is None:
            raise CaptureError(f"No readable frame from '{source}' ({camera_type})")
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            raise CaptureError(f"Failed to encode frame from '{source}'")
        return encoded.tobytes()
    finally:
        cap.release()
