"""Edge-case tests for AI service internal-key validation."""

import pytest

from app.config import is_insecure_internal_key, is_production_environment


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
    # The key must not itself look like a placeholder, otherwise this case
    # asserts two different rules at once (the placeholder rule wins).
    assert is_insecure_internal_key("  " + "a" * 32 + "  ") is False


def test_key_validation_rejects_whitespace_padded_placeholder():
    assert is_insecure_internal_key("  change_me_in_production_" + "a" * 32 + "  ") is True


@pytest.mark.parametrize(
    "value",
    ["production", "Production", "PRODUCTION", "  production  "],
)
def test_production_environment_is_detected_regardless_of_case(monkeypatch, value):
    monkeypatch.setenv("NODE_ENV", value)
    assert is_production_environment() is True


def test_production_environment_honours_the_environment_alias(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "PRODUCTION")

    assert is_production_environment() is True


def test_node_env_wins_over_the_environment_alias(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("ENVIRONMENT", "production")

    assert is_production_environment() is False


def test_development_environment_is_not_production(monkeypatch):
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")

    assert is_production_environment() is False
