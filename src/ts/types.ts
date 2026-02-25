/**
 * Tipos y contratos de datos compartidos entre frontend y backend.
 *
 * Estas interfaces reflejan exactamente las respuestas JSON de los endpoints
 * Flask. Cualquier cambio en el contrato debe actualizarse aquí primero.
 */

// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

/** [minLon, minLat, maxLon, maxLat] en grados decimales WGS-84 */
export type BBox = [number, number, number, number];

/** Variables hidrometeorológicas soportadas por la aplicación */
export type VariableKey =
  | 'ndvi'
  | 'temp'
  | 'soil'
  | 'precip'
  | 'water'
  | 'local_sp'
  | 'local_bd';

// ---------------------------------------------------------------------------
// Respuestas de la API
// ---------------------------------------------------------------------------

/** Respuesta de los endpoints *-gif-bbox */
export interface GifResponse {
  gifUrl: string;
  bbox: BBox;
  dates: string[];
  /** Valores de NDVI (0–1) */
  ndvi?: number[];
  /** Temperatura en °C */
  temp?: number[];
  /** Humedad del suelo en % */
  soil_pct?: number[];
  /** Precipitación en mm */
  precip_mm?: number[];
  /** Superficie de agua en ha */
  water_ha?: number[];
}

/** Respuesta de los endpoints *-timeseries-bbox */
export interface TimeseriesResponse {
  dates: string[];
  bbox: BBox;
  ndvi?: number[];
  temp?: number[];
  soil_pct?: number[];
  precip_mm?: number[];
  water_ha?: number[];
}

/** Respuesta de /api/local-station-level-range */
export interface StationResponse {
  station: string;
  dates: string[];
  level_m: number[];
}

/** Respuesta de /api/flood-risk-municipio */
export interface FloodRiskResponse {
  mapUrl: string;
  bbox: BBox;
}

/** Respuesta de error genérica */
export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// Estado interno del frontend
// ---------------------------------------------------------------------------

/** Serie temporal en memoria (resultado de fetch o datos locales) */
export interface SeriesData {
  dates: string[];
  values: number[];
}

// ---------------------------------------------------------------------------
// Configuración de variables — mapeo a claves de respuesta
// ---------------------------------------------------------------------------

/**
 * Mapea cada VariableKey a la clave de datos en TimeseriesResponse/GifResponse.
 * Las variables locales (local_sp, local_bd) usan su propio endpoint y no
 * necesitan esta clave — se incluyen con un valor placeholder ('ndvi') que
 * nunca se usa para ellas.
 */
export const VARIABLE_DATA_KEY: Readonly<Record<VariableKey, keyof TimeseriesResponse>> = {
  ndvi:     'ndvi',
  temp:     'temp',
  soil:     'soil_pct',
  precip:   'precip_mm',
  water:    'water_ha',
  local_sp: 'ndvi',
  local_bd: 'ndvi',
} as const;
