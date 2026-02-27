/**
 * Tipos y contratos de datos compartidos entre frontend y backend.
 *
 * Estas interfaces reflejan exactamente las respuestas JSON de los endpoints
 * Flask. Cualquier cambio en el contrato debe actualizarse aquí primero.
 */
/** [minLon, minLat, maxLon, maxLat] en grados decimales WGS-84 */
export type BBox = [number, number, number, number];
/** Temporadas disponibles para los selectores de período */
export type Season = 'invierno' | 'primavera' | 'verano' | 'otono' | 'anual';
/** Variables hidrometeorológicas soportadas por la aplicación */
export type VariableKey = 'ndvi' | 'temp' | 'soil' | 'precip' | 'water' | 'local_sp' | 'local_bd';
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
/** Serie temporal en memoria (resultado de fetch o datos locales) */
export interface SeriesData {
    dates: string[];
    values: number[];
}
/**
 * Mapea cada VariableKey a la clave de datos en TimeseriesResponse/GifResponse.
 * Las variables locales (local_sp, local_bd) usan su propio endpoint y no
 * necesitan esta clave — se incluyen con un valor placeholder ('ndvi') que
 * nunca se usa para ellas.
 */
export declare const VARIABLE_DATA_KEY: Readonly<Record<VariableKey, keyof TimeseriesResponse>>;
//# sourceMappingURL=types.d.ts.map