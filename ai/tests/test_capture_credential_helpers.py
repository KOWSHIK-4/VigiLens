"""Credential helper tests for camera source URLs."""

from app.services.capture import merge_source_credentials, redact_source


def test_merge_credentials_leaves_source_unchanged_when_incomplete():
    source = "rtsp://camera.example/live"

    assert merge_source_credentials(source, "operator", None) == source
    assert merge_source_credentials(source, None, "secret") == source


def test_merge_credentials_does_not_duplicate_existing_userinfo():
    source = "rtsp://existing:credential@camera.example/live"

    assert merge_source_credentials(source, "new-user", "new-pass") == source


def test_redaction_does_not_change_url_without_credentials():
    source = "rtsp://camera.example:554/live"

    assert redact_source(source) == source


def test_redaction_masks_password_but_preserves_username_and_host():
    source = "rtsp://operator:private-password@camera.example:554/live"

    assert redact_source(source) == "rtsp://operator:***@camera.example:554/live"
    assert "private-password" not in redact_source(source)
