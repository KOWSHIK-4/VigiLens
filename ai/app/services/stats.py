"""Per-stream live statistics registry.

The AI service can run several live streams at once (multiple webcams
and/or detectors). Stats must be scoped per ``(camera_id, detector)`` so
one client polling a stream never sees another stream's numbers, and a
poll with no key falls back to the most recently updated stream for
backward compatibility with single-stream clients.
"""

import threading
from typing import Any, Optional


class StreamStatsRegistry:
    def __init__(self) -> None:
        self._stats: dict[tuple[str, str], dict[str, Any]] = {}
        self._most_recent: Optional[tuple[str, str]] = None
        self._lock = threading.Lock()

    def update(self, camera_id: str, detector: str, stats: dict[str, Any]) -> None:
        key = (camera_id, detector)
        with self._lock:
            self._stats[key] = dict(stats)
            self._most_recent = key

    def get(
        self,
        camera_id: Optional[str] = None,
        detector: Optional[str] = None,
    ) -> dict[str, Any]:
        with self._lock:
            if camera_id is not None and detector is not None:
                key = (camera_id, detector)
                return dict(self._stats.get(key, {}))
            if self._most_recent is not None:
                return dict(self._stats.get(self._most_recent, {}))
            return {}

    def clear(self) -> None:
        with self._lock:
            self._stats.clear()
            self._most_recent = None


stream_stats = StreamStatsRegistry()
