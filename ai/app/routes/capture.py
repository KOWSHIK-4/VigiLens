import asyncio
import functools

from fastapi import APIRouter, HTTPException, Query, Response

from app.config import settings
from app.services.capture import SUPPORTED_CAMERA_TYPES, CaptureError, capture_frame

router = APIRouter(tags=["capture"])


@router.get("/capture")
async def capture(
    source: str = Query(..., description="Camera source url, device path or video file path"),
    type: str = Query("rtsp", description="usb | rtsp | ip | video_file"),
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
