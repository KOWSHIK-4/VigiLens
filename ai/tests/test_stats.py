"""TTL eviction of the stream stats registry."""

from app.services.stats import StreamStatsRegistry


def test_expired_entry_returns_empty(monkeypatch):
    registry = StreamStatsRegistry(ttl_seconds=10)
    registry.update("cam-1", "person", {"fps": 12.0})

    # Simulate time passing beyond the TTL.
    clock = {"now": 1000.0}
    monkeypatch.setattr("app.services.stats.time.monotonic", lambda: clock["now"])
    registry.update("cam-1", "person", {"fps": 12.0})
    clock["now"] += 11

    assert registry.get("cam-1", "person") == {}


def test_most_recent_fallback_ignores_dead_streams(monkeypatch):
    registry = StreamStatsRegistry(ttl_seconds=10)
    clock = {"now": 0.0}
    monkeypatch.setattr("app.services.stats.time.monotonic", lambda: clock["now"])

    registry.update("cam-1", "person", {"fps": 1.0})
    clock["now"] += 5
    registry.update("cam-2", "person", {"fps": 2.0})
    clock["now"] += 6  # cam-1 entry now expired, cam-2 still fresh

    stats = registry.get()
    assert stats == {"fps": 2.0}


def test_all_streams_dead_yields_empty_stats(monkeypatch):
    registry = StreamStatsRegistry(ttl_seconds=5)
    clock = {"now": 0.0}
    monkeypatch.setattr("app.services.stats.time.monotonic", lambda: clock["now"])

    registry.update("cam-1", "person", {"fps": 1.0})
    clock["now"] += 30

    assert registry.get() == {}
    # The dead stream no longer pins internal state either.
    registry.update("cam-9", "vehicle", {"fps": 9.0})
    assert registry.get() == {"fps": 9.0}


def test_live_entry_still_served_within_ttl():
    registry = StreamStatsRegistry(ttl_seconds=30)
    registry.update("cam-1", "person", {"fps": 20.0})
    assert registry.get("cam-1", "person") == {"fps": 20.0}
    assert registry.get() == {"fps": 20.0}
