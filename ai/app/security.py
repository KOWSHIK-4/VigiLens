"""Shared internal-key authentication for the AI service boundary.

Every AI endpoint except the unauthenticated health endpoints (``/health``,
``/health/live``, ``/health/ready``) is a machine-to-machine surface: the
backend's capture engine and the browser-facing nginx proxy are the only
legitimate callers. This module enforces the shared ``X-Internal-Key`` guard
consistently across capture, detection, streaming and stats routes.
"""

import hmac
import os

from fastapi import HTTPException, Request

from app.config import DEFAULT_INTERNAL_KEY, settings

#: Environment flags that force the internal-key guard even in a development
#: build still using the bundled default secret.
_AUTH_FLAGS = ("AI_REQUIRE_AUTH", "AI_STATS_REQUIRE_AUTH")


def verify_internal_key(request: Request) -> None:
    """Verify the X-Internal-Key header against the shared secret.

    Auth is required when any of these hold:
    * the environment is production, or
    * the shared secret is a real (non-bundled-default) value, or
    * an auth flag (``AI_REQUIRE_AUTH`` / ``AI_STATS_REQUIRE_AUTH``) is set.

    The only anonymous path is a development environment still using the
    bundled insecure default key without an explicit flag. A deployment that
    sets a real ``BACKEND_INTERNAL_KEY`` therefore stays protected even if
    ``NODE_ENV`` is never set and the boolean flags are not flipped.
    """
    required = settings.backend_internal_key
    if not required:
        return
    node_env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development"))
    explicit_require = any(
        os.getenv(flag, "").lower() in ("1", "true") for flag in _AUTH_FLAGS
    )
    using_default_key = required == DEFAULT_INTERNAL_KEY
    if node_env != "production" and using_default_key and not explicit_require:
        return
    provided = request.headers.get("x-internal-key", "")
    if not hmac.compare_digest(provided.encode(), required.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing internal key")