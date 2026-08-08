import time

from fastapi import APIRouter

router = APIRouter(tags=["health"])

START_TIME = time.time()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "vigilens-ai",
        "version": "1.0.0",
        "uptime": round(time.time() - START_TIME),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
