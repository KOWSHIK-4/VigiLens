"""Per-stream live statistics registry.

The AI service can run several live streams at once (multiple webcams
and/or detectors). Stats must be scoped per ``(camera_id, detector)`` so
one client polling a stream never sees another stream's numbers, and a
poll with no key falls back to the most recently updated *live* stream
for backward compatibility with single-stream clients.

Entries expire after a short TTL: a stream that stops updating (client
disconnected, device gone) must not serve stale numbers forever, nor
pin the "most recent" fallback to a dead stream.
"""

import threading
import time
from typing import Any, Optional

DEFAULT_STREAM_STATS_TTL_SECONDS = 30.0


class StreamStatsRegistry:
    def __init__(self, ttl_seconds: float = DEFAULT_STREAM_STATS_TTL_SECONDS) -> None:
        self._ttl_seconds = ttl_seconds
        self._stats: dict[tuple[str, str], tuple[dict[str, Any], float]] = {}
        self._most_recent: Optional[tuple[str, str]] = None
        self._lock = threading.Lock()

    def update(self, camera_id: str, detector: str, stats: dict[str, Any]) -> None:
        key = (camera_id, detector)
        now = time.monotonic()
        with self._lock:
            self._stats[key] = (dict(stats), now)
            self._most_recent = key
            self._prune(now)

    def get(
        self,
        camera_id: Optional[str] = None,
        detector: Optional[str] = None,
    ) -> dict[str, Any]:
        now = time.monotonic()
        with self._lock:
            if camera_id is not None and detector is not None:
                entry = self._stats.get((camera_id, detector))
                if entry is None or now - entry[1] > self._ttl_seconds:
                    return {}
                return dict(entry[0])
            self._prune(now)
            if (
                self._most_recent is not None
                and self._most_recent in self._stats
            ):
                return dict(self._stats[self._most_recent][0])
            return {}

    def _prune(self, now: float) -> None:
        """Drop expired entries. Caller must hold the lock."""
        expired = [key for key, (_, at) in self._stats.items() if now - at > self._ttl_seconds]
        for key in expired:
            del self._stats[key]
            if self._most_recent == key:
                self._most_recent = None

    def clear(self) -> None:
        with self._lock:
            self._stats.clear()
            self._most_recent = None


stream_stats = StreamStatsRegistry()
