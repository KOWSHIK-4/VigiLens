import asyncio
import functools

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Response

from app.config import settings
from app.security import verify_internal_key
from app.services.capture import (
    SUPPORTED_CAMERA_TYPES,
    CaptureError,
    capture_frame,
    merge_source_credentials,
    redact_source,
)

# Frame capture pulls a stream by URL, so the endpoint doubles as a potential
# network open proxy. Only the backend engine is allowed to call it: every
# request must carry the shared internal key.
router = APIRouter(tags=["capture"], dependencies=[Depends(verify_internal_key)])

#: Upper bounds on the query string so a misconfigured or hostile client
#: cannot drive an unbounded look-up or hand the worker an oversized string.
_MAX_SOURCE_LENGTH = 4096
_MAX_TYPE_LENGTH = 32


def _merge_credentials(
    source: str,
    camera_user: str | None,
    camera_pass: str | None,
) -> str:
    """
    Inject per-request camera credentials into the source URL.

    The backend sends ``X-Camera-User`` and ``X-Camera-Pass`` headers instead
    of embedding credentials in the query string (which would expose them in
    uvicorn access logs).  The AI service merges them into the URL form that
    OpenCV requires for network camera authentication.

    If the source URL already contains userinfo it is left untouched (legacy
    deployments or operators who embed creds directly in the URL).
    """
    return merge_source_credentials(source, camera_user, camera_pass)


@router.get("/capture")
async def capture(
    source: str = Query(..., max_length=_MAX_SOURCE_LENGTH, description="Camera source url, device path or video file path"),
    type: str = Query("rtsp", max_length=_MAX_TYPE_LENGTH, description="usb | rtsp | ip | video_file"),
    video_pos_seconds: float = Query(0.0, ge=0.0, description="Seek position for video_file sources"),
    x_camera_user: str | None = Header(None, alias="X-Camera-User"),
    x_camera_pass: str | None = Header(None, alias="X-Camera-Pass"),
):
    if type not in SUPPORTED_CAMERA_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported camera type '{type}'")

    authenticated_source = _merge_credentials(source, x_camera_user, x_camera_pass)

    try:
        # Opening a network camera blocks on the handshake; run it on a
        # worker thread so the event loop keeps serving other requests.
        loop = asyncio.get_running_loop()
        jpeg = await loop.run_in_executor(
            None,
            functools.partial(
                capture_frame,
                authenticated_source,
                type,
                media_root=settings.media_root,
                video_pos_seconds=video_pos_seconds,
                open_timeout_ms=settings.capture_open_timeout_ms,
            ),
        )
    except CaptureError as exc:
        raise HTTPException(status_code=502, detail=redact_source(str(exc))) from exc

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Capture-Type": type},
    )
