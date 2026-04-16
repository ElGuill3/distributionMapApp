"""
Tests unitarios para gee/schemas.py — BBoxSchema y DateRangeSchema.

Patrón: Arrange → Act → Assert.
Cubre happy path y todos los casos de error definidos en el spec.
"""

import json
from datetime import date

import pytest
from pydantic import ValidationError

from gee.schemas import BBoxSchema, DateRangeSchema, _parse_bbox_str


# ---------------------------------------------------------------------------
# _parse_bbox_str
# ---------------------------------------------------------------------------


class TestParseBboxStr:
    def test_valid_json_array_returns_list_of_floats(self) -> None:
        result = _parse_bbox_str("[-110.5, 32.0, -90.0, 45.0]")
        assert result == [-110.5, 32.0, -90.0, 45.0]

    def test_integer_values_are_cast_to_float(self) -> None:
        result = _parse_bbox_str("[-100, 20, -80, 40]")
        assert result == [-100.0, 20.0, -80.0, 40.0]

    def test_not_a_json_array_raises(self) -> None:
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str('"not an array"')

    def test_not_exactly_4_elements_raises(self) -> None:
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str("[-110.5, 32.0, -90.0]")

    def test_non_numeric_values_raises(self) -> None:
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str('["a", "b", "c", "d"]')

    def test_invalid_json_raises(self) -> None:
        with pytest.raises(json.JSONDecodeError):
            _parse_bbox_str("not json at all")


# ---------------------------------------------------------------------------
# BBoxSchema
# ---------------------------------------------------------------------------


class TestBBoxSchemaValid:
    def test_valid_bbox_passes_validation(self) -> None:
        bbox = BBoxSchema(min_lon=-110.5, min_lat=32.0, max_lon=-90.0, max_lat=45.0)
        assert bbox.min_lon == -110.5
        assert bbox.min_lat == 32.0
        assert bbox.max_lon == -90.0
        assert bbox.max_lat == 45.0

    def test_bbox_at_exact_boundaries_passes(self) -> None:
        """Coordenadas en los límites exactos de [-180,180] y [-90,90] son válidas."""
        bbox = BBoxSchema(min_lon=-180.0, min_lat=-90.0, max_lon=180.0, max_lat=90.0)
        assert bbox.min_lon == -180.0
        assert bbox.max_lat == 90.0


class TestBBoxSchemaInvalidLon:
    def test_min_lon_out_of_range_below_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=-200.0, min_lat=0.0, max_lon=0.0, max_lat=90.0)
        assert "min_lon" in str(exc_info.value)

    def test_min_lon_out_of_range_above_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=200.0, min_lat=0.0, max_lon=180.0, max_lat=90.0)
        assert "min_lon" in str(exc_info.value)

    def test_max_lon_out_of_range_below_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=-180.0, min_lat=0.0, max_lon=-200.0, max_lat=90.0)
        assert "max_lon" in str(exc_info.value)

    def test_max_lon_out_of_range_above_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=-180.0, min_lat=0.0, max_lon=200.0, max_lat=90.0)
        assert "max_lon" in str(exc_info.value)


class TestBBoxSchemaInvalidLat:
    def test_min_lat_out_of_range_below_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=0.0, min_lat=-100.0, max_lon=180.0, max_lat=90.0)
        assert "min_lat" in str(exc_info.value)

    def test_min_lat_out_of_range_above_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=0.0, min_lat=100.0, max_lon=180.0, max_lat=90.0)
        assert "min_lat" in str(exc_info.value)

    def test_max_lat_out_of_range_below_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=0.0, min_lat=-90.0, max_lon=180.0, max_lat=-100.0)
        assert "max_lat" in str(exc_info.value)

    def test_max_lat_out_of_range_above_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=0.0, min_lat=-90.0, max_lon=180.0, max_lat=100.0)
        assert "max_lat" in str(exc_info.value)


class TestBBoxSchemaInvertedBounds:
    def test_min_lon_greater_than_max_lon_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=-90.0, min_lat=32.0, max_lon=-110.5, max_lat=45.0)
        errors = exc_info.value.errors()
        assert any(
            "min_lon" in str(e["msg"]).lower() or "max_lon" in str(e["msg"]).lower()
            for e in errors
        )

    def test_min_lat_greater_than_max_lat_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(min_lon=-110.5, min_lat=45.0, max_lon=-90.0, max_lat=32.0)
        errors = exc_info.value.errors()
        assert any(
            "min_lat" in str(e["msg"]).lower() or "max_lat" in str(e["msg"]).lower()
            for e in errors
        )

    def test_min_lon_equal_to_max_lon_raises(self) -> None:
        with pytest.raises(ValidationError):
            BBoxSchema(min_lon=-100.0, min_lat=32.0, max_lon=-100.0, max_lat=45.0)

    def test_min_lat_equal_to_max_lat_raises(self) -> None:
        with pytest.raises(ValidationError):
            BBoxSchema(min_lon=-110.5, min_lat=32.0, max_lon=-90.0, max_lat=32.0)


# ---------------------------------------------------------------------------
# DateRangeSchema
# ---------------------------------------------------------------------------


class TestDateRangeSchemaValid:
    def test_valid_date_range_passes(self) -> None:
        dr = DateRangeSchema(start="2020-01-01", end="2024-01-01")
        assert dr.start == date(2020, 1, 1)
        assert dr.end == date(2024, 1, 1)

    def test_valid_date_range_same_year_passes(self) -> None:
        dr = DateRangeSchema(start="2022-03-01", end="2022-09-30")
        assert dr.start == date(2022, 3, 1)
        assert dr.end == date(2022, 9, 30)

    def test_date_objects_are_accepted(self) -> None:
        dr = DateRangeSchema(start=date(2021, 6, 1), end=date(2021, 12, 31))
        assert dr.start == date(2021, 6, 1)
        assert dr.end == date(2021, 12, 31)


class TestDateRangeSchemaEndBeforeStart:
    def test_end_before_start_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2024-01-01", end="2020-01-01")
        errors = exc_info.value.errors()
        assert any(
            "end" in str(e["msg"]).lower() or "start" in str(e["msg"]).lower()
            for e in errors
        )

    def test_end_same_day_as_start_raises(self) -> None:
        with pytest.raises(ValidationError):
            DateRangeSchema(start="2022-06-01", end="2022-06-01")


class TestDateRangeSchemaMaxYears:
    def test_range_exceeding_10_years_raises(self) -> None:
        """14 años de rango (2010-01-01 a 2024-01-01) debe ser rechazado."""
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2010-01-01", end="2024-01-01")
        errors = exc_info.value.errors()
        assert any(
            "10" in str(e["msg"]) or "years" in str(e["msg"]).lower() for e in errors
        )

    def test_range_exactly_10_years_passes(self) -> None:
        """Exactamente 10 años debe ser aceptado."""
        dr = DateRangeSchema(start="2010-01-01", end="2020-01-01")
        assert dr.start == date(2010, 1, 1)
        assert dr.end == date(2020, 1, 1)

    def test_range_slightly_under_10_years_passes(self) -> None:
        """9 años y 364 días debe ser aceptado."""
        dr = DateRangeSchema(start="2010-01-01", end="2019-12-31")
        assert dr.start == date(2010, 1, 1)
        assert dr.end == date(2019, 12, 31)


class TestDateRangeSchemaInvalidFormat:
    def test_wrong_format_dd_mm_yyyy_raises(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="01-01-2020", end="01-01-2024")
        errors = exc_info.value.errors()
        assert any(
            "format" in str(e["msg"]).lower() or "value_error" in e["type"]
            for e in errors
        )

    def test_completely_invalid_format_raises(self) -> None:
        with pytest.raises(ValidationError):
            DateRangeSchema(start="not-a-date", end="also-not-a-date")

    def test_missing_day_raises(self) -> None:
        with pytest.raises(ValidationError):
            DateRangeSchema(start="2020-01", end="2024-01-01")
