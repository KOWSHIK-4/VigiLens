import logging
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(detection_router)
app.include_router(capture_router)
