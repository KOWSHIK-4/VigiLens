import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.detector import detector_service

router = APIRouter(tags=["health"])

START_TIME = time.time()


def _detector_diagnostics() -> dict:
    """Shared detector state used by the readiness and detail health probes."""
    detector_summary = detector_service.status_summary()
    all_loaded = all(
        info.get("model_loaded", False)
        for info in detector_summary["detectors"].values()
    )
    any_failures = any(
        info.get("consecutive_failures", 0) > 0
        for info in detector_summary["detectors"].values()
    )
    return {
        "detectors": detector_summary["detectors"],
        "detector_count": detector_summary["detector_count"],
        "all_models_loaded": all_loaded,
        "has_failures": any_failures,
    }


def _status_body() -> dict:
    diagnostics = _detector_diagnostics()
    service_status = "ok" if diagnostics["all_models_loaded"] and not diagnostics["has_failures"] else "degraded"
    return {
        "status": service_status,
        "service": "vigilens-ai",
        "version": "1.0.0",
        "uptime": round(time.time() - START_TIME),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "detectors": {
            "detector_count": diagnostics["detector_count"],
            "detectors": diagnostics["detectors"],
        },
    }


@router.get("/health/live")
async def health_live():
    """Liveness probe: process is up and answering. No model dependency."""
    return {"status": "ok", "service": "vigilens-ai"}


@router.get("/health/ready")
async def health_ready():
    """Readiness probe: models loaded and inferencing cleanly. Used by the
    infra to decide whether to route work to this instance. Returns 503 while
    degraded.
    """
    diagnostics = _detector_diagnostics()
    ready = diagnostics["all_models_loaded"] and not diagnostics["has_failures"]
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ok" if ready else "degraded",
            "ready": ready,
            "service": "vigilens-ai",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "detectors": {
                "detector_count": diagnostics["detector_count"],
                "detectors": diagnostics["detectors"],
            },
        },
    )


@router.get("/health")
async def health():
    return _status_body()