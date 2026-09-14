import asyncio
import functools

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.config import settings
from app.security import verify_internal_key
from app.services.capture import SUPPORTED_CAMERA_TYPES, CaptureError, capture_frame

# Frame capture pulls a stream by URL, so the endpoint doubles as a potential
# network open proxy. Only the backend engine is allowed to call it: every
# request must carry the shared internal key.
router = APIRouter(tags=["capture"], dependencies=[Depends(verify_internal_key)])

#: Upper bounds on the query string so a misconfigured or hostile client
#: cannot drive an unbounded look-up or hand the worker an oversized string.
_MAX_SOURCE_LENGTH = 4096
_MAX_TYPE_LENGTH = 32


@router.get("/capture")
async def capture(
    source: str = Query(..., max_length=_MAX_SOURCE_LENGTH, description="Camera source url, device path or video file path"),
    type: str = Query("rtsp", max_length=_MAX_TYPE_LENGTH, description="usb | rtsp | ip | video_file"),
    video_pos_seconds: float = Query(0.0, ge=0.0, description="Seek position for video_file sources"),
):
    if type not in SUPPORTED_CAMERA_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported camera type '{type}'")

    try:
        # Opening a network camera blocks on the handshake; run it on a
        # worker thread so the event loop keeps serving other requests.
        loop = asyncio.get_running_loop()
        jpeg = await loop.run_in_executor(
            None,
            functools.partial(
                capture_frame,
                source,
                type,
                media_root=settings.media_root,
                video_pos_seconds=video_pos_seconds,
                open_timeout_ms=settings.capture_open_timeout_ms,
            ),
        )
    except CaptureError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Capture-Type": type},
    )
