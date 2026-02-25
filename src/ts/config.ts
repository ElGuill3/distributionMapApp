/**
 * Configuración de la aplicación frontend.
 * Todas las constantes de UI y de llamadas a la API viven aquí.
 */

import type { VariableKey } from './types.js';

export const DEFAULT_CENTER: [number, number] = [17.8409, -92.6189];
export const DEFAULT_ZOOM   = 8;
export const MAX_SPAN_DEG   = 8.0;

/** Mapa de VariableKey → URL base del endpoint gif-bbox */
export const GIF_ENDPOINT: Record<Exclude<VariableKey, 'local_sp' | 'local_bd'>, string> = {
  ndvi:   '/api/ndvi-gif-bbox',
  temp:   '/api/era5-temp-gif-bbox',
  soil:   '/api/era5-soil-gif-bbox',
  precip: '/api/imerg-precip-gif-bbox',
  water:  '/api/water-gif-bbox',
};

/** Mapa de VariableKey → URL base del endpoint timeseries-bbox */
export const TS_ENDPOINT: Record<Exclude<VariableKey, 'local_sp' | 'local_bd'>, string> = {
  ndvi:   '/api/ndvi-timeseries-bbox',
  temp:   '/api/era5-temp-timeseries-bbox',
  soil:   '/api/era5-soil-timeseries-bbox',
  precip: '/api/imerg-precip-timeseries-bbox',
  water:  '/api/water-timeseries-bbox',
};
