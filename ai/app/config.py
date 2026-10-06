import logging
import os
import re
import sys

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_INSECURE_KEY = "dev-internal-key-change-in-production"
# Public alias used by route-level auth guards to distinguish a real shared
# secret from the bundled development default.
DEFAULT_INTERNAL_KEY = _INSECURE_KEY

# Placeholder markers that are never acceptable as the shared boundary secret,
# even when they differ from the exact bundled default (e.g. the
# "change_me_in_production" value older .env.example files recommended). The
# backend's config/index.ts applies the same pattern check to JWT_SECRET and
# INTERNAL_API_KEY; without it a production deploy that copied the example
# placeholder would boot successfully on a publicly known key.
_PLACEHOLDER_PATTERN = re.compile(
    r"(change[_-]?me|changeme|your[_-]?(secret|key)|example[_-]?(secret|key)|replace[_-]?me|dummy[_-]?(secret|key)|xxx+)",
    re.IGNORECASE,
)

#: Minimum length for the shared boundary secret (~256-bit).
_MIN_SECRET_LENGTH = 32


def is_insecure_internal_key(value: str | None) -> bool:
    """True when the shared secret is missing, a placeholder, or too short."""
    if not value:
        return True
    trimmed = value.strip()
    if len(trimmed) < _MIN_SECRET_LENGTH:
        return True
    return bool(_PLACEHOLDER_PATTERN.search(trimmed))


class Settings:
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))
    backend_url: str = os.getenv("BACKEND_URL", "http://localhost:4000")
    # Shared secret for machine-to-machine ingestion. Must match the backend
    # INTERNAL_API_KEY so webcam detections pass the X-Internal-Key guard.
    backend_internal_key: str = os.getenv(
        "BACKEND_INTERNAL_KEY", _INSECURE_KEY,
    )
    media_root: str = os.getenv("MEDIA_ROOT", "/data/vigilens/media")
    capture_open_timeout_ms: int = int(os.getenv("CAPTURE_OPEN_TIMEOUT_MS", "5000"))
    # Maximum seconds a single inference call may take before being aborted.
    inference_timeout_s: float = float(os.getenv("INFERENCE_TIMEOUT_S", "30"))
    # Number of inference retries on transient failure before giving up.
    inference_max_retries: int = int(os.getenv("INFERENCE_MAX_RETRIES", "2"))

    def __init__(self) -> None:
        node_env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development"))
        if node_env == "production" and is_insecure_internal_key(self.backend_internal_key):
            logger.critical(
                "FATAL: BACKEND_INTERNAL_KEY is missing, a placeholder, or too "
                "short in production. Set a unique value of at least 32 "
                "characters via environment variable. The server will not "
                "start with insecure defaults.",
            )
            sys.exit(1)


settings = Settings()
