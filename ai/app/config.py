import logging
import math
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
    if trimmed == _INSECURE_KEY:
        return True
    if len(trimmed) < _MIN_SECRET_LENGTH:
        return True
    return bool(_PLACEHOLDER_PATTERN.search(trimmed))


def is_production_environment() -> bool:
    """True when the service is running in a production environment.

    The environment name is matched case-insensitively and with surrounding
    whitespace ignored: ``NODE_ENV=Production`` names the same deployment
    mode as ``production``. Comparing the raw string used to let a
    differently-cased value skip both the production fail-fast and the
    internal-key guard, so a deployment that plainly asked for production
    ran unprotected.
    """
    value = os.getenv("NODE_ENV") or os.getenv("ENVIRONMENT") or "development"
    return value.strip().lower() == "production"


def _env_int(name: str, default: int, minimum: int | None = None) -> int:
    """Read an integer setting, falling back to ``default`` when unusable.

    The environment is operator-supplied: a typo must not take the whole
    service down with an unhandled ValueError while the module is imported,
    and a value outside the range the setting needs must not quietly drop
    the bound it exists to impose.
    """
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        logger.warning("%s=%r is not a number; using %s", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning(
            "%s=%r is below the minimum of %s; using %s", name, raw, minimum, default
        )
        return default
    return value


def _env_float(
    name: str,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    """Read a float setting, falling back to ``default`` when unusable.

    ``float`` parses "nan" and "inf" without complaint, and neither is a
    usable threshold or timeout: a NaN confidence floor compares false
    against every score and admits everything.
    """
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw.strip())
    except ValueError:
        logger.warning("%s=%r is not a number; using %s", name, raw, default)
        return default
    if not math.isfinite(value):
        logger.warning("%s=%r is not finite; using %s", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning(
            "%s=%r is below the minimum of %s; using %s", name, raw, minimum, default
        )
        return default
    if maximum is not None and value > maximum:
        logger.warning(
            "%s=%r is above the maximum of %s; using %s", name, raw, maximum, default
        )
        return default
    return value


class Settings:
    log_level: str
    confidence_threshold: float
    backend_url: str
    backend_internal_key: str
    media_root: str
    capture_open_timeout_ms: int
    inference_timeout_s: float
    inference_max_retries: int

    def __init__(self) -> None:
        self.log_level = os.getenv("LOG_LEVEL", "INFO")
        self.confidence_threshold = _env_float(
            "CONFIDENCE_THRESHOLD", 0.5, minimum=0.0, maximum=1.0
        )
        self.backend_url = os.getenv("BACKEND_URL", "http://localhost:4000")
        # Shared secret for machine-to-machine ingestion. Must match the backend
        # INTERNAL_API_KEY so webcam detections pass the X-Internal-Key guard.
        self.backend_internal_key = os.getenv("BACKEND_INTERNAL_KEY", _INSECURE_KEY)
        self.media_root = os.getenv("MEDIA_ROOT", "/data/vigilens/media")
        # A negative timeout would read as "no timeout" and drop the bound
        # that keeps a dead camera from blocking the caller for the OS-level
        # TCP timeout, so only 0 (explicitly disabled) and up are accepted.
        self.capture_open_timeout_ms = _env_int(
            "CAPTURE_OPEN_TIMEOUT_MS", 5000, minimum=0
        )
        # Maximum seconds a single inference call may take before being aborted.
        self.inference_timeout_s = _env_float("INFERENCE_TIMEOUT_S", 30.0, minimum=0.1)
        # Number of inference retries on transient failure before giving up.
        self.inference_max_retries = _env_int("INFERENCE_MAX_RETRIES", 2, minimum=0)

        if is_production_environment() and is_insecure_internal_key(self.backend_internal_key):
            logger.critical(
                "FATAL: BACKEND_INTERNAL_KEY is missing, a placeholder, or too "
                "short in production. Set a unique value of at least 32 "
                "characters via environment variable. The server will not "
                "start with insecure defaults.",
            )
            sys.exit(1)


settings = Settings()
