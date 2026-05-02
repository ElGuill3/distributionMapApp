"""
Tests de unidad para services/export_service.py.

Patrón: Arrange → Act → Assert.
"""
import json
import zipfile
from io import BytesIO

import pytest

from services.export_service import create_export_zip, serialize_series_to_csv


# ---------------------------------------------------------------------------
# serialize_series_to_csv
# ---------------------------------------------------------------------------

class TestSerializeSeriesToCsv:
    """Tests para la función serialize_series_to_csv."""

    def test_single_variable_header_and_rows(self) -> None:
        """
        GIVEN ndvi con dates [2020-03-01, 2020-03-17] y values [0.45, 0.52]
        WHEN serialize_series_to_csv es llamada
        THEN CSV contiene header 'date,ndvi' y filas correctas
        """
        csv = serialize_series_to_csv(
            series_data={"ndvi": [0.45, 0.52]},
            dates=["2020-03-01", "2020-03-17"],
        )
        lines = csv.strip().split("\n")
        # Structure: # Variables (metadata) + blank line + CSV header + data rows
        assert lines[0] == "# Variables: ndvi"
        assert lines[1] == ""
        assert lines[2] == "date,ndvi"
        assert lines[3] == "2020-03-01,0.45"
        assert lines[4] == "2020-03-17,0.52"

    def test_multiple_variables_aligned_by_date(self) -> None:
        """
        GIVEN panel A tiene ndvi y temp cargados
        WHEN CSV es generada
        THEN columns son: date,ndvi,temp
        AND cada fila tiene valores alineados por fecha
        """
        csv = serialize_series_to_csv(
            series_data={
                "ndvi": [0.45, 0.52, 0.48],
                "temp": [28.3, 29.1, 27.5],
            },
            dates=["2020-03-01", "2020-03-17", "2020-04-01"],
        )
        lines = csv.strip().split("\n")
        assert lines[0] == "# Variables: ndvi,temp"
        assert lines[2] == "date,ndvi,temp"
        assert lines[3] == "2020-03-01,0.45,28.3"
        assert lines[4] == "2020-03-17,0.52,29.1"
        assert lines[5] == "2020-04-01,0.48,27.5"

    def test_missing_values_as_empty_string(self) -> None:
        """
        GIVEN una variable tiene valor y otra no en el mismo índice
        WHEN CSV es generada
        THEN el valor faltante se representa como string vacío
        """
        csv = serialize_series_to_csv(
            series_data={
                "ndvi": [0.45, None, 0.48],
                "temp": [28.3, 29.1, None],
            },
            dates=["2020-03-01", "2020-03-17", "2020-04-01"],
        )
        lines = csv.strip().split("\n")
        assert lines[3] == "2020-03-01,0.45,28.3"
        assert lines[4] == "2020-03-17,,29.1"   # ndvi faltante → vacío
        assert lines[5] == "2020-04-01,0.48,"   # temp faltante → vacío

    def test_metadata_header_includes_bbox(self) -> None:
        """
        GIVEN bbox [-92.5, 17.0, -91.0, 18.0]
        WHEN CSV es generada
        THEN primera línea es '# BBox: -92.5,17.0,-91.0,18.0'
        """
        csv = serialize_series_to_csv(
            series_data={"ndvi": [0.45]},
            dates=["2020-03-01"],
            bbox=[-92.5, 17.0, -91.0, 18.0],
        )
        lines = csv.strip().split("\n")
        assert lines[0] == "# BBox: -92.5,17.0,-91.0,18.0"

    def test_metadata_header_includes_variables(self) -> None:
        """
        GIVEN variables [ndvi, temp]
        WHEN CSV es generada
        THEN línea de metadata contiene '# Variables: ndvi,temp'
        """
        csv = serialize_series_to_csv(
            series_data={"ndvi": [0.45], "temp": [28.3]},
            dates=["2020-03-01"],
            variable_keys=["ndvi", "temp"],
        )
        lines = csv.strip().split("\n")
        # La línea de variables aparece después del bbox (si existe)
        var_line = next(l for l in lines if l.startswith("# Variables:"))
        assert var_line == "# Variables: ndvi,temp"

    def test_variable_keys_determine_column_order(self) -> None:
        """
        GIVEN series_data tiene ndvi y temp
        AND variable_keys = [temp, ndvi]
        WHEN CSV es generada
        THEN columnas en orden: date,temp,ndvi
        """
        csv = serialize_series_to_csv(
            series_data={"ndvi": [0.45], "temp": [28.3]},
            dates=["2020-03-01"],
            variable_keys=["temp", "ndvi"],
        )
        lines = csv.strip().split("\n")
        assert lines[2] == "date,temp,ndvi"
        assert lines[3] == "2020-03-01,28.3,0.45"

    def test_empty_dates_raises_value_error(self) -> None:
        """
        GIVEN dates = []
        WHEN serialize_series_to_csv es llamada
        THEN lanza ValueError con mensaje 'dates cannot be empty'
        """
        with pytest.raises(ValueError, match="dates cannot be empty"):
            serialize_series_to_csv(series_data={"ndvi": []}, dates=[])

    def test_length_mismatch_raises_value_error(self) -> None:
        """
        GIVEN ndvi tiene 2 valores pero dates tiene 3 elementos
        WHEN serialize_series_to_csv es llamada
        THEN lanza ValueError sobre longitud
        """
        with pytest.raises(ValueError, match="Length mismatch"):
            serialize_series_to_csv(
                series_data={"ndvi": [0.45, 0.52]},
                dates=["2020-03-01", "2020-03-17", "2020-04-01"],
            )

    def test_missing_variable_in_series_data_raises(self) -> None:
        """
        GIVEN variable_keys incluye 'ndvi' pero series_data no tiene 'ndvi'
        WHEN serialize_series_to_csv es llamada
        THEN lanza ValueError
        """
        with pytest.raises(ValueError, match="not found in series_data"):
            serialize_series_to_csv(
                series_data={"temp": [28.3]},
                dates=["2020-03-01"],
                variable_keys=["ndvi"],
            )

    def test_empty_series_data_only_headers(self) -> None:
        """
        GIVEN series_data vacío {} con dates válidas
        WHEN CSV es generada
        THEN contiene solo header 'date,' (sin variables)
        """
        csv = serialize_series_to_csv(
            series_data={},
            dates=["2020-03-01"],
        )
        lines = csv.strip().split("\n")
        # Structure: # Variables + blank + date header + one data row
        assert lines[0] == "# Variables: "
        assert lines[2] == "date,"
        assert lines[3] == "2020-03-01,"


# ---------------------------------------------------------------------------
# create_export_zip
# ---------------------------------------------------------------------------

class TestCreateExportZip:
    """Tests para la función create_export_zip."""

    def test_returns_valid_zip_bytes(self) -> None:
        """
        GIVEN csv_content y metadata válidos
        WHEN create_export_zip es llamada sin GIFs
        THEN devuelve bytes que son un ZIP válido
        """
        csv = "date,ndvi\n2020-03-01,0.45\n"
        zip_bytes = create_export_zip(
            csv_content=csv,
            gif_paths=[],
            metadata={"variableKeys": ["ndvi"], "panel": "A"},
        )
        # Verificar que es un ZIP válido
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            assert zf.testzip() is None  # testzip returns None si está OK

    def test_zip_contains_timeseries_csv(self) -> None:
        """
        GIVEN csv_content con datos
        WHEN create_export_zip es llamada
        THEN ZIP contiene timeseries.csv con el contenido correcto
        """
        csv = "date,ndvi\n2020-03-01,0.45\n"
        zip_bytes = create_export_zip(
            csv_content=csv,
            gif_paths=[],
            metadata={"variableKeys": ["ndvi"], "panel": "A"},
        )
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            names = zf.namelist()
            assert "timeseries.csv" in names
            assert zf.read("timeseries.csv").decode() == csv

    def test_zip_contains_metadata_json(self) -> None:
        """
        GIVEN metadata con variableKeys y panel
        WHEN create_export_zip es llamada
        THEN ZIP contiene metadata.json con los datos correctos
        """
        zip_bytes = create_export_zip(
            csv_content="date,ndvi\n2020-03-01,0.45\n",
            gif_paths=[],
            metadata={"variableKeys": ["ndvi"], "panel": "A", "bbox": [-92.5, 17.0, -91.0, 18.0]},
        )
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            metadata = json.loads(zf.read("metadata.json").decode())
            assert metadata["variableKeys"] == ["ndvi"]
            assert metadata["panel"] == "A"
            assert metadata["bbox"] == [-92.5, 17.0, -91.0, 18.0]
            assert metadata["gifAvailable"] is False

    def test_zip_contains_gif_files(self, tmp_path, monkeypatch) -> None:
        """
        GIVEN un archivo GIF temporal
        WHEN create_export_zip es llamada con su ruta
        THEN ZIP contiene el archivo GIF con el nombre correcto
        """
        # Crear GIF temporal bajo STATIC_DIR/tmp_path
        gif_dir = tmp_path / "gifs"
        gif_dir.mkdir()
        gif_file = gif_dir / "ndvi_test.gif"
        gif_file.write_bytes(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00\x02\x00\x00\x00b!\xf9\x04\x01\x05\x00\x01\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00;\x00")

        # Redirigir STATIC_DIR al tmp_path — patch en el módulo donde se usa
        monkeypatch.setattr("services.export_service.STATIC_DIR", tmp_path)

        csv = "date,ndvi\n2020-03-01,0.45\n"
        zip_bytes = create_export_zip(
            csv_content=csv,
            gif_paths=["gifs/ndvi_test.gif"],
            metadata={"variableKeys": ["ndvi"], "panel": "A"},
        )
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            names = zf.namelist()
            assert "ndvi_test.gif" in names
            assert zf.read("ndvi_test.gif") == gif_file.read_bytes()

    def test_zip_gif_available_true_when_gif_included(self, tmp_path, monkeypatch) -> None:
        """
        GIVEN se incluye un GIF
        WHEN create_export_zip es llamada
        THEN metadata.json tiene gifAvailable: true
        """
        gif_dir = tmp_path / "gifs"
        gif_dir.mkdir()
        gif_file = gif_dir / "test.gif"
        gif_file.write_bytes(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00\x02\x00\x00\x00b!\xf9\x04\x01\x05\x00\x01\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00;\x00")

        monkeypatch.setattr("services.export_service.STATIC_DIR", tmp_path)

        zip_bytes = create_export_zip(
            csv_content="date,ndvi\n",
            gif_paths=["gifs/test.gif"],
            metadata={"variableKeys": ["ndvi"], "panel": "A"},
        )
        buffer = BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            metadata = json.loads(zf.read("metadata.json").decode())
            assert metadata["gifAvailable"] is True

    def test_missing_gif_raises_file_not_found_error(self, tmp_path) -> None:
        """
        GIVEN gifPaths contiene un archivo que no existe
        WHEN create_export_zip es llamada
        THEN lanza FileNotFoundError
        """
        with pytest.raises(FileNotFoundError, match="GIF not found"):
            create_export_zip(
                csv_content="date,ndvi\n",
                gif_paths=["gifs/nonexistent.gif"],
                metadata={"variableKeys": ["ndvi"], "panel": "A"},
            )
