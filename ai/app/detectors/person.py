from app.detectors.yolo import YoloDetector

# COCO class 0 = person.
PERSON_CLASS_NAMES = {0: "person"}


class PersonDetector(YoloDetector):
    """Person-specific YOLO detector filtered to COCO class 0."""

    def __init__(self):
        super().__init__(
            detector_name="person_detector",
            model_name="yolo11n.pt",
            class_filter=[0],
            class_names=PERSON_CLASS_NAMES,
        )
