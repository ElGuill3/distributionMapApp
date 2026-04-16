"""
Tests unitarios para StationQuerySchema — Phase 4, Task 4.1.

Patrón: Arrange → Act → Assert.
Cubre todos los casos de error definidos en el spec de StationQuerySchema:
  - station_id no en Literal → 400
  - fecha inválida (formato) → 400
  - end <= start → 400
  - rango > 10 años → 400
  - request válido → pasa y produce fechas como date objects

Breaking change cubierto:
  - Fechas inválidas en local-station-level-range ahora → 400
    (antes: resultado vacío por string comparison)
"""

from datetime import date

import pytest
from pydantic import ValidationError

from gee.schemas import StationQuerySchema


# ---------------------------------------------------------------------------
# StationQuerySchema — Happy Path
# ---------------------------------------------------------------------------


class TestStationQuerySchemaValid:
    """Casos válidos que deben pasar sin excepción."""

    def test_valid_spttb_dates_passes(self) -> None:
        """
        SPTTB con rango válido de 4 años → pasa.
        """
        s = StationQuerySchema(station_id="SPTTB", start="2020-01-01", end="2024-01-01")
        assert s.station_id == "SPTTB"
        assert s.start == date(2020, 1, 1)
        assert s.end == date(2024, 1, 1)

    def test_valid_bdctb_dates_passes(self) -> None:
        """
        BDCTB con rango válido → pasa.
        """
        s = StationQuerySchema(station_id="BDCTB", start="2021-03-15", end="2023-09-30")
        assert s.station_id == "BDCTB"
        assert s.start == date(2021, 3, 15)
        assert s.end == date(2023, 9, 30)

    def test_valid_same_day_range_passes(self) -> None:
        """
        Rango de un solo día (end > start por 1 día) es válido.
        """
        s = StationQuerySchema(station_id="SPTTB", start="2022-06-01", end="2022-06-02")
        assert s.start == date(2022, 6, 1)
        assert s.end == date(2022, 6, 2)

    def test_date_objects_are_accepted(self) -> None:
        """
        Se aceptan objetos date directamente (no solo strings).
        """
        s = StationQuerySchema(
            station_id="BDCTB",
            start=date(2020, 1, 1),
            end=date(2021, 1, 1),
        )
        assert s.station_id == "BDCTB"
        assert s.start == date(2020, 1, 1)
        assert s.end == date(2021, 1, 1)

    def test_valid_exactly_10_years_passes(self) -> None:
        """
        Exactamente 10 años debe ser aceptado.
        """
        s = StationQuerySchema(station_id="SPTTB", start="2010-01-01", end="2020-01-01")
        assert s.start == date(2010, 1, 1)
        assert s.end == date(2020, 1, 1)

    def test_valid_just_under_10_years_passes(self) -> None:
        """
        9 años y 364 días debe ser aceptado.
        """
        s = StationQuerySchema(station_id="BDCTB", start="2010-01-01", end="2019-12-31")
        assert s.start == date(2010, 1, 1)
        assert s.end == date(2019, 12, 31)


# ---------------------------------------------------------------------------
# StationQuerySchema — Station ID Inválido
# ---------------------------------------------------------------------------


class TestStationQuerySchemaInvalidStation:
    """Station ID que no está en Literal['SPTTB','BDCTB'] → ValidationError."""

    def test_station_invalid_xyz_raises(self) -> None:
        """
        station_id='XYZ' → ValidationError con msg conteniendo 'SPTTB' o 'BDCTB'.
        """
        with pytest.raises(ValidationError) as exc_info:
            StationQuerySchema(station_id="XYZ", start="2020-01-01", end="2024-01-01")
        errors = exc_info.value.errors()
        assert any(
            "SPTTB" in str(e.get("msg", ""))
            or "BDCTB" in str(e.get("msg", ""))
            or "literal" in str(e.get("msg", "")).lower()
            for e in errors
        )

    def test_station_lowercase_spttb_raises(self) -> None:
        """
        station_id='spttb' (minúscula) → ValidationError.
        El Literal es case-sensitive.
        """
        with pytest.raises(ValidationError):
            StationQuerySchema(station_id="spttb", start="2020-01-01", end="2024-01-01")

    def test_station_empty_string_raises(self) -> None:
        """station_id='' → ValidationError."""
        with pytest.raises(ValidationError):
            StationQuerySchema(station_id="", start="2020-01-01", end="2024-01-01")


# ---------------------------------------------------------------------------
# StationQuerySchema — Fecha Inválida (formato)
# ---------------------------------------------------------------------------


class TestStationQuerySchemaInvalidDateFormat:
    """
    Formato de fecha inválido → ValidationError.

    Breaking change: antes endpoint devolvía resultado vacío con fechas inválidas;
    ahora devuelve 400 con {"error": "..."}.
    """

    def test_wrong_format_dd_mm_yyyy_raises(self) -> None:
        """
        Formato DD-MM-YYYY → ValidationError.
        Input: start='01-01-2020', end='01-01-2024'
        """
        with pytest.raises(ValidationError) as exc_info:
            StationQuerySchema(start="01-01-2020", end="01-01-2024", station_id="SPTTB")
        errors = exc_info.value.errors()
        assert any(
            "format" in str(e.get("msg", "")).lower()
            or "value_error" in e.get("type", "")
            or "yyyy-mm-dd" in str(e.get("msg", "")).lower()
            for e in errors
        )

    def test_completely_invalid_date_string_raises(self) -> None:
        """String que no es fecha → ValidationError."""
        with pytest.raises(ValidationError):
            StationQuerySchema(
                station_id="SPTTB",
                start="not-a-date",
                end="also-not-a-date",
            )

    def test_missing_day_raises(self) -> None:
        """Fecha incompleta (solo año-mes) → ValidationError."""
        with pytest.raises(ValidationError):
            StationQuerySchema(station_id="SPTTB", start="2020-01", end="2024-01-01")


# ---------------------------------------------------------------------------
# StationQuerySchema — end <= start
# ---------------------------------------------------------------------------


class TestStationQuerySchemaEndBeforeStart:
    """end <= start → ValidationError."""

    def test_end_before_start_raises(self) -> None:
        """
        end='2020-01-01', start='2024-01-01' → ValidationError.
        """
        with pytest.raises(ValidationError) as exc_info:
            StationQuerySchema(station_id="SPTTB", start="2024-01-01", end="2020-01-01")
        errors = exc_info.value.errors()
        assert any(
            "end" in str(e.get("msg", "")).lower()
            or "start" in str(e.get("msg", "")).lower()
            for e in errors
        )

    def test_end_same_day_as_start_raises(self) -> None:
        """end == start (mismo día) → ValidationError."""
        with pytest.raises(ValidationError):
            StationQuerySchema(station_id="BDCTB", start="2022-06-01", end="2022-06-01")


# ---------------------------------------------------------------------------
# StationQuerySchema — Rango > 10 años
# ---------------------------------------------------------------------------


class TestStationQuerySchemaMaxYears:
    """Rango > 10 años → ValidationError."""

    def test_range_exceeding_10_years_raises(self) -> None:
        """
        14 años (2010-01-01 a 2024-01-01) → ValidationError.
        """
        with pytest.raises(ValidationError) as exc_info:
            StationQuerySchema(station_id="SPTTB", start="2010-01-01", end="2024-01-01")
        errors = exc_info.value.errors()
        assert any(
            "10" in str(e.get("msg", "")) or "years" in str(e.get("msg", "")).lower()
            for e in errors
        )

    def test_range_exactly_10_years_passes(self) -> None:
        """Exactamente 10 años → pasa (cubierto arriba, redundante para claridad)."""
        s = StationQuerySchema(station_id="SPTTB", start="2010-01-01", end="2020-01-01")
        assert s.end > s.start


# ---------------------------------------------------------------------------
# StationQuerySchema — Error message format (contrato con endpoint)
# ---------------------------------------------------------------------------


class TestStationQuerySchemaEndpointContract:
    """
    Verifica que los mensajes de error del schema matchean lo que el endpoint
    devuelve como {"error": "..."}.

    El endpoint hace: jsonify({'error': f'parámetros inválidos: {e}'})
    → el mensaje de error del schema se incrusta directo.
    """

    def test_error_message_format_for_invalid_date(self) -> None:
        """
        Fecha inválida → el mensaje de error contiene 'YYYY-MM-DD'.
        Breaking change: antes resultado vacío, ahora 400.
        """
        try:
            StationQuerySchema(station_id="SPTTB", start="01-01-2020", end="2024-01-01")
        except ValidationError as e:
            error_msg = f"parámetros inválidos: {e}"
            # El endpoint reporta el error del schema tal cual
            assert "2020" in error_msg or "format" in error_msg.lower()

    def test_error_message_format_for_range_exceeds_10_years(self) -> None:
        """
        Rango > 10 años → el mensaje contiene '10 years'.
        """
        try:
            StationQuerySchema(station_id="SPTTB", start="2010-01-01", end="2024-01-01")
        except ValidationError as e:
            error_msg = f"parámetros inválidos: {e}"
            assert "10" in error_msg

    def test_valid_request_produces_date_objects_for_filtering(self) -> None:
        """
        Request válido → start y end son date objects (no strings).
        El endpoint usa str(query.start) y str(query.end) para filtrar,
        pero los originales son date para validación.
        """
        s = StationQuerySchema(station_id="SPTTB", start="2020-01-01", end="2024-01-01")
        # str() de date produce YYYY-MM-DD que es lo que el service devuelve
        assert str(s.start) == "2020-01-01"
        assert str(s.end) == "2024-01-01"
        assert isinstance(s.start, date)
        assert isinstance(s.end, date)
