"""CORS configuration must agree with the production-environment helper.

``app.config.is_production_environment`` normalises case and surrounding
whitespace. ``app.main`` used to compare the raw ``NODE_ENV`` string instead,
so a deployment that plainly asked for production (``Production``) kept the
development wildcard CORS origin and skipped the explicit-origin fail-fast.
"""

import runpy
from pathlib import Path

import pytest

MAIN_PATH = Path(__file__).resolve().parent.parent / "app" / "main.py"


@pytest.fixture(autouse=True)
def _production_like_secret(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("NODE_ENV", " Production ")
    monkeypatch.setenv("BACKEND_INTERNAL_KEY", "a" * 32)


def _run_main() -> dict:
    return runpy.run_path(str(MAIN_PATH), run_name="vigilens_main_probe")


def test_mixed_case_production_removes_the_wildcard_origin(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com,*")

    module = _run_main()

    assert module["_is_production"] is True
    assert module["_cors_origins"] == ["https://app.example.com"]


def test_mixed_case_production_refuses_a_wildcard_only_allow_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")

    with pytest.raises(SystemExit):
        _run_main()
