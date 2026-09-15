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

#: Canonical environment flag that forces the internal-key guard even in a
#: development build still using the bundled default secret.
AUTH_REQUIRE_FLAG = "AI_REQUIRE_AUTH"

#: Legacy alias honored for backward compatibility. Early deployments used
#: ``AI_STATS_REQUIRE_AUTH=true`` to gate the webcam stream/stats endpoints.
#: Today the whole AI boundary (capture + all detection surfaces) shares one
#: guard, so the variable is simply a renamed ``AI_REQUIRE_AUTH``. Both are
#: accepted; new deployments must use ``AI_REQUIRE_AUTH``.
LEGACY_AUTH_FLAGS = ("AI_STATS_REQUIRE_AUTH",)


def _explicit_auth_required() -> bool:
    """True when any documented auth flag forces the guard on."""
    return any(
        os.getenv(flag, "").lower() in ("1", "true")
        for flag in (AUTH_REQUIRE_FLAG, *LEGACY_AUTH_FLAGS)
    )


def verify_internal_key(request: Request) -> None:
    """Verify the X-Internal-Key header against the shared secret.

    Auth is required when any of these hold:
    * the environment is production, or
    * the shared secret is a real (non-bundled-default) value, or
    * an auth flag (canonical ``AI_REQUIRE_AUTH`` or its legacy alias
      ``AI_STATS_REQUIRE_AUTH``) is set.

    The only anonymous path is a development environment still using the
    bundled insecure default key without an explicit flag. A deployment that
    sets a real ``BACKEND_INTERNAL_KEY`` therefore stays protected even if
    ``NODE_ENV`` is never set and the boolean flags are not flipped.
    """
    required = settings.backend_internal_key
    if not required:
        return
    node_env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development"))
    explicit_require = _explicit_auth_required()
    using_default_key = required == DEFAULT_INTERNAL_KEY
    if node_env != "production" and using_default_key and not explicit_require:
        return
    provided = request.headers.get("x-internal-key", "")
    if not hmac.compare_digest(provided.encode(), required.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing internal key")