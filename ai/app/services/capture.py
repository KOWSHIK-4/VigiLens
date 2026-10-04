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
from urllib.parse import urlparse, urlunparse

import cv2

from app.ssrf import assert_source_allowed

logger = logging.getLogger(__name__)

SUPPORTED_CAMERA_TYPES = ("usb", "rtsp", "ip", "video_file")


class CaptureError(Exception):
    """Raised when a frame cannot be captured from a source."""


def merge_source_credentials(
    source: str,
    camera_user: str | None,
    camera_pass: str | None,
) -> str:
    """Inject per-request camera credentials into a source URL.

    OpenCV authenticates network feeds through URL userinfo, so the plaintext
    username/password have to be recombined here. Callers keep the secrets out
    of query strings and logs and pass them out-of-band instead.

    If the source URL already contains userinfo it is left untouched (legacy
    deployments or operators who embed creds directly in the URL).
    """
    if not camera_user or not camera_pass:
        return source
    try:
        parsed = urlparse(source)
        if parsed.username or parsed.password:
            return source  # Already present -- do not double-encode.
        userinfo = f"{camera_user}:{camera_pass}"
        netloc = f"{userinfo}@{parsed.hostname or ''}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse(parsed._replace(netloc=netloc))
    except Exception:
        return source


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
    """Open an OpenCV capture, bounding network opens by the configured timeout.

    The open/read timeouts must be supplied at construction time: setting
    them after ``VideoCapture()`` returns is too late, because the
    constructor has already blocked on the network handshake (a dead rtsp
    endpoint would stall the caller for the OS-level TCP timeout).

    Network sources pass the outbound guard first. This is the point where the
    socket is actually opened, so it is the last place the check can be
    enforced; the backend applies an equivalent guard before forwarding, and
    both are needed because this is where a bypass would do the most damage.
    """
    source_is_str = isinstance(source, str)
    is_network = (
        camera_type in ("rtsp", "ip")
        or (source_is_str and str(source).startswith(("rtsp://", "rtmp://", "http://", "https://")))
    )
    if is_network:
        try:
            assert_source_allowed(str(source))
        except ValueError as exc:
            raise CaptureError(str(exc)) from exc

    if is_network and open_timeout_ms > 0:
        return cv2.VideoCapture(
            str(source),
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                int(open_timeout_ms),
                cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                int(open_timeout_ms),
            ],
        )

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
