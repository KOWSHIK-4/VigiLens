"""Defensive-copy tests for per-stream statistics."""

from app.services.stats import StreamStatsRegistry


def test_update_copies_input_dictionary():
    registry = StreamStatsRegistry()
    supplied = {"fps": 24.0, "frames": 10}

    registry.update("camera-a", "person", supplied)
    supplied["fps"] = 0.0
    supplied["new_field"] = True

    assert registry.get("camera-a", "person") == {"fps": 24.0, "frames": 10}


def test_get_returns_copy_not_internal_dictionary():
    registry = StreamStatsRegistry()
    registry.update("camera-a", "person", {"fps": 24.0})

    result = registry.get("camera-a", "person")
    result["fps"] = -1.0

    assert registry.get("camera-a", "person") == {"fps": 24.0}


def test_clear_removes_keyed_and_fallback_stats():
    registry = StreamStatsRegistry()
    registry.update("camera-a", "person", {"fps": 24.0})
    registry.update("camera-b", "vehicle", {"fps": 12.0})

    registry.clear()

    assert registry.get("camera-a", "person") == {}
    assert registry.get() == {}
