/**
 * Factory de event listeners para las variables hidrometeorológicas.
 *
 * Reemplaza los 5 bloques if-then casi idénticos del main.ts original por una
 * función genérica `registerVariableListener` que acepta la configuración de
 * cada variable como parámetro.
 */
import type { VariableKey, BBox } from '../types.js';
export interface VariableListenerConfig {
    /** Clave de la variable (ndvi, temp, soil, precip, water) */
    variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    /** Input de fecha inicio */
    startInput: HTMLInputElement | null;
    /** Input de fecha fin */
    endInput: HTMLInputElement | null;
    /** Botón que dispara la petición */
    button: HTMLButtonElement | null;
    /** Getter reactivo del bbox actual (puede cambiar entre clics) */
    getBbox: () => BBox | null;
    /** Callback que realiza la petición al backend */
    onRequest: (variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>, start: string, end: string, bbox: BBox) => void;
}
/**
 * Registra un event listener en el botón de la variable indicada.
 *
 * Valida fechas y bbox antes de llamar a onRequest. Si alguna validación
 * falla, muestra un alert y no llama al callback.
 */
export declare function registerVariableListener(cfg: VariableListenerConfig): void;
//# sourceMappingURL=variableListeners.d.ts.map