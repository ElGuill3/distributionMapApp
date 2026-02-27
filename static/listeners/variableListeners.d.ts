/**
 * Factory de event listeners para las variables hidrometeorológicas.
 *
 * Reemplaza los inputs de fecha libre por selectores de año + temporada.
 * Exporta además `seasonToDates` e `isLeapYear` para uso en main.ts.
 */
import type { VariableKey, BBox, Season } from '../types.js';
export declare function isLeapYear(year: number): boolean;
/**
 * Convierte año + temporada a un rango de fechas ISO.
 *
 * Temporadas:
 *   invierno  → Y-12-01 .. (Y+1)-02-28/29
 *   primavera → Y-03-01 .. Y-05-31
 *   verano    → Y-06-01 .. Y-08-31
 *   otono     → Y-09-01 .. Y-11-30
 *   anual     → Y-01-01 .. Y-12-31
 */
export declare function seasonToDates(year: number, season: Season): {
    start: string;
    end: string;
};
export interface VariableListenerConfig {
    /** Clave de la variable (ndvi, temp, soil, precip, water) */
    variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    /** Select de año */
    yearSelect: HTMLSelectElement | null;
    /** Select de temporada */
    seasonSelect: HTMLSelectElement | null;
    /** Botón que dispara la petición */
    button: HTMLButtonElement | null;
    /** Getter reactivo del bbox actual */
    getBbox: () => BBox | null;
    /** Callback que realiza la petición al backend (misma firma que antes) */
    onRequest: (variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>, start: string, end: string, bbox: BBox) => void;
}
/**
 * Registra el comportamiento completo de una variable:
 *  1. Puebla los selects de año y temporada.
 *  2. Habilita/deshabilita reactivamente temporada y botón.
 *  3. Al pulsar el botón convierte año+temporada a fechas ISO y llama a onRequest.
 */
export declare function registerVariableListener(cfg: VariableListenerConfig): void;
//# sourceMappingURL=variableListeners.d.ts.map