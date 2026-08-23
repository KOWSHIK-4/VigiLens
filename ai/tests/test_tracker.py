from app.services.tracker import IouTracker, iou


def test_iou_identical_boxes_is_one():
    box = (0, 0, 10, 10)
    assert iou(box, box) == 1.0


def test_iou_disjoint_boxes_is_zero():
    assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0


def test_iou_partial_overlap_is_between_zero_and_one():
    overlap = iou((0, 0, 10, 10), (5, 0, 15, 10))
    assert 0 < overlap < 1


def test_tracker_keeps_stable_id_across_frames():
    tracker = IouTracker()
    det = {
        "class_name": "person",
        "confidence": 0.9,
        "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
    }
    first = tracker.update([det])[0]
    second = tracker.update([det])[0]
    assert first["track_id"] == second["track_id"]


def test_tracker_assigns_new_id_for_new_object():
    tracker = IouTracker()
    a = [
        {
            "class_name": "person",
            "confidence": 0.9,
            "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
        }
    ]
    b = [
        {
            "class_name": "person",
            "confidence": 0.9,
            "bbox": {"x1": 100, "y1": 100, "x2": 110, "y2": 110},
        }
    ]
    id_a = tracker.update(a)[0]["track_id"]
    id_b = tracker.update(b)[0]["track_id"]
    assert id_a != id_b


def test_tracker_keeps_different_classes_separate():
    tracker = IouTracker()
    person = [
        {
            "class_name": "person",
            "confidence": 0.9,
            "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
        }
    ]
    car = [
        {
            "class_name": "car",
            "confidence": 0.9,
            "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
        }
    ]
    assert tracker.update(person)[0]["track_id"] != tracker.update(car)[0]["track_id"]


def test_tracker_expires_tracks_after_max_misses():
    tracker = IouTracker(max_misses=2)
    det = {
        "class_name": "person",
        "confidence": 0.9,
        "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
    }
    tracker.update([det])
    assert tracker.active_count == 1
    for _ in range(3):
        tracker.update([])
    assert tracker.active_count == 0


def test_tracker_reset_clears_tracks():
    tracker = IouTracker()
    det = {"class_name": "person", "confidence": 0.9, "bbox": (0, 0, 10, 10)}
    tracker.update([det])
    assert tracker.active_count == 1
    tracker.reset()
    assert tracker.active_count == 0


def test_tracker_duplicate_detections_cannot_share_a_track():
    tracker = IouTracker()
    tracker.update(
        [
            {
                "class_name": "person",
                "confidence": 0.9,
                "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
            }
        ]
    )
    # Two heavily overlapping detections on one frame: only the first may
    # claim the existing identity, the second must spawn its own.
    frame = tracker.update(
        [
            {
                "class_name": "person",
                "confidence": 0.9,
                "bbox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10},
            },
            {
                "class_name": "person",
                "confidence": 0.9,
                "bbox": {"x1": 1, "y1": 1, "x2": 11, "y2": 11},
            },
        ]
    )
    assert frame[0]["track_id"] != frame[1]["track_id"]


def test_tracker_rematching_resets_misses():
    tracker = IouTracker(max_misses=2)
    det = {
        "class_name": "person",
        "confidence": 0.9,
        "bbox": (0, 0, 10, 10),
    }
    tracker.update([det])
    tracker.update([])  # misses = 1
    tracker.update([det])  # re-matched: miss counter resets
    tracker.update([])  # misses = 1
    tracker.update([])  # misses = 2, still within max_misses
    assert tracker.active_count == 1
