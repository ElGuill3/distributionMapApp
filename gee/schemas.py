"""
Schemas Pydantic para validación de entrada en la capa de ruta.

Este módulo define los schemas de validación usados en los endpoints
antes de llamar a cualquier servicio GEE.
"""

import json
from datetime import date, datetime
from typing import List, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from config import MAX_YEARS_RANGE


class BBoxSchema(BaseModel):
    """Schema para validar bounding boxes geográficos."""

    min_lon: float = Field(ge=-180.0, le=180.0)
    min_lat: float = Field(ge=-90.0, le=90.0)
    max_lon: float = Field(ge=-180.0, le=180.0)
    max_lat: float = Field(ge=-90.0, le=90.0)

    @model_validator(mode="after")
    def min_less_than_max(self) -> "BBoxSchema":
        if not (self.min_lon < self.max_lon):
            raise ValueError("min_lon must be less than max_lon")
        if not (self.min_lat < self.max_lat):
            raise ValueError("min_lat must be less than max_lat")
        return self


class DateRangeSchema(BaseModel):
    """Schema para validar rangos de fecha."""

    start: date
    end: date

    @field_validator("start", "end", mode="before")
    @classmethod
    def parse_yyyy_mm_dd(cls, v: date | str) -> date:
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return datetime.strptime(v, "%Y-%m-%d").date()
        raise ValueError("must be YYYY-MM-DD")

    @model_validator(mode="after")
    def end_after_start(self) -> "DateRangeSchema":
        if not (self.end > self.start):
            raise ValueError("end must be after start")
        return self

    @model_validator(mode="after")
    def max_10_years(self) -> "DateRangeSchema":
        span_days = (self.end - self.start).days
        if span_days / 365.25 > MAX_YEARS_RANGE:
            raise ValueError(f"date range exceeds {int(MAX_YEARS_RANGE)} years")
        return self


class StationQuerySchema(BaseModel):
    """Schema para endpoints de estaciones hidrológicas."""

    station_id: Literal["SPTTB", "BDCTB"]
    start: date
    end: date

    @field_validator("start", "end", mode="before")
    @classmethod
    def parse_yyyy_mm_dd(cls, v: date | str) -> date:
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return datetime.strptime(v, "%Y-%m-%d").date()
        raise ValueError("must be YYYY-MM-DD")

    @model_validator(mode="after")
    def end_after_start(self) -> "StationQuerySchema":
        if not (self.end > self.start):
            raise ValueError("end must be after start")
        return self

    @model_validator(mode="after")
    def max_10_years(self) -> "StationQuerySchema":
        span_days = (self.end - self.start).days
        if span_days / 365.25 > MAX_YEARS_RANGE:
            raise ValueError(f"date range exceeds {int(MAX_YEARS_RANGE)} years")
        return self


# ALERT: Keep in sync with MUNICIPAL_TIFS keys in config.py
MUNI_KEYS = Literal[
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


class MuniQuerySchema(BaseModel):
    """Schema para endpoints de riesgo por municipio."""

    muni: MUNI_KEYS
    palette: str = "gee_flood"


class ExportMetadataSchema(BaseModel):
    """Schema para metadatos de exportación."""

    model_config = {"populate_by_name": True}

    variableKeys: List[str]
    panel: Literal["A", "B"]


class PdfReportRequestSchema(BaseModel):
    """
    Schema para validar peticiones al endpoint de PDF report.

    chart_blob: PNG del chart codificado en base64 (desde Plotly.toImage).
    gif_path: ruta relativa al GIF animado, ej "gifs/ndvi_2020_abc123.gif".
    series_data: datos de series temporales con dates y variables.
    bbox: [minLon, minLat, maxLon, maxLat].
    metadata: variableKeys y panel.
    """

    model_config = {"populate_by_name": True}

    chart_blob: str = Field(..., description="base64-encoded PNG from Plotly chart")
    gif_path: str = Field(..., description="Relative path to GIF, e.g. gifs/ndvi_2020_abc123.gif")
    series_data: "SeriesDataSchema"
    bbox: List[float] = Field(examples=[[-92.5, 17.0, -91.0, 18.0]])

    @field_validator("bbox")
    @classmethod
    def bbox_must_have_4_elements(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("bbox must have exactly 4 elements [minLon, minLat, maxLon, maxLat]")
        return v
    metadata: ExportMetadataSchema


class SeriesDataSchema(BaseModel):
    """Schema para datos de series temporales en petición de exportación."""

    dates: List[str] = Field(min_length=1)
    variables: dict[str, List[float | None]] = Field(default_factory=dict)


class ExportRequestSchema(BaseModel):
    """
    Schema para validar peticiones al endpoint de export bundle.

    gifPaths: rutas relativas a STATIC_DIR ej: ["gifs/ndvi_abc123.gif"]
    panel: panel activo 'A' o 'B'
    seriesData: dict con dates (lista de YYYY-MM-DD) y variables (keyed por nombre)
    bbox: [minLon, minLat, maxLon, maxLat]
    metadata: variableKeys y panel
    """

    gifPaths: List[str] = Field(default_factory=list)
    panel: Literal["A", "B"]
    seriesData: SeriesDataSchema
    bbox: List[float] = Field(examples=[[-92.5, 17.0, -91.0, 18.0]])
    metadata: ExportMetadataSchema


def _parse_bbox_str(bbox_str: str) -> List[float]:
    """
    Parsea un string JSON de bbox a list[float].

    Args:
        bbox_str: string JSON con formato '[minLon, minLat, maxLon, maxLat]'.

    Returns:
        Lista de 4 floats [minLon, minLat, maxLon, maxLat].

    Raises:
        ValueError: si el formato no es un array JSON de exactamente 4 números.
    """
    bbox = json.loads(bbox_str)
    if not (isinstance(bbox, list) and len(bbox) == 4):
        raise ValueError("bbox must be a JSON array of 4 numbers")
    try:
        return [float(v) for v in bbox]
    except (ValueError, TypeError):
        raise ValueError("bbox must be a JSON array of 4 numbers")
