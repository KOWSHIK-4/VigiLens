"""Tests for the numeric settings read from the environment."""

import pytest

from app.config import Settings


@pytest.fixture(autouse=True)
def _development_environment(monkeypatch):
    # Keep the production fail-fast out of the way: these tests are about
    # how the numeric settings are parsed, not about the shared secret.
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("BACKEND_INTERNAL_KEY", "a" * 32)


def test_valid_numeric_values_are_used(monkeypatch):
    monkeypatch.setenv("CONFIDENCE_THRESHOLD", "0.75")
    monkeypatch.setenv("CAPTURE_OPEN_TIMEOUT_MS", "1500")
    monkeypatch.setenv("INFERENCE_TIMEOUT_S", "12.5")
    monkeypatch.setenv("INFERENCE_MAX_RETRIES", "5")

    settings = Settings()

    assert settings.confidence_threshold == 0.75
    assert settings.capture_open_timeout_ms == 1500
    assert settings.inference_timeout_s == 12.5
    assert settings.inference_max_retries == 5


@pytest.mark.parametrize(
    "value",
    ["not-a-number", "", "   ", "5s", "12,5"],
)
def test_malformed_values_fall_back_to_the_default(monkeypatch, value):
    monkeypatch.setenv("CAPTURE_OPEN_TIMEOUT_MS", value)

    assert Settings().capture_open_timeout_ms == 5000


def test_non_finite_values_fall_back_to_the_default(monkeypatch):
    # float() parses "nan" and "inf" happily; neither is a usable timeout.
    monkeypatch.setenv("INFERENCE_TIMEOUT_S", "nan")
    monkeypatch.setenv("CONFIDENCE_THRESHOLD", "inf")

    settings = Settings()

    assert settings.inference_timeout_s == 30.0
    assert settings.confidence_threshold == 0.5


def test_out_of_range_values_fall_back_to_the_default(monkeypatch):
    monkeypatch.setenv("CONFIDENCE_THRESHOLD", "1.5")
    monkeypatch.setenv("INFERENCE_TIMEOUT_S", "0")
    monkeypatch.setenv("INFERENCE_MAX_RETRIES", "-3")

    settings = Settings()

    assert settings.confidence_threshold == 0.5
    assert settings.inference_timeout_s == 30.0
    assert settings.inference_max_retries == 2


def test_negative_capture_timeout_falls_back_to_the_default(monkeypatch):
    # A negative timeout reads as "no timeout" downstream, which drops the
    # bound that keeps a dead camera from blocking the caller.
    monkeypatch.setenv("CAPTURE_OPEN_TIMEOUT_MS", "-1")

    assert Settings().capture_open_timeout_ms == 5000


def test_capture_timeout_of_zero_still_disables_the_timeout(monkeypatch):
    monkeypatch.setenv("CAPTURE_OPEN_TIMEOUT_MS", "0")

    assert Settings().capture_open_timeout_ms == 0
