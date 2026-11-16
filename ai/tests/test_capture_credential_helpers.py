"""Credential helper tests for camera source URLs."""

from urllib.parse import unquote, urlsplit

from app.services.capture import merge_source_credentials, redact_source


def test_merge_credentials_leaves_source_unchanged_when_incomplete():
    source = "rtsp://camera.example/live"

    assert merge_source_credentials(source, "operator", None) == source
    assert merge_source_credentials(source, None, "secret") == source


def test_merge_credentials_does_not_duplicate_existing_userinfo():
    source = "rtsp://existing:credential@camera.example/live"

    assert merge_source_credentials(source, "new-user", "new-pass") == source


def test_merge_credentials_percent_encodes_structural_characters():
    # A raw password holding URL-structural characters splits the URL: the
    # host is lost and the tail of the secret lands in the path.
    source = "rtsp://camera.example:554/live"

    merged = merge_source_credentials(source, "stream user", "p@ss/word?x#y")

    parts = urlsplit(merged)
    assert parts.hostname == "camera.example"
    assert parts.port == 554
    assert parts.path == "/live"
    assert parts.query == ""
    assert parts.fragment == ""
    assert unquote(parts.username) == "stream user"
    assert unquote(parts.password) == "p@ss/word?x#y"


def test_merge_credentials_keeps_the_secret_out_of_the_path():
    merged = merge_source_credentials(
        "rtsp://camera.example/live", "operator", "p@ss/word"
    )

    assert "p@ss/word" not in merged
    assert urlsplit(merged).path == "/live"


def test_merge_credentials_encodes_the_username_too():
    merged = merge_source_credentials(
        "http://camera.example/snapshot.jpg", "stream user", "secret"
    )

    parts = urlsplit(merged)
    assert unquote(parts.username) == "stream user"
    assert parts.hostname == "camera.example"
    assert parts.path == "/snapshot.jpg"


def test_redaction_does_not_change_url_without_credentials():
    source = "rtsp://camera.example:554/live"

    assert redact_source(source) == source


def test_redaction_masks_password_but_preserves_username_and_host():
    source = "rtsp://operator:private-password@camera.example:554/live"

    assert redact_source(source) == "rtsp://operator:***@camera.example:554/live"
    assert "private-password" not in redact_source(source)


def test_redaction_strips_passwords_containing_at_signs():
    source = "rtsp://operator:p@ss@camera.example:554/live"
    assert redact_source(source) == "rtsp://operator:***@camera.example:554/live"
    assert "p@ss" not in redact_source(source)


def test_redaction_strips_passwords_containing_spaces():
    source = "rtsp://operator:pa ss@camera.example:554/live"
    assert redact_source(source) == "rtsp://operator:***@camera.example:554/live"
    assert "pa ss" not in redact_source(source)
