"""Tests for the annotated-output directory pruning."""

import os
from pathlib import Path

from app.routes import detection


def _write_snapshot(directory: Path, name: str, mtime: float) -> Path:
    path = directory / name
    path.write_bytes(b"jpeg")
    os.utime(path, (mtime, mtime))
    return path


def test_prune_removes_the_oldest_snapshots_beyond_the_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(detection, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(detection, "_MAX_OUTPUT_FILES", 2)

    _write_snapshot(tmp_path, "old.jpg", 1000.0)
    _write_snapshot(tmp_path, "middle.jpg", 2000.0)
    _write_snapshot(tmp_path, "new.jpg", 3000.0)

    detection._prune_output_dir()

    assert sorted(p.name for p in tmp_path.iterdir()) == ["middle.jpg", "new.jpg"]


def test_prune_survives_a_file_that_vanishes_mid_scan(tmp_path, monkeypatch):
    # A file can disappear between the directory listing and the stat.
    # The sweep must still bring the directory back under the cap.
    monkeypatch.setattr(detection, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(detection, "_MAX_OUTPUT_FILES", 2)

    _write_snapshot(tmp_path, "a.jpg", 1000.0)
    _write_snapshot(tmp_path, "b.jpg", 2000.0)
    _write_snapshot(tmp_path, "c.jpg", 3000.0)

    real_stat = Path.stat

    def flaky_stat(self, *args, **kwargs):
        if self.name == "b.jpg":
            raise FileNotFoundError(self)
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", flaky_stat)

    detection._prune_output_dir()

    assert len(list(tmp_path.iterdir())) == 2


def test_prune_ignores_a_missing_output_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(detection, "OUTPUT_DIR", tmp_path / "absent")

    detection._prune_output_dir()

    assert not (tmp_path / "absent").exists()
