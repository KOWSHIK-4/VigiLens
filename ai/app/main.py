import logging
import os
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
    logger.info("Registered detectors: %s", list(detector_service._detectors.keys()))
    logger.info("VigiLens AI Service ready")
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
if not _cors_origins:
    if _node_env == "production":
        logger.critical(
            "No CORS origins configured in production. Set CORS_ORIGINS or "
            "CORS_ORIGIN environment variable. Falling back to same-origin only."
        )
        _cors_origins = []
    else:
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
