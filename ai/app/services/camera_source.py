"""Resolve a camera's configured capture source from the backend.

The live stream endpoint receives a ``camera_id``, but the source that camera
is actually pointed at lives in the backend database. Rather than guessing a
local device, the stream asks the backend where the frames come from: that
way one endpoint serves USB devices, RTSP/HTTP feeds and recorded video files
alike, and selecting a different camera really does change the picture.

The backend answers on an internal-key-guarded route, so the decrypted feed
credentials travel over the internal service network only. A camera that
cannot be resolved is not an error here: the caller falls back to the legacy
device-selector behaviour so direct webcam streaming keeps working.
"""

import logging
from typing import NamedTuple, Optional

import httpx

from app.config import settings
from app.services.capture import merge_source_credentials

logger = logging.getLogger(__name__)

# Source lookups happen once per stream start, so a short timeout is plenty.
_LOOKUP_TIMEOUT_S = 5.0


class ResolvedSource(NamedTuple):
    """An openable capture source for one camera."""

    source: str
    camera_type: str
    #: True when the source is a file on disk, which must be looped to look
    #: like a live feed instead of ending at EOF.
    is_file: bool


def _looks_like_camera_id(camera_id: str) -> bool:
    """Guard the lookup so the legacy ``default``/device selectors skip HTTP."""
    candidate = (camera_id or "").strip()
    # Camera ids are UUIDs; device selectors ("default", "0", "/dev/video0")
    # are not, and must not be sent to the backend.
    if len(candidate) != 36 or candidate.count("-") != 4:
        return False
    return all(part.strip("0123456789abcdefABCDEF") == "" for part in candidate.split("-"))


def resolve_camera_source(camera_id: str) -> Optional[ResolvedSource]:
    """Look up the configured source for ``camera_id`` via the backend.

    Returns ``None`` when the id is not a camera uuid, the camera no longer
    exists, or the backend cannot be reached -- in every one of those cases
    the caller should fall back rather than fail the request.
    """
    if not settings.backend_url or not _looks_like_camera_id(camera_id):
        return None

    url = f"{settings.backend_url.rstrip('/')}/api/cameras/internal/{camera_id}/stream-source"
    headers = {}
    if settings.backend_internal_key:
        headers["X-Internal-Key"] = settings.backend_internal_key

    try:
        response = httpx.get(url, headers=headers, timeout=_LOOKUP_TIMEOUT_S)
        if response.status_code != 200:
            logger.info(
                "Camera source lookup returned %s for %s",
                response.status_code,
                camera_id,
            )
            return None
        payload = response.json().get("data") or {}
        source = payload.get("url")
        camera_type = payload.get("cameraType")
        if not source or camera_type not in ("usb", "rtsp", "ip", "video_file"):
            logger.info("Camera %s has no usable stream source", camera_id)
            return None
        return ResolvedSource(
            source=merge_source_credentials(
                str(source),
                payload.get("username"),
                payload.get("password"),
            ),
            camera_type=str(camera_type),
            is_file=str(camera_type) == "video_file",
        )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "Camera source lookup failed for %s: %s",
            camera_id,
            exc.__class__.__name__,
        )
        return None