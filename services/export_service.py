"""
Servicio de exportación de análisis como ZIP.

Responsabilidades:
  - Serializar series temporales a formato CSV con metadatos.
  - Empaquetar CSV, GIFs y metadatos en un ZIP.
"""
import json
import logging
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from config import STATIC_DIR

logger = logging.getLogger(__name__)


def serialize_series_to_csv(
    series_data: dict[str, Any],
    dates: list[str],
    bbox: list[float] | None = None,
    variable_keys: list[str] | None = None,
) -> str:
    """
    Serializa datos de series temporales a string CSV.

    Args:
        series_data: dict con keys de variables y valores como listas
                     ej: {"ndvi": [0.45, 0.52], "temp": [28.3, 29.1]}
        dates: lista de fechas en formato 'YYYY-MM-DD', alineadas por índice
        bbox: bounding box opcional para metadata [minLon, minLat, maxLon, maxLat]
        variable_keys: orden de columnas; si None usa keys de series_data

    Returns:
        String CSV con header de metadatos (#) y filas date,value1,value2...

    Raises:
        ValueError: si las longitud de dates y valores no coinciden
    """
    if not dates:
        raise ValueError("dates cannot be empty")

    # Determinar orden de columnas
    keys = variable_keys if variable_keys else list(series_data.keys())

    # Verificar alineación por índice
    for key in keys:
        if key not in series_data:
            raise ValueError(f"Variable '{key}' not found in series_data")
        if len(series_data[key]) != len(dates):
            raise ValueError(
                f"Length mismatch for '{key}': {len(series_data[key])} values vs {len(dates)} dates"
            )

    lines: list[str] = []

    # Metadata header
    if bbox:
        lines.append(f"# BBox: {','.join(str(v) for v in bbox)}")
    lines.append(f"# Variables: {','.join(keys)}")
    lines.append("")  # línea en blanco separadora

    # Header CSV
    header = "date," + ",".join(keys)
    lines.append(header)

    # Filas de datos
    for i, d in enumerate(dates):
        row_values = []
        for key in keys:
            val = series_data[key][i]
            # Representar None o missing como string vacío
            row_values.append("" if val is None else str(val))
        lines.append(f"{d},{','.join(row_values)}")

    return "\n".join(lines) + "\n"


def create_export_zip(
    csv_content: str,
    gif_paths: list[str],
    metadata: dict[str, Any],
) -> bytes:
    """
    Crea un ZIP con CSV, GIFs opcionales y metadata.json.

    Args:
        csv_content: contenido CSV serializado (string)
        gif_paths: rutas relativas a STATIC_DIR ej: ["gifs/ndvi_abc123.gif"]
        metadata: dict con variableKeys, panel, bbox y gifAvailable

    Returns:
        Bytes del archivo ZIP (no se guarda a disco)

    Raises:
        FileNotFoundError: si algún gif_path no existe
    """
    buffer = BytesIO()

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. Agregar CSV
        zf.writestr("timeseries.csv", csv_content)

        # 2. Agregar GIFs (copiar archivos al ZIP)
        metadata_gif_available = False
        for gif_path in gif_paths:
            full_path = STATIC_DIR / gif_path
            if not full_path.exists():
                raise FileNotFoundError(f"GIF not found: {gif_path}")
            # Nombre en ZIP: preservar estructura de carpetas
            arcname = Path(gif_path).name
            zf.write(full_path, arcname)
            metadata_gif_available = True
            logger.debug("Agregado al ZIP: %s", arcname)

        # 3. Agregar metadata.json
        metadata_json = {
            **metadata,
            "gifAvailable": metadata_gif_available,
        }
        zf.writestr("metadata.json", json.dumps(metadata_json, indent=2))

    buffer.seek(0)
    return buffer.read()
