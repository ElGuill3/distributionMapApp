"""The Spanish report quotes the published validation and municipality stats."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "odd" / "reports" / "flood-susceptibility-model.md"
DATA = ROOT / "backend" / "data" / "flood_risk"


def _metadata():
    return json.loads((DATA / "metadata.json").read_text(encoding="utf-8"))


def _municipalities():
    data = json.loads((DATA / "municipalities.geojson").read_text(encoding="utf-8"))
    return [f["properties"] for f in data["features"]]


def test_summary_table_matches_published_validation():
    text = REPORT.read_text(encoding="utf-8")
    scores = _metadata()["validation"]
    for source in ("ensemble", "jrc_rp100", "low_elevation", "ipcet_pnud_2022"):
        for event in ("cenapred_2011", "s1_2023", "s1_2024", "s1_2025"):
            s = scores[source][event]
            assert f"{s['roc_auc']:.3f}" in text and f"{s['pr_auc']:.3f}" in text, (
                source,
                event,
            )


def test_municipality_table_matches_published_stats():
    text = REPORT.read_text(encoding="utf-8")
    for p in _municipalities():
        area = f"{round(p['area_km2']):,}".replace(",", " ")
        row = f"| {p['rank']} | "
        line = next(
            line for line in text.splitlines() if line.startswith(row) and area in line
        )
        assert f"{round(p['high_share'] * 100)} %" in line, p["name"]


def test_published_stats_cover_seventeen_municipalities():
    stats = _municipalities()
    assert len(stats) == 17
    for p in stats:
        assert abs(sum(p["class_share"]) - 1) < 5e-4


def test_metadata_credits_every_terrain_source():
    sources = " ".join(_metadata()["sources"])
    assert "LiDAR" in sources and "Continuo de Elevaciones Mexicano" in sources


def test_readme_validation_claims_match_published_scores():
    scores = _metadata()["validation"]
    claims = {
        "ensemble": scores["ensemble"]["cenapred_2011"]["roc_auc"],
        "jrc": scores["jrc_rp100"]["cenapred_2011"]["roc_auc"],
        "ipcet": scores["ipcet_pnud_2022"]["cenapred_2011"]["roc_auc"],
    }
    for readme, decimal in (("README.en.md", "."), ("README.md", ",")):
        text = (ROOT / readme).read_text(encoding="utf-8")
        for name, value in claims.items():
            assert f"{value:.3f}".replace(".", decimal) in text, (readme, name)


def test_capture_table_matches_published_validation():
    lines = REPORT.read_text(encoding="utf-8").splitlines()
    scores = _metadata()["validation"]
    # Map name as written in the first column of the capture table.
    names = {
        "ensemble": "**Ensamble**",
        "jrc_rp100": "JRC 100 años",
        "low_elevation": "Elevación",
        "ipcet_pnud_2022": "IPCET-PNUD 2022",
    }
    events = ("cenapred_2011", "s1_2023", "s1_2024", "s1_2025")
    for source, name in names.items():
        rows = [
            line
            for line in lines
            if line.startswith(f"| {name} | ") and line.count("|") == 7
        ]
        assert len(rows) == 1, f"no single capture-table row for {name!r}"
        # Columns: map | area share of the top classes | one capture per event.
        cells = [c.strip(" *\\") for c in rows[0].split("|")[1:-1]]
        area, captures = cells[1], cells[2:]
        expected_area = round(scores[source]["s1_2023"]["top40_area_share"] * 100)
        assert area == f"{expected_area} %", source
        expected = [
            f"{round(scores[source][e]['top40_capture'] * 100)} %" for e in events
        ]
        assert captures == expected, source
