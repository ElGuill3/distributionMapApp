/**
 * Módulo de indicador de progreso para la generación de GIFs.
 *
 * Crea un overlay modal fijo en pantalla con barra de progreso y mensaje.
 * Se actualiza desde los eventos SSE del endpoint /api/gif-progress/<task_id>.
 */
/**
 * Crea y añade al DOM el indicador de progreso.
 * Si ya existe uno previo, lo elimina antes de crear el nuevo.
 *
 * @returns Referencia al div del indicador (ya añadido al body).
 */
export declare function createProgressIndicator(): HTMLDivElement;
/**
 * Actualiza el indicador de progreso con el porcentaje y mensaje recibidos.
 *
 * @param progress - Valor 0–100 (progreso normal) o –1 (error).
 * @param message  - Texto descriptivo del estado actual.
 */
export declare function updateProgressIndicator(progress: number, message: string): void;
/**
 * Elimina el indicador de progreso del DOM.
 * @param delayMs - Espera opcional antes de eliminarlo (ms).
 */
export declare function removeProgressIndicator(delayMs?: number): void;
//# sourceMappingURL=progress.d.ts.map