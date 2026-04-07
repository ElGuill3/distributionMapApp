"""
Tests de unidad para gee.utils (funciones puras, sin GEE ni red).

Patrón: Arrange → Act → Assert.
"""
import math
import re

import pytest

from config import BASE_PIXELS_PER_FRAME, MIN_GIF_DIM
from gee.utils import (
    check_max_10_years,
    compute_gif_dims,
    season_to_dates,
    validate_bbox,
)


# ---------------------------------------------------------------------------
# season_to_dates
# ---------------------------------------------------------------------------


class TestSeasonToDates:
    def test_primavera_2022(self) -> None:
        start, end = season_to_dates(2022, "primavera")
        assert start == "2022-03-01"
        assert end == "2022-05-31"

    def test_verano_2020(self) -> None:
        start, end = season_to_dates(2020, "verano")
        assert start == "2020-06-01"
        assert end == "2020-08-31"

    def test_otono_2023(self) -> None:
        start, end = season_to_dates(2023, "otono")
        assert start == "2023-09-01"
        assert end == "2023-11-30"

    def test_anual_2024(self) -> None:
        start, end = season_to_dates(2024, "anual")
        assert start == "2024-01-01"
        assert end == "2024-12-31"

    def test_invierno_non_leap_end_year(self) -> None:
        """Invierno 2022 termina en feb 2023; 2023 no es bisiesto → 28 días."""
        start, end = season_to_dates(2022, "invierno")
        assert start == "2022-12-01"
        assert end == "2023-02-28"

    def test_invierno_leap_end_year(self) -> None:
        """El fin de invierno cae en febrero del año siguiente; si ese año es bisiesto, 29 feb."""
        start, end = season_to_dates(2019, "invierno")
        assert start == "2019-12-01"
        assert end == "2020-02-29"

    def test_unknown_season_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="Temporada desconocida"):
            season_to_dates(2022, "desconocida")

    def test_empty_season_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="Temporada desconocida"):
            season_to_dates(2022, "")

    def test_error_message_lists_valid_options(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            season_to_dates(2022, "invalid")
        msg = str(exc_info.value)
        assert "primavera" in msg or "primavera" in repr(msg)
        assert "Opciones válidas" in msg or "invierno" in msg


# ---------------------------------------------------------------------------
# validate_bbox
# ---------------------------------------------------------------------------


class TestValidateBbox:
    def test_valid_bbox_5_by_5_degrees(self) -> None:
        bbox = [-93.0, 17.0, -88.0, 22.0]
        validate_bbox(bbox)

    def test_valid_bbox_at_max_span_8_by_8(self) -> None:
        bbox = [-93.0, 17.0, -85.0, 25.0]
        validate_bbox(bbox)

    def test_too_wide_raises(self) -> None:
        bbox = [-95.0, 17.0, -85.0, 18.0]
        with pytest.raises(ValueError, match="demasiado grande"):
            validate_bbox(bbox)

    def test_too_tall_raises(self) -> None:
        bbox = [-93.0, 15.0, -92.0, 26.0]
        with pytest.raises(ValueError, match="demasiado grande"):
            validate_bbox(bbox)

    def test_custom_max_span_allows_wider_box(self) -> None:
        bbox = [-95.0, 17.0, -85.0, 18.0]
        validate_bbox(bbox, max_span=10.0)

    def test_inverted_min_max_does_not_raise_current_behavior(self) -> None:
        """
        La implementación solo compara (max-min) con max_span; si min/max
        están invertidos, la extensión puede ser negativa y no se rechaza.
        """
        bbox = [-88.0, 22.0, -93.0, 17.0]
        validate_bbox(bbox)


# ---------------------------------------------------------------------------
# compute_gif_dims
# ---------------------------------------------------------------------------


def _parse_dims(s: str) -> tuple[int, int]:
    m = re.match(r"^(\d+)x(\d+)$", s)
    assert m is not None, f"formato inválido: {s!r}"
    return int(m.group(1)), int(m.group(2))


class TestComputeGifDims:
    def test_square_few_frames_returns_equal_width_height(self) -> None:
        dims = compute_gif_dims(10, ratio=None)
        w, h = _parse_dims(dims)
        assert w == h
        assert re.match(r"^\d+x\d+$", dims)

    def test_ratio_16_9_landscape(self) -> None:
        dims = compute_gif_dims(5, ratio=16 / 9)
        w, h = _parse_dims(dims)
        assert w > h
        assert abs((w / h) - (16 / 9)) < 0.02

    def test_ratio_4_3_landscape(self) -> None:
        dims = compute_gif_dims(1, ratio=4 / 3)
        w, h = _parse_dims(dims)
        assert w > h
        assert abs((w / h) - (4 / 3)) < 0.02

    def test_many_frames_enforces_minimum_dimension_256(self) -> None:
        dims = compute_gif_dims(1000, ratio=None)
        w, h = _parse_dims(dims)
        assert w >= MIN_GIF_DIM
        assert h >= MIN_GIF_DIM

    def test_many_frames_yields_smaller_or_equal_area_than_few_frames(self) -> None:
        """Más frames reduce el presupuesto por frame y, en general, el tamaño del GIF."""
        dims_many = compute_gif_dims(500, ratio=None)
        dims_few = compute_gif_dims(2, ratio=None)
        w_m, h_m = _parse_dims(dims_many)
        w_f, h_f = _parse_dims(dims_few)
        assert w_m * h_m <= w_f * h_f

    def test_custom_base_pixels_smaller_output(self) -> None:
        small_base = 512 * 512
        d_small = compute_gif_dims(1, ratio=None, base_pixels=small_base)
        d_default = compute_gif_dims(1, ratio=None, base_pixels=BASE_PIXELS_PER_FRAME)
        w_s, h_s = _parse_dims(d_small)
        w_d, h_d = _parse_dims(d_default)
        assert w_s * h_s <= w_d * h_d

    def test_zero_frames_uses_at_least_one_frame_for_budget(self) -> None:
        dims = compute_gif_dims(0, ratio=None)
        w, h = _parse_dims(dims)
        assert w >= MIN_GIF_DIM and h >= MIN_GIF_DIM
        assert math.isfinite(w) and math.isfinite(h)

    def test_tiny_positive_ratio_uses_safe_ratio_floor(self) -> None:
        dims = compute_gif_dims(1, ratio=1e-10)
        w, h = _parse_dims(dims)
        assert w >= MIN_GIF_DIM and h >= MIN_GIF_DIM


# ---------------------------------------------------------------------------
# check_max_10_years
# ---------------------------------------------------------------------------


class TestCheckMax10Years:
    def test_valid_one_year_range_returns_none(self) -> None:
        assert check_max_10_years("2020-01-01", "2020-12-31") is None

    def test_valid_exactly_ten_calendar_years_returns_none(self) -> None:
        assert check_max_10_years("2010-01-01", "2020-01-01") is None

    def test_exceeds_ten_years_returns_error_message(self) -> None:
        err = check_max_10_years("2010-01-01", "2020-06-01")
        assert err is not None
        assert "10" in err
        assert "años" in err or "año" in err

    def test_invalid_start_format(self) -> None:
        err = check_max_10_years("2020/01/01", "2020-12-31")
        assert err == "Formato de fecha inválido. Usa YYYY-MM-DD."

    def test_invalid_end_format(self) -> None:
        err = check_max_10_years("2020-01-01", "31-12-2020")
        assert err == "Formato de fecha inválido. Usa YYYY-MM-DD."

    def test_end_before_start(self) -> None:
        err = check_max_10_years("2020-12-31", "2020-01-01")
        assert err is not None
        assert "posterior" in err
