"""CLI guards of ``python -m backend.floodmodel``: grids and step order."""

import pytest

pytest.importorskip("rasterio")

from backend.floodmodel import __main__ as cli  # noqa: E402
from backend.floodmodel import terrain  # noqa: E402


def test_stack_rejects_a_resolution_the_rest_of_the_pipeline_cannot_read(tmp_path, capsys):
    code = cli.main(["--work-dir", str(tmp_path), "stack", "--resolution", "60"])

    assert code == 2
    assert "30 m" in capsys.readouterr().err


@pytest.mark.parametrize("step", ["cem", "terrain-aux", "gee-features", "s1-seasons"])
def test_grid_steps_require_the_terrain_mosaic_first(tmp_path, capsys, step):
    code = cli.main(["--work-dir", str(tmp_path), step])

    assert code == 1
    err = capsys.readouterr().err
    assert "dem_15m.tif" in err and "terrain-mosaic" in err


def test_terrain_condition_warns_when_running_without_the_cem_fill(tmp_path, capsys, monkeypatch):
    calls = {}

    def fake_condition(dem, aux, out_dir, *, fill=None):
        calls["fill"] = fill
        return {"dem": out_dir / "dem.tif", "bias_m": -1.6, "fill_bias_m": None}

    monkeypatch.setattr(terrain, "condition", fake_condition)

    code = cli.main(["--work-dir", str(tmp_path), "terrain-condition"])

    assert code == 0
    assert calls["fill"] is None
    assert "without the CEM" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("argv", "key", "value"),
    [
        (["terrain-mosaic"], "resolution", 15.0),
        (["cem"], "resolution", 15.0),
        (["terrain-derivatives"], "resolution", 15.0),
        (["stack"], "resolution", 30.0),
        (["stack"], "terrain_resolution", 15.0),
        (["gee-features"], "resolution", 30.0),
    ],
)
def test_documented_steps_keep_their_grid_defaults(monkeypatch, argv, key, value):
    import argparse

    seen = {}
    real = argparse.ArgumentParser.parse_args

    def capture(self, args=None, namespace=None):
        seen.update(vars(real(self, args, namespace)))
        raise SystemExit(0)

    monkeypatch.setattr(argparse.ArgumentParser, "parse_args", capture)

    with pytest.raises(SystemExit):
        cli.main(argv)
    assert seen[key] == value
