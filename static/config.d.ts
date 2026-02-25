/**
 * Configuración de la aplicación frontend.
 * Todas las constantes de UI y de llamadas a la API viven aquí.
 */
import type { VariableKey } from './types.js';
export declare const DEFAULT_CENTER: [number, number];
export declare const DEFAULT_ZOOM = 8;
export declare const MAX_SPAN_DEG = 8;
/** Mapa de VariableKey → URL base del endpoint gif-bbox */
export declare const GIF_ENDPOINT: Record<Exclude<VariableKey, 'local_sp' | 'local_bd'>, string>;
/** Mapa de VariableKey → URL base del endpoint timeseries-bbox */
export declare const TS_ENDPOINT: Record<Exclude<VariableKey, 'local_sp' | 'local_bd'>, string>;
//# sourceMappingURL=config.d.ts.map