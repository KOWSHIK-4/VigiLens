"""Edge-case tests for AI service internal-key validation."""

import pytest

from app.config import is_insecure_internal_key


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "short",
        "dev-internal-key-change-in-production",
        "change_me_in_production_" + "x" * 32,
        "your_secret_key_" + "x" * 32,
        "dummy-key-" + "x" * 32,
    ],
)
def test_rejects_missing_short_and_placeholder_keys(value):
    assert is_insecure_internal_key(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "a" * 32,
        "VigiLens-internal-test-key-2026-abcdef",
        "0123456789abcdef0123456789abcdef",
    ],
)
def test_accepts_sufficiently_long_non_placeholder_keys(value):
    assert is_insecure_internal_key(value) is False


def test_key_validation_ignores_surrounding_whitespace():
    assert is_insecure_internal_key("  " + "x" * 32 + "  ") is False
