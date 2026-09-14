import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes.health import router as health_router
from app.routes.detection import router as detection_router
from app.routes.capture import router as capture_router
from app.services.detector import detector_service  # registers PersonDetector on import

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting VigiLens AI Service...")
    registered = list(detector_service._detectors.keys())
    logger.info("Registered detectors: %s", registered)
    summary = detector_service.status_summary()
    for name, info in summary["detectors"].items():
        loaded = info.get("model_loaded", False)
        logger.info(
            "  %s: model_loaded=%s, class=%s",
            name, loaded, info.get("class", "unknown"),
        )
    all_loaded = all(
        info.get("model_loaded", False)
        for info in summary["detectors"].values()
    )
    if all_loaded:
        logger.info("VigiLens AI Service ready — all models loaded")
    else:
        logger.warning("VigiLens AI Service started — some models failed to load")
    yield


app = FastAPI(
    title="VigiLens AI Service",
    version="1.0.0",
    description="AI-powered security detection service",
    lifespan=lifespan,
)

_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
_app_origin = os.getenv("CORS_ORIGIN", "").strip()
if _app_origin and _app_origin not in _cors_origins:
    _cors_origins.append(_app_origin)

_node_env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development"))
_is_production = _node_env == "production"

# A wildcard origin combined with credentials is both rejected by browsers and
# defeats the point of CORS. In production it is always removed; the service
# may also only start with an explicit origin allow-list.
if _is_production and "*" in _cors_origins:
    logger.warning("Removing wildcard '*' from CORS_ORIGINS in production")
    _cors_origins = [o for o in _cors_origins if o != "*"]

if not _cors_origins:
    if _is_production:
        logger.critical(
            "FATAL: No explicit CORS origin configured in production. Set "
            "CORS_ORIGINS or CORS_ORIGIN (e.g. https://your-domain.com). "
            "The server will not start without an explicit allow-list."
        )
        sys.exit(1)
    logger.warning("No CORS origins configured — allowing all origins (development only)")
    _cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(detection_router)
app.include_router(capture_router)
