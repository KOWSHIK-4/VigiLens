from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_detectors_catalog_endpoint():
    response = client.get("/detect/detectors")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["count"] == 2


def test_detect_image_rejects_non_image_files():
    response = client.post(
        "/detect/image",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 400
