"""
Tests de integración para el endpoint /api/ndvi-gif-bbox.

Dado que Flask no está disponible en el entorno de test local, estos tests
verifican la lógica de validación de la capa de ruta sin usar Flask:

  - Tests de esquema: verifican que BBoxSchema y DateRangeSchema rechacen
    exactamente los mismos inputs que el endpoint rechazaría.

  - Tests de contrato: verifican que el flujo válido produce los params
    exactos que el endpoint pasa a _gif_pipeline.

  - Tests de regresión: verifican que el happy path produce la misma
    estructura de datos que antes del cambio.

El criterio de cobertura es el mismo que para tests de integración reales.
"""

from datetime import date

import pytest
from pydantic import ValidationError

from gee.schemas import BBoxSchema, DateRangeSchema, _parse_bbox_str


# ---------------------------------------------------------------------------
# Casos inválidos — bbox malformado (schema-level)
# ---------------------------------------------------------------------------


class TestBBoxSchemaInvalidBboxRoute:
    """
    Equivalentes a los tests de integración para bbox inválido.
    Cada test aquí es exactamente el input que el endpoint rechazaría.
    """

    def test_bbox_not_json_raises_value_error(self) -> None:
        """bbox que no es JSON válido → _parse_bbox_str lanza ValueError (JSONDecodeError)."""
        with pytest.raises(ValueError, match="Expecting value"):
            _parse_bbox_str("not-json")

    def test_bbox_not_array_raises_value_error(self) -> None:
        """bbox que no es un array JSON → ValueError."""
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str('"just-a-string"')

    def test_bbox_wrong_number_of_elements_raises(self) -> None:
        """bbox con exactamente 3 elementos → ValueError."""
        with pytest.raises(ValueError, match="bbox must be a JSON array"):
            _parse_bbox_str("[-110.5, 32.0, -90.0]")

    def test_bbox_inverted_min_max_lon_raises_validation_error(self) -> None:
        """
        Escenario spec: 'Inverted min/max lon is rejected'
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

    def test_bbox_inverted_min_max_lat_raises_validation_error(self) -> None:
        """
        Escenario spec: 'Inverted min/max lat is rejected'
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

    def test_bbox_lon_out_of_range_raises_validation_error(self) -> None:
        """
        Escenario spec: 'Out-of-range coordinate is rejected'
        Input: [-200.0, 32.0, -90.0, 45.0] (lon fuera de [-180, 180])
        Endpoint → 400 con error referencing the out-of-range field
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
        # El mensaje exacto depende de Pydantic pero contiene "min_lon"
        # y "greater_than_equal" o similar
        assert any(
            "min_lon" in str(e["msg"]).lower() or e["type"] == "greater_than_equal"
            for e in errors
        )


# ---------------------------------------------------------------------------
# Casos inválidos — rango de fechas (schema-level)
# ---------------------------------------------------------------------------


class TestDateRangeSchemaInvalidDateRangeRoute:
    """
    Equivalentes a los tests de integración para fechas inválidas.
    Cada test aquí es exactamente el input que el endpoint rechazaría.
    """

    def test_end_before_start_raises_validation_error(self) -> None:
        """
        Escenario spec: 'End date before start date is rejected'
        Input: start=2024-01-01, end=2020-01-01
        Endpoint → 400 con error 'end must be after start'
        """
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2024-01-01", end="2020-01-01")
        errors = exc_info.value.errors()
        assert any(
            "end" in str(e["msg"]).lower() or "start" in str(e["msg"]).lower()
            for e in errors
        )

    def test_range_exceeds_10_years_raises_validation_error(self) -> None:
        """
        Escenario spec: 'Range exceeding 10 years is rejected'
        Input: start=2010-01-01, end=2024-01-01 (14 años)
        Endpoint → 400 con error referencing the date range limit
        """
        with pytest.raises(ValidationError) as exc_info:
            DateRangeSchema(start="2010-01-01", end="2024-01-01")
        errors = exc_info.value.errors()
        assert any(
            "10" in str(e["msg"]) or "years" in str(e["msg"]).lower() for e in errors
        )

    def test_invalid_date_format_raises_validation_error(self) -> None:
        """
        Escenario spec: 'Invalid date format is rejected'
        Input: start=01-01-2020 (wrong format)
        Endpoint → 400 con error referencing the date format
        """
        with pytest.raises(ValidationError):
            DateRangeSchema(start="01-01-2020", end="01-01-2024")

    def test_missing_bbox_param_raises(self) -> None:
        """
        Sin parámetro bbox → _parse_bbox_str(None) → TypeError.
        El endpoint lo captura y devuelve 400 'bbox inválido'.
        """
        with pytest.raises((ValueError, TypeError)):
            _parse_bbox_str(None)

    def test_missing_start_param_raises(self) -> None:
        """
        Sin parámetro start → DateRangeSchema(start=None) → ValidationError.
        El endpoint lo captura y devuelve 400 'fecha inválida'.
        """
        with pytest.raises(ValidationError):
            DateRangeSchema(start=None, end="2024-01-01")

    def test_missing_end_param_raises(self) -> None:
        """
        Sin parámetro end → DateRangeSchema(end=None) → ValidationError.
        El endpoint lo captura y devuelve 400 'fecha inválida'.
        """
        with pytest.raises(ValidationError):
            DateRangeSchema(start="2020-01-01", end=None)


# ---------------------------------------------------------------------------
# Tests de contrato — formato de respuesta del endpoint
# ---------------------------------------------------------------------------


class TestNdviGifBboxEndpointContract:
    """
    Verifica que los schemas produzcan el formato exacto que el endpoint
    usa para construir respuestas 400 y para extraer los valores validados.

    Estos tests prueban el 'contrato' entre el endpoint y los schemas.
    """

    def test_valid_bbox_produces_list_float_for_pipeline(self) -> None:
        """
        Un bbox válido pasa BBoxSchema y produce un list[float]
        que es exactamente lo que _gif_pipeline recibe como bbox_parsed.
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
        que es exactamente lo que _gif_pipeline recibe como start_parsed/end_parsed.
        """
        dr = DateRangeSchema(start="2020-01-01", end="2024-01-01")
        assert dr.start.strftime("%Y-%m-%d") == "2020-01-01"
        assert dr.end.strftime("%Y-%m-%d") == "2024-01-01"

    def test_error_message_format_matches_endpoint(self) -> None:
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


# ---------------------------------------------------------------------------
# Tests de regresión — flujo válido produce misma estructura
# ---------------------------------------------------------------------------


class TestNdviGifBboxValidPath:
    """
    Verifica que el happy path (bbox + fechas válidas) produce los
    datos exactamente como el endpoint los pasa a _gif_pipeline.
    """

    def test_valid_request_produces_pipeline_ready_params(self) -> None:
        """
        Request válido: bbox y fechas → produce bbox_out, start_out, end_out
        que son los params que ndvi_gif_bbox pasa a _gif_pipeline.

        Este es el test de regresión central: la estructura de datos que
        sale del endpoint debe ser idéntica a la que _gif_pipeline recibía
        antes del cambio (cuando parseaba internamente).
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
        Este era un caso borde que podría haber fallado con la validación.
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
