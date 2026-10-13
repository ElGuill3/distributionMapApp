"""Launcher scripts live in backend/scripts and still resolve the checkout root."""

from pathlib import Path

import pytest

from backend.scripts.run_local_forecast_stack import ROOT, LauncherError, resolve_app_root

REPO = Path(__file__).resolve().parents[2]


def test_launcher_root_is_the_checkout_and_root_scripts_dir_is_gone():
    assert ROOT == REPO
    assert not (REPO / "scripts").exists()


@pytest.mark.parametrize("start", ["", "backend/tests", "backend/scripts"])
def test_resolve_app_root_from_inside_the_checkout(start):
    assert resolve_app_root(REPO / start) == REPO


def test_resolve_app_root_outside_a_checkout_fails():
    outside = Path(REPO.anchor)
    with pytest.raises(
        LauncherError, match="run the command from a distributionMapApp checkout"
    ):
        resolve_app_root(outside, source_root=outside)
