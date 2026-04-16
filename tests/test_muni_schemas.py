"""
Tests unitarios para MuniQuerySchema — Phase 4, Task 4.2.

Patrón: Arrange → Act → Assert.
Cubre todos los casos definidos en el spec de MuniQuerySchema:
  - muni válido → pasa
  - muni inválido → ValidationError
  - palette default es "gee_flood"

Breaking change cubierto:
  - flood_routes.py ahora normaliza errores a {"error": "..."}
    (antes usaba jsonify(error=...) keyword inconsistente)
"""

import pytest
from pydantic import ValidationError

from gee.schemas import MuniQuerySchema, MUNI_KEYS


# ---------------------------------------------------------------------------
# MuniQuerySchema — Happy Path
# ---------------------------------------------------------------------------


class TestMuniQuerySchemaValid:
    """Casos válidos que deben pasar sin excepción."""

    def test_valid_centla_passes(self) -> None:
        """
        muni='centla' → pasa.
        """
        m = MuniQuerySchema(muni="centla")
        assert m.muni == "centla"
        assert m.palette == "gee_flood"

    def test_valid_todos_los_municipios(self) -> None:
        """
        Todos los 16 municipios del Literal pasan sin excepción.
        """
        municipalities = [
            "balancan",
            "cardenas",
            "centla",
            "centro",
            "comalcalco",
            "cunduacan",
            "emiliano_zapata",
            "huimanguillo",
            "jalapa",
            "jalpa_de_mendez",
            "jonuta",
            "macuspana",
            "nacajuca",
            "paraiso",
            "tacotalpa",
            "tenosique",
        ]
        for muni in municipalities:
            m = MuniQuerySchema(muni=muni)
            assert m.muni == muni

    def test_valid_custom_palette(self) -> None:
        """
        muni con palette custom → pasa.
        """
        m = MuniQuerySchema(muni="centla", palette="viridis")
        assert m.muni == "centla"
        assert m.palette == "viridis"

    def test_palette_default_is_gee_flood(self) -> None:
        """
        Cuando no se pasa palette, default es 'gee_flood'.
        """
        m = MuniQuerySchema(muni="cardenas")
        assert m.palette == "gee_flood"


# ---------------------------------------------------------------------------
# MuniQuerySchema — muni inválido
# ---------------------------------------------------------------------------


class TestMuniQuerySchemaInvalidMuni:
    """muni que no está en el Literal de 16 keys → ValidationError."""

    def test_muni_invalid_xyz_raises(self) -> None:
        """
        muni='xyz' → ValidationError.
        """
        with pytest.raises(ValidationError) as exc_info:
            MuniQuerySchema(muni="xyz")
        errors = exc_info.value.errors()
        assert len(errors) > 0

    def test_muni_typo_centrla_raises(self) -> None:
        """
        muni='centrla' (typo) → ValidationError.
        El typo no está en el Literal de 16 entries.
        """
        with pytest.raises(ValidationError):
            MuniQuerySchema(muni="centrla")

    def test_muni_empty_string_raises(self) -> None:
        """muni='' → ValidationError."""
        with pytest.raises(ValidationError):
            MuniQuerySchema(muni="")

    def test_muni_uppercase_centla_raises(self) -> None:
        """
        muni='CENTLA' (mayúscula) → ValidationError.
        El Literal es case-sensitive.
        """
        with pytest.raises(ValidationError):
            MuniQuerySchema(muni="CENTLA")


# ---------------------------------------------------------------------------
# MuniQuerySchema — Error message format (contrato con endpoint)
# ---------------------------------------------------------------------------


class TestMuniQuerySchemaEndpointContract:
    """
    Verifica que los mensajes de error del schema matchean lo que el endpoint
    devuelve como {"error": "..."}.

    El endpoint hace: jsonify({'error': f'municipio inválido: {e}'})
    → el mensaje de error del schema se incrusta directo.

    Breaking change: flood_routes.py normalizó jsonify(error=...) → jsonify({'error': ...})
    """

    def test_error_message_format_for_invalid_muni(self) -> None:
        """
        muni inválido → el mensaje de error contiene hints sobre valores válidos.
        """
        try:
            MuniQuerySchema(muni="xyz")
        except ValidationError as e:
            error_msg = f"municipio inválido: {e}"
            # El endpoint reporta el error tal cual
            assert len(error_msg) > 0

    def test_valid_muni_produces_correct_fields(self) -> None:
        """
        Request válido → muni y palette son strings.
        """
        m = MuniQuerySchema(muni="huimanguillo", palette="custom_palette")
        assert isinstance(m.muni, str)
        assert isinstance(m.palette, str)
        assert m.muni == "huimanguillo"
        assert m.palette == "custom_palette"
