"""
Servicio de generación de reportes PDF.

Responsabilidades:
  - Calcular estadísticas (min, max, mean, std_dev, first, last, count, trend)
    a partir de series temporales.
  - Extraer el frame del medio de un GIF animado (con caché en disco).
  - Renderizar plantilla Jinja2 y convertir a PDF con WeasyPrint.
"""
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from PIL import Image as PILImage, ImageSequence

from config import GIFS_DIR, STATIC_DIR

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Statistics computation
# ---------------------------------------------------------------------------

def compute_statistics(series_data: dict[str, Any], dates: list[str]) -> dict[str, dict[str, Any]]:
    """
    Calcula estadísticas para cada variable en series_data.

    Args:
        series_data: dict de {variable_key: [float|null, ...]}
        dates: lista de fechas alineadas por índice con los valores

    Returns:
        dict de {variable_key: {min, max, mean, std_dev, first, last, count, trend}}
    """
    stats = {}
    for var_key, values in series_data.items():
        # Filtrar valores válidos (no None)
        valid_pairs = [(d, v) for d, v in zip(dates, values) if v is not None]
        if not valid_pairs:
            stats[var_key] = {
                "min": None, "max": None, "mean": None,
                "std_dev": None, "first": None, "last": None,
                "count": 0, "trend": "→",
            }
            continue

        valid_values = [v for _, v in valid_pairs]

        min_val = min(valid_values)
        max_val = max(valid_values)
        count = len(valid_values)
        mean_val = sum(valid_values) / count

        # Standard deviation
        if count > 1:
            variance = sum((v - mean_val) ** 2 for v in valid_values) / count
            std_dev = math.sqrt(variance)
        else:
            std_dev = 0.0

        first = valid_values[0]
        last = valid_values[-1]

        # Trend: linear regression slope over valid values
        n = len(valid_pairs)
        if n > 1:
            indices = list(range(n))
            x_mean = sum(indices) / n
            y_mean = mean_val
            numerator = sum((i - x_mean) * (v - y_mean) for i, (_, v) in enumerate(valid_pairs))
            denominator = sum((i - x_mean) ** 2 for i in indices)
            if denominator > 0:
                slope = numerator / denominator
                if slope > 0.01:
                    trend = "↑"
                elif slope < -0.01:
                    trend = "↓"
                else:
                    trend = "→"
            else:
                trend = "→"
        else:
            trend = "→"

        stats[var_key] = {
            "min": round(min_val, 4),
            "max": round(max_val, 4),
            "mean": round(mean_val, 4),
            "std_dev": round(std_dev, 4),
            "first": round(first, 4),
            "last": round(last, 4),
            "count": count,
            "trend": trend,
        }

    return stats


# ---------------------------------------------------------------------------
# Anomaly Detection
# ---------------------------------------------------------------------------

Z_THRESHOLD = 2.5
SUSTAINED_THRESHOLD = 1.5
SUSTAINED_MIN_RUN = 3
WINDOW_SIZE = 7
TOP_N_EVENTS = 3


@dataclass
class AnomalyEvent:
    start_date: str
    end_date: str
    type: Literal["spike", "drop", "sustained_shift"]
    magnitude: float
    severity: Literal["Alta", "Media", "Baja"]
    duration_days: int
    description: str
    chart_annotation: bool = True


@dataclass
class AnomalyResult:
    events: list[AnomalyEvent] = field(default_factory=list)
    fallback_reason: str | None = None
    effective_report_type: str = "summary"


def rolling_z_scores(
    series_data: dict, dates: list, window: int = WINDOW_SIZE
) -> list[float]:
    """
    Compute rolling z-scores for the first variable in series_data.

    Each point is scored against the rolling mean and std of the PRECEDING
    window-1 points (pure past-looking rolling window). This avoids the
    self-referential effect where a spike inflates its own window's std.

    Args:
        series_data: dict of {variable_key: [float|null, ...]}
        dates: aligned list of date strings
        window: rolling window size (default 7)

    Returns:
        list of z-scores aligned with dates; NaN for first window-1 entries
    """
    # Get first variable (MVP single-variable)
    var_key = list(series_data.keys())[0]
    raw_values = series_data[var_key]

    # Build valid (date, value) pairs
    valid_pairs = [(d, v) for d, v in zip(dates, raw_values) if v is not None]
    if len(valid_pairs) < window:
        return [float("nan")] * len(valid_pairs)

    valid_values = [v for _, v in valid_pairs]

    z_scores: list[float] = []
    nan_count = window - 1
    z_scores.extend([float("nan")] * nan_count)

    # Compute z-score for each point using the PRECEDING window-1 points' stats
    # At i=window-1 (first scoreable point): use valid_values[0:window-1] for stats
    for i in range(window - 1, len(valid_values)):
        # Past window: the window-1 values BEFORE the current point
        past_vals = valid_values[i - (window - 1) : i]
        past_mean = sum(past_vals) / len(past_vals)
        variance = sum((v - past_mean) ** 2 for v in past_vals) / len(past_vals)
        past_std = math.sqrt(variance)

        # Clamp to avoid extreme z-scores from near-constant windows
        # A constant or near-constant window means normal behavior; don't amplify
        if past_std < 1e-6:
            # Past window is effectively constant; deviation is measured vs. the
            # past mean directly, capped at z=5.0 to avoid overflow
            deviation = abs(valid_values[i] - past_mean)
            z = min(deviation / 1e-6, 5.0)
            z_scores.append(z)
        else:
            z = (valid_values[i] - past_mean) / past_std
            z_scores.append(z)

    return z_scores


def identify_events(
    z_scores: list[float], dates: list[str]
) -> list[AnomalyEvent]:
    """
    Identify anomaly events from z-scores.

    Classifies each point as spike (z>2.5), drop (z<-2.5),
    or sustained_shift (3+ consecutive |z|>1.5).
    """
    events: list[AnomalyEvent] = []
    n = len(z_scores)

    # Pair z_scores with valid (date, value) pairs
    valid_pairs: list[tuple[str, float]] = []
    for d, v in zip(dates, z_scores):
        if not math.isnan(v):
            valid_pairs.append((d, v))

    if not valid_pairs:
        return events

    i = 0
    while i < len(valid_pairs):
        date_i, z_i = valid_pairs[i]

        # Check for sustained shift (3+ consecutive |z| > SUSTAINED_THRESHOLD)
        if i + 2 < len(valid_pairs):
            run_length = 1
            j = i
            while (
                j + 1 < len(valid_pairs)
                and abs(valid_pairs[j + 1][1]) > SUSTAINED_THRESHOLD
            ):
                run_length += 1
                j += 1

            if run_length >= SUSTAINED_MIN_RUN:
                magnitudes = [abs(valid_pairs[k][1]) for k in range(i, i + run_length)]
                max_z = max(magnitudes)
                start_date = valid_pairs[i][0]
                end_date = valid_pairs[i + run_length - 1][0]
                events.append(
                    AnomalyEvent(
                        start_date=start_date,
                        end_date=end_date,
                        type="sustained_shift",
                        magnitude=max_z,
                        severity="Media",  # will be recomputed
                        duration_days=run_length,
                        description="",
                        chart_annotation=True,
                    )
                )
                i += run_length
                continue

        # Single-day spike or drop
        if z_i >= Z_THRESHOLD:
            events.append(
                AnomalyEvent(
                    start_date=date_i,
                    end_date=date_i,
                    type="spike",
                    magnitude=abs(z_i),
                    severity="Media",  # will be recomputed
                    duration_days=1,
                    description="",
                    chart_annotation=True,
                )
            )
        elif z_i < -Z_THRESHOLD:
            events.append(
                AnomalyEvent(
                    start_date=date_i,
                    end_date=date_i,
                    type="drop",
                    magnitude=abs(z_i),
                    severity="Media",  # will be recomputed
                    duration_days=1,
                    description="",
                    chart_annotation=True,
                )
            )

        i += 1

    return events


def merge_consecutive_events(events: list[AnomalyEvent]) -> list[AnomalyEvent]:
    """
    Merge consecutive same-type events into a single event.
    Keeps max magnitude and earliest start_date of the run.
    """
    if not events:
        return []

    merged: list[AnomalyEvent] = []
    current = events[0]

    for next_event in events[1:]:
        if next_event.type == current.type:
            # Extend the run
            current = AnomalyEvent(
                start_date=current.start_date,
                end_date=next_event.end_date,
                type=current.type,
                magnitude=max(current.magnitude, next_event.magnitude),
                severity=current.severity,
                duration_days=current.duration_days + 1,
                description="",
                chart_annotation=True,
            )
        else:
            merged.append(current)
            current = next_event

    merged.append(current)
    return merged


def rank_and_truncate_events(events: list[AnomalyEvent], top_n: int = TOP_N_EVENTS) -> list[AnomalyEvent]:
    """Sort events by magnitude descending and return top N."""
    sorted_events = sorted(events, key=lambda e: e.magnitude, reverse=True)
    return sorted_events[:top_n]


def compute_severity(
    magnitude: float,
    duration_days: int,
    z_scores: list[float],
    event_start_idx: int,
) -> Literal["Alta", "Media", "Baja"]:
    """
    Compute severity from magnitude ONLY.

    Alta: |z| > 3.5
    Media: |z| in [2.5, 3.5]
    Baja: |z| >= 2.5, single-day, both adjacent |z| < 1.5
    """
    abs_mag = abs(magnitude)

    if abs_mag > 3.5:
        return "Alta"
    if abs_mag >= 2.5:
        if duration_days == 1:
            # Check adjacent z-scores
            n = len(z_scores)
            left_ok = (event_start_idx == 0) or (
                event_start_idx > 0 and abs(z_scores[event_start_idx - 1]) < 1.5
            )
            right_ok = (event_start_idx == n - 1) or (
                event_start_idx < n - 1 and abs(z_scores[event_start_idx + 1]) < 1.5
            )
            if left_ok and right_ok:
                return "Baja"
        return "Media"
    return "Media"


def generate_event_description(event: AnomalyEvent) -> str:
    """Generate templated description for an anomaly event."""
    if event.type == "spike":
        return (
            f"Significant increase detected on {event.start_date} — "
            f"value was {event.magnitude:.1f}σ above normal"
        )
    elif event.type == "drop":
        return (
            f"Significant decrease detected on {event.start_date} — "
            f"value was {event.magnitude:.1f}σ below normal"
        )
    else:  # sustained_shift
        return (
            f"Sustained anomaly from {event.start_date} to {event.end_date} — "
            f"max deviation {event.magnitude:.1f}σ"
        )


def detect_anomalies(series_data: dict, dates: list) -> AnomalyResult:
    """
    Detect anomalies in a time series. Pure function.

    Fallback conditions:
    - insufficient_observations: valid obs < 10
    - zero_variance: max - min < 1e-6
    - no_anomalies_above_threshold: no events with |z| >= 2.5

    Returns AnomalyResult with effective_report_type="summary" on fallback,
    "anomaly" otherwise.
    """
    if not series_data or not dates:
        return AnomalyResult(
            events=[],
            fallback_reason="insufficient_observations",
            effective_report_type="summary",
        )

    var_key = list(series_data.keys())[0]
    raw_values = series_data[var_key]

    # Filter valid values
    valid_pairs = [(d, v) for d, v in zip(dates, raw_values) if v is not None]
    valid_values = [v for _, v in valid_pairs]

    # Fallback 1: insufficient observations
    if len(valid_values) < 10:
        return AnomalyResult(
            events=[],
            fallback_reason="insufficient_observations",
            effective_report_type="summary",
        )

    # Fallback 2: zero variance
    if max(valid_values) - min(valid_values) < 1e-6:
        return AnomalyResult(
            events=[],
            fallback_reason="zero_variance",
            effective_report_type="summary",
        )

    # Compute z-scores
    z_scores = rolling_z_scores(series_data, dates)
    valid_dates = [d for d, v in zip(dates, series_data[var_key]) if v is not None]

    # Identify events
    events = identify_events(z_scores, valid_dates)

    # Merge consecutive events
    events = merge_consecutive_events(events)

    # Rank and truncate
    events = rank_and_truncate_events(events)

    # Fallback 3: no anomalies above threshold
    if not events:
        return AnomalyResult(
            events=[],
            fallback_reason="no_anomalies_above_threshold",
            effective_report_type="summary",
        )

    # Compute severity and description for each event
    # Build a mapping from date to z-score for adjacency checks
    date_to_z: dict[str, float] = {}
    for d, z in zip(valid_dates, z_scores):
        if not math.isnan(z):
            date_to_z[d] = z

    final_events: list[AnomalyEvent] = []
    for event in events:
        # Find the index in valid_dates for adjacency
        try:
            event_idx = valid_dates.index(event.start_date)
        except ValueError:
            event_idx = 0

        severity = compute_severity(
            event.magnitude, event.duration_days, z_scores, event_idx
        )
        description = generate_event_description(event)

        final_events.append(
            AnomalyEvent(
                start_date=event.start_date,
                end_date=event.end_date,
                type=event.type,
                magnitude=event.magnitude,
                severity=severity,
                duration_days=event.duration_days,
                description=description,
                chart_annotation=True,
            )
        )

    return AnomalyResult(
        events=final_events,
        fallback_reason=None,
        effective_report_type="anomaly",
    )


# ---------------------------------------------------------------------------
# GIF frame extraction (with caching)
# ---------------------------------------------------------------------------

def extract_frame_for_date(gif_path: str, event_start_date: str, dates: list[str], cache_dir: Path | None = None) -> str:
    """
    Map event start_date to the corresponding GIF frame using proportional indexing.

    Algorithm:
        date_range_days = dates[-1] - dates[0]  (as int)
        event_offset_days = event_start_date - dates[0]  (as int)
        frame_index = round(event_offset_days / date_range_days * (N_frames - 1))
        Clamp to [0, N_frames - 1]
        Fallback: extract_middle_frame() if any computation fails

    Args:
        gif_path: relative path to GIF (e.g. "gifs/ndvi_2020_abc123.gif")
        event_start_date: ISO date string of the event (e.g. "2020-06-15")
        dates: sorted list of ISO date strings spanning the GIF period
        cache_dir: optional cache directory (defaults to GIFS_DIR)

    Returns:
        Absolute path to selected frame PNG

    Raises:
        FileNotFoundError: if GIF does not exist
    """
    from datetime import datetime

    if cache_dir is None:
        cache_dir = GIFS_DIR

    # Normalize gif path
    normalized = gif_path.removeprefix("/static/") if gif_path.startswith("/static/") else gif_path
    full_gif_path = STATIC_DIR / normalized

    # Verify GIF exists
    if not full_gif_path.exists():
        raise FileNotFoundError(f"GIF not found: {gif_path}")

    try:
        # Parse dates
        parsed_dates = [datetime.strptime(d, "%Y-%m-%d").date() for d in dates]
        parsed_event_date = datetime.strptime(event_start_date, "%Y-%m-%d").date()

        if len(parsed_dates) < 2:
            return extract_middle_frame(gif_path, cache_dir)

        first_date = parsed_dates[0]
        last_date = parsed_dates[-1]
        date_range_days = (last_date - first_date).days

        if date_range_days == 0:
            return extract_middle_frame(gif_path, cache_dir)

        event_offset_days = (parsed_event_date - first_date).days
        event_offset_days = max(0, min(event_offset_days, date_range_days))

        # Open GIF and get frame count
        gif = PILImage.open(str(full_gif_path))
        frames = list(ImageSequence.Iterator(gif))
        n_frames = len(frames)
        if n_frames == 1:
            # Single-frame GIF — return that frame
            cache_path = cache_dir / f"{Path(normalized).stem}_frame.png"
            if cache_path.exists():
                return str(cache_path)
            frame = frames[0]
            if frame.mode not in ("RGB", "RGBA"):
                frame = frame.convert("RGB")
            frame.save(str(cache_path), "PNG")
            return str(cache_path)

        # Proportional frame index
        frame_index = round(event_offset_days / date_range_days * (n_frames - 1))
        frame_index = max(0, min(frame_index, n_frames - 1))

        stem = Path(normalized).stem
        cache_path = cache_dir / f"{stem}_frame_{frame_index}.png"

        if cache_path.exists():
            return str(cache_path)

        frame = frames[frame_index]
        if frame.mode not in ("RGB", "RGBA"):
            frame = frame.convert("RGB")
        frame.save(str(cache_path), "PNG")
        logger.debug("Frame %d extraído y cacheado: %s", frame_index, cache_path)
        return str(cache_path)

    except Exception:
        # Any computation error → fallback to middle frame
        return extract_middle_frame(gif_path, cache_dir)


def extract_middle_frame(gif_path: str, cache_dir: Path | None = None) -> str:
    """
    Extrae el frame del medio de un GIF animado y lo guarda como PNG en caché.

    Args:
        gif_path: ruta relativa a STATIC_DIR, ej "gifs/ndvi_2020_abc123.gif"
        cache_dir: directorio donde guardar el PNG cacheado.
                   Defaults a GIFS_DIR (directorio de GIFs).

    Returns:
        Ruta absoluta al PNG del frame extraído.

    Raises:
        FileNotFoundError: si el GIF no existe.
    """
    if cache_dir is None:
        cache_dir = GIFS_DIR

    # Normalizar ruta del GIF
    normalized = gif_path.removeprefix("/static/") if gif_path.startswith("/static/") else gif_path
    full_gif_path = STATIC_DIR / normalized

    # Generar nombre de caché: mismo stem + _frame.png
    stem = Path(normalized).stem
    cache_path = cache_dir / f"{stem}_frame.png"

    # Devolver caché si ya existe (evita reprocesar el GIF)
    if cache_path.exists():
        return str(cache_path)

    # Verificar que el GIF exista antes de procesarlo
    if not full_gif_path.exists():
        raise FileNotFoundError(f"GIF not found: {gif_path}")

    # Extraer frame del medio
    gif = PILImage.open(str(full_gif_path))
    frames = list(ImageSequence.Iterator(gif))
    mid_index = len(frames) // 2
    mid_frame = frames[mid_index]

    # Convertir a RGB si es necesario (para PNG)
    if mid_frame.mode not in ("RGB", "RGBA"):
        mid_frame = mid_frame.convert("RGB")

    # Guardar como PNG
    mid_frame.save(str(cache_path), "PNG")
    logger.debug("Frame extraído y cacheado: %s", cache_path)

    return str(cache_path)


def build_pdf_context(
    series_data: dict[str, Any],
    dates: list[str],
    stats: dict[str, dict[str, Any]],
    chart_blob: str,
    gif_frame_path: str | None,
    bbox: list[float],
    metadata: dict[str, Any],
    anomaly_result: AnomalyResult | None = None,
) -> dict[str, Any]:
    """
    Construye el dict de contexto para la plantilla Jinja2 del PDF.

    Args:
        series_data: dict de {variable_key: [float|null]}
        dates: lista de fechas
        stats: resultado de compute_statistics()
        chart_blob: PNG base64 del chart
        gif_frame_path: ruta absoluta al PNG del frame del GIF (o None)
        bbox: [minLon, minLat, maxLon, maxLat]
        metadata: {variableKeys, panel}
        anomaly_result: resultado del detector de anomalías (always passed now)

    Returns:
        dict de contexto para renderizar la plantilla
    """
    from datetime import datetime

    variable_keys = metadata.get("variableKeys", [])

    # Primera variable como principal (MVP single-variable)
    primary_var = variable_keys[0] if variable_keys else list(series_data.keys())[0]

    # Etiquetas legibles de variables
    VARIABLE_LABELS = {
        "ndvi": "NDVI (Índice de Vegetación)",
        "temp": "Temperatura (°C)",
        "soil": "Humedad del suelo (%)",
        "precip": "Precipitación (mm/día)",
        "water": "Superficie de agua (ha)",
        "local_sp": "Nivel San Pedro (m)",
        "local_bd": "Nivel Boca del Cerro (m)",
    }

    label = VARIABLE_LABELS.get(primary_var, primary_var)

    # Rango de fechas
    if dates:
        date_range = f"{dates[0]} → {dates[-1]}"
    else:
        date_range = "—"

    # Trend interpretation
    trend_map = {
        "↑": "Tendencia al alza",
        "↓": "Tendencia a la baja",
        "→": "Estable",
    }
    primary_stats = stats.get(primary_var, {})
    trend_str = trend_map.get(primary_stats.get("trend", "→"), "Estable")

    # Interpretation text per variable
    INTERPRETATIONS = {
        "ndvi": "El NDVI mide la salud de la vegetación. Valores positivos indican vegetación densa y saludable.",
        "temp": "La temperatura superficial influencia procesos de evapotranspiración y desarrollo de cultivos.",
        "soil": "La humedad del suelo es crítica para el estrés hídrico de cultivos y la infiltración.",
        "precip": "La precipitación diaria determina la recarga de acuíferos y el riesgo de inundación.",
        "water": "La superficie de agua indica la disponibilidad hídrica y cambios en cuerpos de agua.",
        "local_sp": "Nivel medido en la estación San Pedro (Balancán).",
        "local_bd": "Nivel medido en la estación Boca del Cerro (Tenosique).",
    }
    interpretation = INTERPRETATIONS.get(primary_var, "Datos geoespacialesanalizados.")

    context: dict[str, Any] = {
        "variable_label": label,
        "date_range": date_range,
        "bbox": bbox,
        "chart_blob": chart_blob,
        "gif_frame_path": gif_frame_path if gif_frame_path else "",
        "stats": stats,
        "primary_var": primary_var,
        "primary_stats": primary_stats,
        "trend_str": trend_str,
        "interpretation": interpretation,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "panel": metadata.get("panel", "A"),
    }

    # Anomaly context injection — anomaly_result is always passed (never None now)
    # but we guard for backward compatibility with unit tests
    if anomaly_result is None:
        anomaly_result = AnomalyResult(events=[], fallback_reason=None)

    context["fallback_reason"] = anomaly_result.fallback_reason

    if anomaly_result.events:
        # Top event for executive summary and frame selection
        top_event = anomaly_result.events[0]
        context["no_anomalies"] = False
        context["top_event_type"] = top_event.type
        context["top_event_date"] = top_event.start_date
        context["top_event_severity"] = top_event.severity
        context["summary_text"] = _generate_executive_summary(top_event)
        context["spatial_caption"] = "Mapa en el momento del evento principal"
        context["anomaly_events"] = [
            {
                "start_date": e.start_date,
                "end_date": e.end_date,
                "type": e.type,
                "magnitude": e.magnitude,
                "severity": e.severity,
                "duration_days": e.duration_days,
                "description": e.description,
                "chart_annotation": e.chart_annotation,
            }
            for e in anomaly_result.events
        ]
    else:
        # No anomalies
        context["no_anomalies"] = True
        context["top_event_type"] = ""
        context["top_event_date"] = ""
        context["top_event_severity"] = ""
        context["summary_text"] = (
            "No se detectaron anomalías significativas en el período analizado. "
            "Los valores observados se encuentran dentro de los rangos esperados."
        )
        context["spatial_caption"] = "Vista del período analizado"
        context["anomaly_events"] = []

    return context


def _generate_executive_summary(event: AnomalyEvent) -> str:
    """
    Generate a 2-3 sentence executive summary from the top anomaly event.
    """
    type_labels = {
        "spike": "aumento significativo",
        "drop": "descenso significativo",
        "sustained_shift": "desviación sostenida",
    }
    type_label = type_labels.get(event.type, event.type)
    severity = event.severity.lower()

    if event.type == "sustained_shift":
        return (
            f"Se detectó una {type_label} entre el {event.start_date} y el {event.end_date} "
            f"(duración: {event.duration_days} días). "
            f"La desviación máxima alcanzó {event.magnitude:.1f}σ con respecto a la media histórica, "
            f"clasificada como severidad {severity}."
        )
    else:
        return (
            f"Se registró un {type_label} el {event.start_date} "
            f"con una desviación de {event.magnitude:.1f}σ respecto a la media histórica, "
            f"clasificada como severidad {severity}."
        )


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------

def render_pdf_report(context: dict[str, Any], output_path: Path | None = None) -> bytes:
    """
    Renderiza el PDF report desde el contexto y devuelve los bytes del PDF.

    Args:
        context: dict de contexto (resultado de build_pdf_context)
        output_path: ruta donde guardar el PDF (opcional, para debugging)

    Returns:
        Bytes del PDF generado

    Raises:
        RuntimeError: si WeasyPrint no puede renderizar el documento
    """
    from pathlib import Path as P

    from jinja2 import Environment, FileSystemLoader, select_autoescape

    # Obtener la ruta de la plantilla
    from config import BASE_DIR
    template_dir = BASE_DIR / "templates"
    static_dir = BASE_DIR / "static"

    # Configurar Jinja2
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html", "xml"]),
    )

    # Renderizar plantilla
    template = env.get_template("pdf_report.html")
    html_rendered = template.render(context)

    # Importar WeasyPrint lazily para capturar error si no está disponible
    try:
        import weasyprint
    except ImportError as e:
        raise RuntimeError(
            "WeasyPrint no está instalado o sus dependencias del sistema (cairo, pango) "
            "no están disponibles. Instale con: pip install weasyprint>=60.0"
        ) from e

    # CSS path
    css_path = static_dir / "css" / "pdf_report.css"

    # Generar PDF con WeasyPrint
    weasy_html = weasyprint.HTML(
        string=html_rendered,
        base_url=str(template_dir.absolute()),
    )

    # Añadir stylesheet si existe
    stylesheets = []
    if css_path.exists():
        stylesheets.append(str(css_path.absolute()))

    pdf_bytes = weasy_html.write_pdf(stylesheets=stylesheets)

    # Guardar a disco si se pide
    if output_path:
        with open(output_path, "wb") as f:
            f.write(pdf_bytes)

    return pdf_bytes


# Alias para mantener consistencia con la nomenclatura del design
def compute_stats(series_data: dict[str, Any], dates: list[str]) -> dict[str, dict[str, Any]]:
    """Alias de compute_statistics para mantener compatibilidad."""
    return compute_statistics(series_data, dates)