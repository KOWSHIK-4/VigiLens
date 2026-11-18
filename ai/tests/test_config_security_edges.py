"""Edge-case tests for AI service internal-key validation."""

import pytest

from app.config import is_insecure_internal_key, is_production_environment
from app.security import (
    AUTH_REQUIRE_FLAG,
    LEGACY_AUTH_FLAGS,
    _explicit_auth_required,
)


def _clear_auth_flags(monkeypatch):
    for flag in (AUTH_REQUIRE_FLAG, *LEGACY_AUTH_FLAGS):
        monkeypatch.delenv(flag, raising=False)


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


@pytest.mark.parametrize("value", ["true", "TRUE", "1", " true ", "\ttrue\n"])
def test_auth_flag_is_trimmed_before_comparison(monkeypatch, value):
    # " true " reads as enabled everywhere else in the config surface, so a
    # padded value must not quietly leave the internal-key guard off.
    _clear_auth_flags(monkeypatch)
    monkeypatch.setenv(AUTH_REQUIRE_FLAG, value)

    assert _explicit_auth_required() is True


@pytest.mark.parametrize("value", ["", "false", "0", "yes", "  "])
def test_auth_flag_stays_off_for_non_truthy_values(monkeypatch, value):
    _clear_auth_flags(monkeypatch)
    monkeypatch.setenv(AUTH_REQUIRE_FLAG, value)

    assert _explicit_auth_required() is False


def test_legacy_auth_flag_is_trimmed_too(monkeypatch):
    _clear_auth_flags(monkeypatch)
    monkeypatch.setenv(LEGACY_AUTH_FLAGS[0], " TRUE ")

    assert _explicit_auth_required() is True
