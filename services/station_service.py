"""
Servicio de lectura de series temporales de estaciones hidrológicas locales.

Los datos provienen de archivos CSV con encabezado de 6 líneas (BDCTB, SPTTB).
Se aplica interpolación temporal para rellenar huecos de hasta 7 días.
"""

import logging

import pandas as pd

from config import LOCAL_STATIONS

logger = logging.getLogger(__name__)


def read_station_level_timeseries(
    station_id: str,
) -> tuple[list[str], list[float]]:
    """
    Lee y preprocesa la serie temporal de una estación local (hidro o clima).

    Pasos:
      1. Carga el CSV correspondiente a station_id.
      2. Detecta la fila de cabecera y parsea la fecha y la métrica correspondiente.
      3. Rellena los datos faltantes:
         - Para climas: asigna 0.0 a los días sin registro (sin interpolación).
         - Para hidros: aplica interpolación lineal temporal (hasta 7 días).
      4. Devuelve las fechas y valores limpios como listas.
    """
    station = LOCAL_STATIONS.get(station_id)
    if not station:
        raise ValueError(f"Estación no soportada: '{station_id}'.")

    csv_path = station["csv_path"]
    if not csv_path.exists():
        raise FileNotFoundError(f"No se encontró CSV para la estación '{station_id}'.")

    # Detectar el número de filas a omitir buscando la cabecera "Fecha"
    skiprows = 0
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if "Fecha" in line:
                    skiprows = i
                    break
    except Exception:
        with open(csv_path, "r", encoding="latin-1") as f:
            for i, line in enumerate(f):
                if "Fecha" in line:
                    skiprows = i
                    break

    def clean_encoding(text: str) -> str:
        if not text:
            return text
        try:
            return text.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return text

    df = pd.read_csv(csv_path, skiprows=skiprows)
    df.columns = [clean_encoding(col).strip() for col in df.columns]

    # Identificar la columna de medición y el tipo de datos
    val_col = None
    is_clima = False
    for col in df.columns:
        col_clean = col.lower().replace("ó", "o").replace("í", "i").strip()
        if "nivel" in col_clean:
            val_col = col
            is_clima = False
            break
        elif "precipitacion" in col_clean:
            val_col = col
            is_clima = True
            break

    if not val_col:
        raise ValueError(f"No se encontró una columna de medición válida (Nivel o Precipitación) en: {csv_path.name}")

    df["Fecha"] = pd.to_datetime(df["Fecha"], dayfirst=False, errors="coerce")
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    df = df.dropna(subset=["Fecha"])
    df = df.drop_duplicates(subset=["Fecha"])

    if is_clima:
        # Climatológica: Rellenar nulos con 0.0 y no aplicar interpolación lineal
        df = df.sort_values("Fecha").set_index("Fecha").asfreq("D")
        df["Val_clean"] = df[val_col].fillna(0.0)
    else:
        # Hidrométrica: Interpolar huecos <= 7 días usando interpolación lineal temporal
        df = df.dropna(subset=[val_col]).sort_values("Fecha")
        df = df.set_index("Fecha").asfreq("D")
        df["Val_clean"] = df[val_col].interpolate(
            method="time",
            limit=7,
            limit_direction="both",
        )

    df_clean = df.dropna(subset=["Val_clean"])
    dates = df_clean.index.strftime("%Y-%m-%d").tolist()
    values = df_clean["Val_clean"].astype(float).tolist()

    logger.info(
        "Estación %s: %d fechas cargadas (tipo=%s)", station_id, len(dates), station["type"]
    )
    return dates, values
