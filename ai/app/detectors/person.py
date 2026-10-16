from typing import Optional

from app.detectors.yolo import YoloDetector

# COCO class 0 = person.
PERSON_CLASS_NAMES = {0: "person"}


class PersonDetector(YoloDetector):
    """Person-specific YOLO detector filtered to COCO class 0."""

    def __init__(
        self,
        inference_timeout_s: Optional[float] = None,
        max_retries: Optional[int] = None,
    ):
        kwargs = {}
        if inference_timeout_s is not None:
            kwargs["inference_timeout_s"] = inference_timeout_s
        if max_retries is not None:
            kwargs["max_retries"] = max_retries
        super().__init__(
            detector_name="person_detector",
            model_name="yolo11n.pt",
            class_filter=[0],
            class_names=PERSON_CLASS_NAMES,
            **kwargs,
        )
