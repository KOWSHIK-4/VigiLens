"""Frame capture service.

Grabs a single JPEG-encoded frame from any of the four VigiLens camera
source types:

- ``usb``:        a local webcam device (``/dev/video0``, ``video0``, ``0``)
- ``rtsp`` / ``ip``: a stream URL handed to OpenCV verbatim
- ``video_file``: a video file path (absolute, or relative to ``MEDIA_ROOT``)

A ``video_file`` source carrying a network scheme is refused rather than
resolved: the camera type is caller-supplied, so it cannot be trusted to
agree with the string that actually reaches OpenCV.

Video files advance their read position between captures so the continuous
monitoring scheduler does not keep re-processing the first frame forever.
"""

import logging
import re
from pathlib import Path
from urllib.parse import quote, urlparse, urlsplit, urlunparse, urlunsplit

import cv2

from app.ssrf import (
    assert_source_allowed,
    has_network_scheme,
    is_network_source,
)

logger = logging.getLogger(__name__)

SUPPORTED_CAMERA_TYPES = ("usb", "rtsp", "ip", "video_file")

# Userinfo pattern for redacting credentials from error messages / logs.
# The password group is greedy so a password containing ``@`` is consumed up
# to the real delimiter instead of leaving its tail in the output.
_USERINFO_RE = re.compile(r"(://[^:/\s@]+:)([^/\s]+)(@)")

# A URL embedded in a larger message (an exception string, a log line).
_URL_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s'\"<>]*")


def _redact_parts(parts) -> str:
    """Rebuild a parsed URL with its userinfo replaced by ``***``.

    A password keeps the username visible (``user:***``) because that is the
    shape operators recognise in a feed URL. A username without a password
    carries no password marker to preserve, so the whole userinfo is masked;
    leaving it in place would publish half of a shared credential.
    """
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    if parts.password is not None:
        netloc = f"{parts.username or ''}:***@{host}"
    else:
        netloc = f"***@{host}"
    if parts.port is not None:
        netloc += f":{parts.port}"
    return urlunsplit(parts._replace(netloc=netloc))


def _redact_url_token(token: str) -> str:
    try:
        parts = urlsplit(token)
        if parts.username is None and parts.password is None:
            return token
        return _redact_parts(parts)
    except ValueError:
        # Unparsable userinfo (e.g. a malformed port) still gets a
        # best-effort pass so a secret is never returned verbatim.
        return _USERINFO_RE.sub(r"\1***\3", token)


def redact_source(source: str) -> str:
    """Strip embedded credentials from a source string for display/logging.

    Feed URLs carry the merged username/password in their userinfo, so any
    error message or log line that embeds the source would otherwise publish
    the camera password to wherever logs are shipped.

    Parsing the URL (rather than matching an ``@``-delimited pattern) matters:
    passwords may themselves contain ``@`` or spaces, and a regex stops at the
    first delimiter and leaves the tail of the secret in the output.

    The input is not always a bare URL: it may be an exception message such as
    ``Cannot open camera source 'rtsp://u:p@host'``. Parsing that as a single
    URL finds no password (the scheme belongs to the prose), so any URL-shaped
    token inside the text is redacted individually as well.
    """
    if not source:
        return source
    try:
        parts = urlsplit(source)
        if parts.username is not None or parts.password is not None:
            return _redact_parts(parts)
    except ValueError:
        # Not a single parseable URL; the token scan below handles embedded
        # sources and the best-effort fallback.
        pass
    return _URL_TOKEN_RE.sub(lambda match: _redact_url_token(match.group(0)), source)


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

    Only network sources are rewritten. A USB device node or a video-file path
    has no authority component to attach userinfo to, so urlunparse turns
    ``"0"`` into ``"//user:pass@/0"`` and the local source stops resolving.
    Merge headers are network-feed credentials; a local source is returned
    untouched.

    The credentials are percent-encoded on the way in. A password holding a
    character that is structural in a URL (``/``, ``?``, ``#``, ``@``, a
    space) splits the URL apart when it is pasted in raw: the host is lost
    and the tail of the secret ends up in the path, so the camera open goes
    somewhere else entirely and the password leaks into the request line.
    FFmpeg decodes the userinfo before it authenticates, so the encoded form
    is exactly what OpenCV needs.
    """
    if not camera_user or not camera_pass:
        return source
    if not has_network_scheme(source):
        return source
    try:
        parsed = urlparse(source)
        if parsed.username or parsed.password:
            return source  # Already present -- do not double-encode.
        userinfo = f"{quote(camera_user, safe='')}:{quote(camera_pass, safe='')}"
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

    A source carrying a network scheme is refused here rather than being
    wrapped in a :class:`~pathlib.Path`. ``Path`` rewrites a URL into a
    filesystem-shaped string (``rtsp://host/x`` becomes ``rtsp:\\host\\x`` on
    Windows, ``rtsp:/host/x`` elsewhere), which destroys the very evidence
    :func:`app.ssrf.assert_source_allowed` and the network open timeouts decide
    on. Refusing at the entry point keeps a URL visible as a URL for the whole
    rest of the path.
    """
    if has_network_scheme(source):
        raise CaptureError(
            f"Camera source '{source}' is a URL, not a video_file path; "
            "use the rtsp or ip camera type for network sources"
        )
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
    if stripped.isascii() and stripped.isdigit():
        return int(stripped)
    marker = "video"
    idx = stripped.rfind(marker)
    if idx != -1:
        suffix = stripped[idx + len(marker):]
        if suffix.isascii() and suffix.isdigit():
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
    # Classified from the parsed scheme, never a string prefix: see
    # `app.ssrf.has_network_scheme` for why a prefix test is not equivalent.
    is_network = is_network_source(camera_type, str(source))
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
