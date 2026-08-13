import pytest

from app.services.detector import detector_service


def test_detector_catalog_lists_registered_models():
    detectors = detector_service.list()
    keys = {d["key"] for d in detectors}
    assert "person_detector" in keys
    assert "vehicle_detector" in keys


def test_detector_get_unknown_raises():
    with pytest.raises(KeyError):
        detector_service.get("does_not_exist")


def test_detector_get_defaults_to_person():
    detector = detector_service.get()
    assert detector.name == "person_detector"
