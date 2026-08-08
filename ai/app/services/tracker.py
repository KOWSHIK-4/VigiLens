"""Lightweight IoU object tracker for live streams.

Assigns a stable track_id to detections that persist across frames so the
backend and UI can group detections by identity. Deterministic and free of
external tracker dependencies.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class Track:
    id: int
    bbox: Tuple[int, int, int, int]
    cls: str
    misses: int = 0
    hits: int = 1


def iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return 0.0 if union <= 0 else inter / union


class IouTracker:
    def __init__(self, match_iou: float = 0.35, max_misses: int = 30):
        self._match_iou = match_iou
        self._max_misses = max_misses
        self._tracks: Dict[int, Track] = {}
        self._next_id = 0

    def update(self, detections: List[dict]) -> List[dict]:
        """Detections: list of dicts with class_name, confidence, bbox."""
        result: List[dict] = []
        matched: set[int] = set()

        for det in detections:
            cls = det["class_name"]
            bbox = tuple(int(v) for v in det["bbox"])
            best_id: Optional[int] = None
            best_iou = self._match_iou
            for track_id, track in self._tracks.items():
                if track.cls != cls:
                    continue
                overlap = iou(track.bbox, bbox)
                if overlap >= best_iou:
                    best_iou = overlap
                    best_id = track_id

            if best_id is None:
                track_id = self._next_id
                self._next_id += 1
                self._tracks[track_id] = Track(id=track_id, bbox=bbox, cls=cls)
            else:
                track_id = best_id
                matched.add(track_id)
                self._tracks[track_id].bbox = bbox
                self._tracks[track_id].hits += 1

            result.append({**det, "track_id": str(track_id)})

        for track_id, track in list(self._tracks.items()):
            if track_id not in matched:
                track.misses += 1
                if track.misses > self._max_misses:
                    del self._tracks[track_id]

        return result

    def reset(self) -> None:
        self._tracks.clear()
        self._next_id = 0

    @property
    def active_count(self) -> int:
        return len(self._tracks)
