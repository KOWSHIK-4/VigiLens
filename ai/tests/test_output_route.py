from fastapi.testclient import TestClient

from app.config import DEFAULT_INTERNAL_KEY
from app.main import app
from app.routes import output

client = TestClient(app)


def _stage_snapshot(tmp_path, monkeypatch, name="snap.jpg", content=b"\xff\xd8fakejpeg"):
    snap_dir = tmp_path / "output"
    snap_dir.mkdir()
    (snap_dir / name).write_bytes(content)
    monkeypatch.setattr(output, "OUTPUT_DIR", snap_dir)
    return snap_dir


def test_serves_a_staged_snapshot(tmp_path, monkeypatch):
    _stage_snapshot(tmp_path, monkeypatch)
    response = client.get("/internal/output/snap.jpg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == b"\xff\xd8fakejpeg"


def test_missing_snapshot_returns_404(tmp_path, monkeypatch):
    snap_dir = tmp_path / "output"
    snap_dir.mkdir()
    monkeypatch.setattr(output, "OUTPUT_DIR", snap_dir)
    response = client.get("/internal/output/nope.jpg")
    assert response.status_code == 404


def test_path_traversal_is_rejected(tmp_path, monkeypatch):
    _stage_snapshot(tmp_path, monkeypatch)
    # Depending on how the client/router decode these, the attempt either
    # reaches the handler (400 from the name check) or never matches the
    # route (404). Either way it must not be served.
    for name in ("..%2F..%2Fetc%2Fpasswd", "sub%2Fdir.jpg", "%2Fetc%2Fpasswd"):
        response = client.get(f"/internal/output/{name}")
        assert response.status_code in (400, 404), name
        assert b"secret" not in response.content


def test_hidden_names_are_rejected(tmp_path, monkeypatch):
    _stage_snapshot(tmp_path, monkeypatch, name=".hidden.jpg")
    response = client.get("/internal/output/.hidden.jpg")
    assert response.status_code == 400


def test_containment_check_blocks_files_outside_output_dir(tmp_path, monkeypatch):
    # A file that exists but lives beside (not inside) OUTPUT_DIR must 404,
    # proving the resolved-path containment check works even if the name
    # check were ever relaxed.
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"secret")
    snap_dir = tmp_path / "output"
    snap_dir.mkdir()
    monkeypatch.setattr(output, "OUTPUT_DIR", snap_dir)
    response = client.get("/internal/output/outside.jpg")
    assert response.status_code == 404


def test_handler_rejects_separator_and_traversal_names(tmp_path, monkeypatch):
    # The HTTP client normalizes %2F and dot-segments before the router sees
    # them, so exercise the handler's own name check directly to prove
    # separator/traversal names are refused if they ever reach it.
    import asyncio

    import pytest
    from fastapi import HTTPException

    _stage_snapshot(tmp_path, monkeypatch)
    for name in ("../secret.jpg", "sub/dir.jpg", "/etc/passwd", "..", "."):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(output.get_output_file(name))
        assert exc_info.value.status_code == 400, name


def test_requires_internal_key_when_auth_forced(tmp_path, monkeypatch):
    _stage_snapshot(tmp_path, monkeypatch)
    monkeypatch.setenv("AI_REQUIRE_AUTH", "true")
    assert client.get("/internal/output/snap.jpg").status_code == 401
    assert (
        client.get(
            "/internal/output/snap.jpg",
            headers={"X-Internal-Key": "wrong-key"},
        ).status_code
        == 401
    )
    accepted = client.get(
        "/internal/output/snap.jpg",
        headers={"X-Internal-Key": DEFAULT_INTERNAL_KEY},
    )
    assert accepted.status_code == 200
