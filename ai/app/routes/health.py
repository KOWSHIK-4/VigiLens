import time

from fastapi import APIRouter

from app.services.detector import detector_service

router = APIRouter(tags=["health"])

START_TIME = time.time()


@router.get("/health")
async def health():
    detector_summary = detector_service.status_summary()
    all_loaded = all(
        info.get("model_loaded", False)
        for info in detector_summary["detectors"].values()
    )
    any_failures = any(
        info.get("consecutive_failures", 0) > 0
        for info in detector_summary["detectors"].values()
    )

    if not all_loaded or any_failures:
        service_status = "degraded"
    else:
        service_status = "ok"

    return {
        "status": service_status,
        "service": "vigilens-ai",
        "version": "1.0.0",
        "uptime": round(time.time() - START_TIME),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "detectors": detector_summary,
    }
