"""Additional edge-case coverage for the lightweight IoU tracker."""

from app.services.tracker import IouTracker, iou


def test_iou_zero_area_boxes_return_zero():
    assert iou((1, 1, 1, 5), (1, 1, 5, 5)) == 0.0
    assert iou((5, 5, 1, 1), (0, 0, 10, 10)) == 0.0


def test_empty_frame_increments_misses_without_creating_tracks():
    tracker = IouTracker(max_misses=2)

    assert tracker.update([]) == []
    assert tracker.active_count == 0


def test_track_is_retained_at_max_misses_and_removed_afterward():
    tracker = IouTracker(max_misses=1)
    detection = {
        "class_name": "person",
        "confidence": 0.8,
        "bbox": (0, 0, 10, 10),
    }

    tracker.update([detection])
    tracker.update([])
    assert tracker.active_count == 1

    tracker.update([])
    assert tracker.active_count == 0


def test_dictionary_and_tuple_bboxes_can_match_same_track():
    tracker = IouTracker()
    first = {
        "class_name": "person",
        "confidence": 0.8,
        "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
    }
    next_frame = {
        "class_name": "person",
        "confidence": 0.9,
        "bbox": (0, 0, 10, 10),
    }

    first_id = tracker.update([first])[0]["track_id"]
    next_id = tracker.update([next_frame])[0]["track_id"]

    assert next_id == first_id
