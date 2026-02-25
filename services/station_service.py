"""
Servicio de lectura de series temporales de estaciones hidrológicas locales.

Los datos provienen de archivos CSV con encabezado de 6 líneas (BDCTB, SPTTB).
Se aplica interpolación temporal para rellenar huecos de hasta 7 días.
"""
import pandas as pd

from config import LOCAL_STATIONS


def read_station_level_timeseries(
    station_id: str,
) -> tuple[list[str], list[float]]:
    """
    Lee y preprocesa la serie de nivel hidrométrico de una estación local.

    Pasos:
      1. Carga el CSV correspondiente a station_id.
      2. Parsea columnas 'Fecha' y 'Nivel(m)'.
      3. Re-indexa a frecuencia diaria.
      4. Interpola huecos ≤ 7 días usando interpolación temporal.
      5. Devuelve las fechas y niveles limpios como listas.

    Args:
        station_id: Clave de la estación (p. ej. 'SPTTB' o 'BDCTB').

    Returns:
        Tupla (fechas, niveles_m) con datos limpios e interpolados.

    Raises:
        ValueError: si station_id no está en LOCAL_STATIONS.
        FileNotFoundError: si el CSV no existe en la ruta configurada.
    """
    station = LOCAL_STATIONS.get(station_id)
    if not station:
        raise ValueError(f"Estación no soportada: '{station_id}'.")

    csv_path = station["csv_path"]
    if not csv_path.exists():
        raise FileNotFoundError(f"No se encontró CSV para la estación '{station_id}'.")

    df = pd.read_csv(csv_path, skiprows=6)
    df.columns = df.columns.str.strip()
    df["Fecha"]    = pd.to_datetime(df["Fecha"],    dayfirst=False, errors="coerce")
    df["Nivel(m)"] = pd.to_numeric(df["Nivel(m)"], errors="coerce")
    df = df.dropna(subset=["Fecha", "Nivel(m)"]).sort_values("Fecha")

    df = df.set_index("Fecha").asfreq("D")
    df["Nivel_interp"] = df["Nivel(m)"].interpolate(
        method="time",
        limit=7,
        limit_direction="both",
    )

    df_clean = df.dropna(subset=["Nivel_interp"])
    dates  = df_clean.index.strftime("%Y-%m-%d").tolist()
    levels = df_clean["Nivel_interp"].astype(float).tolist()

    print(f"Estación {station_id}: {len(dates)} fechas cargadas (con interpolación)")
    return dates, levels
