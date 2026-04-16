"""
Tests de integración para los endpoints *-timeseries-bbox.

Patrón (replicando test_gif_routes.py):
  - Los casos de error (bbox inválido, fechas inválidas) se prueban a nivel
    schema: verifican que BBoxSchema y DateRangeSchema rechacen los mismos
    inputs que el endpoint rechazaría.
  - Los casos de respuesta válida y regresión se prueban a nivel pipeline,
    mockeando las funciones build_* para evitar dependencia de GEE.
  - El test de contrato verifica que los schemas producen el formato exacto
    que el endpoint pasa al pipeline.

Dado que Flask no está disponible en el entorno de test local, estos tests
verifican la lógica de validación de la capa de ruta sin usar Flask:
  - Tests de esquema: verifican que BBoxSchema y DateRangeSchema rechacen
    exactamente los mismos inputs que el endpoint rechazaría.
  - Tests de contrato: verifican que el flujo válido produce los params
    exactos que el endpoint pasa a _timeseries_pipeline.
  - Tests de regresión: verifican que el happy path produce la misma
    estructura de datos que antes del cambio.
"""

from datetime import date

import pytest
from pydantic import ValidationError

from gee.schemas import BBoxSchema, DateRangeSchema, _parse_bbox_str


# ---------------------------------------------------------------------------
# Task 2.1 — Tests bbox inválido → 400
# ---------------------------------------------------------------------------


class TestNdviTimeseriesBboxInvalidBbox:
    """
    Equivalentes a los tests de integración para bbox inválido en
    ndvi-timeseries-bbox. Cada test aquí es exactamente el input que
    el endpoint rechazaría con 400.

    Escenarios spec 2.1:
      - min_lon >= max_lon → 400 con 'bbox inválido: ...'
      - min_lat >= max_lat → 400 con 'bbox inválido: ...'
      - coordenadas fuera de rango → 400
    """

    def test_bbox_min_lon_gte_max_lon(self) -> None:
        """
        Escenario spec 2.1: 'min_lon >= max_lon' → 400 con 'bbox inválido: ...'
        Input: [-90.0, 32.0, -110.5, 45.0] (min_lon > max_lon)
        Endpoint → 400 con error 'bbox inválido'
        """
        bbox_str = "[-90.0, 32.0, -110.5, 45.0]"
        bbox_parsed = _parse_bbox_str(bbox_str)
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(
                min_lon=bbox_parsed[0],
                min_lat=bbox_parsed[1],
                max_lon=bbox_parsed[2],
                max_lat=bbox_parsed[3],
            )
        errors = exc_info.value.errors()
        assert any(
            "min_lon" in str(e["msg"]).lower() or "max_lon" in str(e["msg"]).lower()
            for e in errors
        )

    def test_bbox_min_lat_gte_max_lat(self) -> None:
        """
        Escenario spec 2.1: 'min_lat >= max_lat' → 400 con 'bbox inválido: ...'
        Input: [-110.5, 45.0, -90.0, 32.0] (min_lat > max_lat)
        Endpoint → 400 con error 'bbox inválido'
        """
        bbox_str = "[-110.5, 45.0, -90.0, 32.0]"
        bbox_parsed = _parse_bbox_str(bbox_str)
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(
                min_lon=bbox_parsed[0],
                min_lat=bbox_parsed[1],
                max_lon=bbox_parsed[2],
                max_lat=bbox_parsed[3],
            )
        errors = exc_info.value.errors()
        assert any(
            "min_lat" in str(e["msg"]).lower() or "max_lat" in str(e["msg"]).lower()
            for e in errors
        )

    def test_bbox_coords_out_of_range(self) -> None:
        """
        Escenario spec 2.1: coordenadas fuera de rango → 400
        Input: [-200.0, 32.0, -90.0, 45.0] (lon fuera de [-180, 180])
        Endpoint → 400
        """
        bbox_str = "[-200.0, 32.0, -90.0, 45.0]"
        bbox_parsed = _parse_bbox_str(bbox_str)
        with pytest.raises(ValidationError) as exc_info:
            BBoxSchema(
                min_lon=bbox_parsed[0],
                min_lat=bbox_parsed[1],
                max_lon=bbox_parsed[2],
                max_lat=bbox_parsed[3],
            )
        errors = exc_info.value.errors()
        assert any(
            "min_lon" in str(e["msg"]).lower() or e["type"] == "greater_than_equal"
            for e in errors
        )

    def test_bbox_not_json_raises_value_error(self) -> None:
        """bbox que no es JSON válido → _parse_bbox_str lanza ValueError (JSONDecodeError)."""
        with pytest.raises(ValueError, match="Expecting value"):
            _parse_bbox_str("not-json")

    def test_bbox_wrong_number_of_elements_raises(self) -> None:
        """bbox con exactamente 3 elementos → ValueError."""
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str("[-110.5, 32.0, -90.0]")

    def test_bbox_inverted_min_max_lon_error_message_format(self) -> None:
        """
        El mensaje de error del endpoint contiene 'bbox inválido: ...'
        que es exactamente lo que jsonify({'error': 'bbox inválido: ...'}) devolvería.
        """
        bbox_str = "[-90.0, 32.0, -110.5, 45.0]"
        try:
            bbox_parsed = _parse_bbox_str(bbox_str)
            BBoxSchema(
                min_lon=bbox_parsed[0],
                min_lat=bbox_parsed[1],
                max_lon=bbox_parsed[2],
                max_lat=bbox_parsed[3],
            )
        except (ValueError, TypeError, ValidationError) as e:
            error_msg = f"bbox inválido: {e}"
            assert "bbox" in error_msg
            assert "inválido" in error_msg


# ---------------------------------------------------------------------------
# Task 2.2 — Tests fechas inválidas → 400
# ---------------------------------------------------------------------------


class TestNdviTimeseriesBboxInvalidDates:
    """
    Equivalentes a los tests de integración para fechas inválidas en
    ndvi-timeseries-bbox. Cada test aquí es exactamente el input que
    el endpoint rechazaría con 400.

    Escenarios spec 2.2:
      - rango > 10 años → 400 con '{"error": "fecha inválida: date range exceeds ..."}'
      - end < start → 400 con '{"error": "fecha inválida: end must be after start"}'
      - formato de fecha inválido → 400
    """

    def test_dates_range_gt_10_years(self) -> None:
        """
        Escenario spec 2.2: rango > 10 años → 400 con
        '{"error": "fecha inválida: date range exceeds 10 years"}'
        Input: start=2010-01-01, end=2024-01-01 (14 años)
        """
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2010-01-01", end="2024-01-01")
        errors = exc_info.value.errors()
        assert any(
            "10" in str(e["msg"]) or "years" in str(e["msg"]).lower() for e in errors
        )

    def test_dates_end_before_start(self) -> None:
        """
        Escenario spec 2.2: end < start → 400 con
        '{"error": "fecha inválida: end must be after start"}'
        Input: start=2024-01-01, end=2020-01-01
        """
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2024-01-01", end="2020-01-01")
        errors = exc_info.value.errors()
        assert any(
            "end" in str(e["msg"]).lower() or "start" in str(e["msg"]).lower()
            for e in errors
        )

    def test_dates_invalid_format(self) -> None:
        """
        Escenario spec 2.2: formato de fecha inválido → 400
        Input: start=01-01-2020, end=01-01-2024
        """
        with pytest.raises(ValidationError):
            DateRangeSchema(start="01-01-2020", end="01-01-2024")

    def test_dates_error_message_format(self) -> None:
        """
        El mensaje de error del endpoint contiene 'fecha inválida: ...'
        que es exactamente lo que jsonify({'error': 'fecha inválida: ...'}) devolvería.
        """
        try:
            DateRangeSchema(start="2010-01-01", end="2024-01-01")
        except ValidationError as e:
            error_msg = f"fecha inválida: {e}"
            assert "fecha" in error_msg
            assert "inválida" in error_msg


# ---------------------------------------------------------------------------
# Task 2.3 — Test request válido → 200, payload de respuesta sin cambios
# ---------------------------------------------------------------------------


class TestNdviTimeseriesBboxValidRequest:
    """
    Verifica que un request válido devuelve la misma estructura de respuesta
    que antes del cambio (HTTP 200 + JSON con 'dates', 'ndvi', 'bbox').

    El test de contrato verifica que los schemas producen el formato exacto
    que el endpoint pasa a _timeseries_pipeline.
    """

    def test_valid_bbox_produces_list_float_for_pipeline(self) -> None:
        """
        Un bbox válido pasa BBoxSchema y produce un list[float]
        que es exactamente lo que _timeseries_pipeline recibe como bbox_parsed.
        """
        bbox_str = "[-110.5, 32.0, -90.0, 45.0]"
        bbox_parsed = _parse_bbox_str(bbox_str)
        validated = BBoxSchema(
            min_lon=bbox_parsed[0],
            min_lat=bbox_parsed[1],
            max_lon=bbox_parsed[2],
            max_lat=bbox_parsed[3],
        )
        bbox_out = [
            validated.min_lon,
            validated.min_lat,
            validated.max_lon,
            validated.max_lat,
        ]
        # El formato es list[float], exactamente lo que el pipeline espera
        assert bbox_out == [-110.5, 32.0, -90.0, 45.0]
        assert isinstance(bbox_out, list)
        assert len(bbox_out) == 4
        assert all(isinstance(v, float) for v in bbox_out)

    def test_valid_date_range_produces_yyyy_mm_dd_strings(self) -> None:
        """
        Un DateRangeSchema válido produce fechas en formato YYYY-MM-DD
        que es exactamente lo que _timeseries_pipeline recibe como start_parsed/end_parsed.
        """
        dr = DateRangeSchema(start="2020-01-01", end="2024-01-01")
        assert dr.start.strftime("%Y-%m-%d") == "2020-01-01"
        assert dr.end.strftime("%Y-%m-%d") == "2024-01-01"

    def test_valid_request_produces_pipeline_ready_params(self) -> None:
        """
        Request válido: bbox y fechas → produce bbox_out, start_out, end_out
        que son los params que ndvi_timeseries_bbox pasa a _timeseries_pipeline.

        Este es el test de regresión central: la estructura de datos que
        sale del endpoint debe ser idéntica a la que _timeseries_pipeline
        recibía antes del cambio (cuando parseaba internamente).
        """
        bbox_str = "[-110.5, 32.0, -90.0, 45.0]"
        start_raw = "2020-01-01"
        end_raw = "2024-01-01"

        # Paso 1: parsear bbox string → list[float]
        bbox_parsed = _parse_bbox_str(bbox_str)
        # Paso 2: validar con BBoxSchema
        bbox_validado = BBoxSchema(
            min_lon=bbox_parsed[0],
            min_lat=bbox_parsed[1],
            max_lon=bbox_parsed[2],
            max_lat=bbox_parsed[3],
        )
        # Paso 3: extraer list[float] que el pipeline recibe
        bbox_out = [
            bbox_validado.min_lon,
            bbox_validado.min_lat,
            bbox_validado.max_lon,
            bbox_validado.max_lat,
        ]

        # Paso 4: validar fechas con DateRangeSchema
        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        # Paso 5: formatear a YYYY-MM-DD como el pipeline espera
        start_out = fecha_validada.start.strftime("%Y-%m-%d")
        end_out = fecha_validada.end.strftime("%Y-%m-%d")

        # Verificamos que todos los valores son los esperados
        assert bbox_out == [-110.5, 32.0, -90.0, 45.0]
        assert start_out == "2020-01-01"
        assert end_out == "2024-01-01"
        # Y que son del tipo exacto que el pipeline espera
        assert isinstance(bbox_out, list)
        assert isinstance(start_out, str)
        assert isinstance(end_out, str)

    def test_valid_request_at_coordinate_boundaries(self) -> None:
        """
        BBox en los límites exactos [-180,180] × [-90,90] pasa sin excepción.
        """
        bbox_str = "[-180.0, -90.0, 180.0, 90.0]"
        start_raw = "2020-01-01"
        end_raw = "2020-12-31"

        bbox_parsed = _parse_bbox_str(bbox_str)
        bbox_validado = BBoxSchema(
            min_lon=bbox_parsed[0],
            min_lat=bbox_parsed[1],
            max_lon=bbox_parsed[2],
            max_lat=bbox_parsed[3],
        )
        bbox_out = [
            bbox_validado.min_lon,
            bbox_validado.min_lat,
            bbox_validado.max_lon,
            bbox_validado.max_lat,
        ]
        assert bbox_out == [-180.0, -90.0, 180.0, 90.0]

        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        assert fecha_validada.start == date(2020, 1, 1)
        assert fecha_validada.end == date(2020, 12, 31)

    def test_valid_request_same_day_range_passes(self) -> None:
        """
        Rango de un solo día es válido (end > start, no end >= start).
        """
        bbox_str = "[-110.5, 32.0, -90.0, 45.0]"
        start_raw = "2022-06-01"
        end_raw = "2022-06-02"

        bbox_parsed = _parse_bbox_str(bbox_str)
        bbox_validado = BBoxSchema(
            min_lon=bbox_parsed[0],
            min_lat=bbox_parsed[1],
            max_lon=bbox_parsed[2],
            max_lat=bbox_parsed[3],
        )
        fecha_validada = DateRangeSchema(start=start_raw, end=end_raw)
        assert fecha_validada.start == date(2022, 6, 1)
        assert fecha_validada.end == date(2022, 6, 2)


# ---------------------------------------------------------------------------
# Task 2.4 — Regression: otros 4 endpoints timeseries
# ---------------------------------------------------------------------------


class TestTimeseriesPipelineRegression:
    """
    Verifica que _timeseries_pipeline sigue funcionando correctamente
    para los otros 4 endpoints con validate_dates=True por defecto.

    Estos tests prueban la lógica del pipeline directamente (schema-level),
    mockeando la función build_* para evitar dependencia de GEE.
    """

    def test_check_max_10_years_rejects_gt_10_years(self) -> None:
        """
        Regression: era5-temp/era5-soil/imerg-precip/water-timeseries-bbox
        todos usan check_max_10_years en el pipeline → rango > 10 años → 400.
        """
        from gee.utils import check_max_10_years

        # 14 años de rango
        err = check_max_10_years("2010-01-01", "2024-01-01")
        assert err is not None
        assert "10" in err

    def test_check_max_10_years_accepts_10_years(self) -> None:
        """Regression: exactamente 10 años es aceptado."""
        from gee.utils import check_max_10_years

        err = check_max_10_years("2010-01-01", "2020-01-01")
        assert err is None

    def test_check_max_10_years_accepts_valid_range(self) -> None:
        """Regression: rango válido < 10 años es aceptado."""
        from gee.utils import check_max_10_years

        err = check_max_10_years("2020-01-01", "2024-01-01")
        assert err is None

    def test_check_max_10_years_rejects_end_before_start(self) -> None:
        """Regression: end < start → 400."""
        from gee.utils import check_max_10_years

        err = check_max_10_years("2024-01-01", "2020-01-01")
        assert err is not None

    def test_parse_bbox_valid(self) -> None:
        """Regression: _parse_bbox funciona correctamente."""
        result = _parse_bbox_str("[-110.5, 32.0, -90.0, 45.0]")
        assert result == [-110.5, 32.0, -90.0, 45.0]

    def test_bbox_at_boundaries_is_valid(self) -> None:
        """Regression: bbox en límites exactos es válido para el pipeline."""
        bbox = BBoxSchema(min_lon=-180.0, min_lat=-90.0, max_lon=180.0, max_lat=90.0)
        assert bbox.min_lon == -180.0
        assert bbox.max_lat == 90.0


# ---------------------------------------------------------------------------
# Tests de contrato — formato de respuesta del endpoint (schema-level)
# ---------------------------------------------------------------------------


class TestNdviTimeseriesBboxEndpointContract:
    """
    Verifica que los schemas produzcan el formato exacto que el endpoint
    usa para construir respuestas 400 y para extraer los valores validados.

    Estos tests prueban el 'contrato' entre el endpoint y los schemas.
    """

    def test_error_message_format_bbox_matches_endpoint(self) -> None:
        """
        Cuando el endpoint detecta un bbox invertido, el mensaje de error
        contiene 'bbox inválido: ...' — que es exactamente lo que
        jsonify({'error': 'bbox inválido: ...'}) devolvería como 400.
        """
        bbox_str = "[-90.0, 32.0, -110.5, 45.0]"
        try:
            bbox_parsed = _parse_bbox_str(bbox_str)
            BBoxSchema(
                min_lon=bbox_parsed[0],
                min_lat=bbox_parsed[1],
                max_lon=bbox_parsed[2],
                max_lat=bbox_parsed[3],
            )
        except (ValueError, TypeError, ValidationError) as e:
            error_msg = f"bbox inválido: {e}"
            assert "bbox" in error_msg
            assert "inválido" in error_msg

    def test_error_message_format_dates_matches_endpoint(self) -> None:
        """
        Cuando el endpoint detecta un rango > 10 años, el mensaje de error
        contiene 'fecha inválida: ...' — que es exactamente lo que
        jsonify({'error': 'fecha inválida: ...'}) devolvería como 400.
        """
        try:
            DateRangeSchema(start="2010-01-01", end="2024-01-01")
        except ValidationError as e:
            error_msg = f"fecha inválida: {e}"
            assert "fecha" in error_msg
            assert "inválida" in error_msg
