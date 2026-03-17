/**
 * Módulo de indicador de progreso para la generación de GIFs.
 *
 * Crea un overlay modal fijo en pantalla con barra de progreso y mensaje.
 * Se actualiza desde los eventos SSE del endpoint /api/gif-progress/<task_id>.
 */
const INDICATOR_ID = 'loading-indicator';
/**
 * Crea y añade al DOM el indicador de progreso.
 * Si ya existe uno previo, lo elimina antes de crear el nuevo.
 *
 * @returns Referencia al div del indicador (ya añadido al body).
 */
export function createProgressIndicator() {
    var _a;
    (_a = document.getElementById(INDICATOR_ID)) === null || _a === void 0 ? void 0 : _a.remove();
    const div = document.createElement('div');
    div.id = INDICATOR_ID;
    div.innerHTML = `
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.9); color: white; padding: 30px;
                border-radius: 12px; z-index: 10000; min-width: 400px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
      <div style="text-align: center;">
        <div style="font-size: 20px; margin-bottom: 15px; font-weight: bold;">
          Procesando GIF
        </div>
        <div id="progress-message"
             style="font-size: 14px; margin-bottom: 15px; color: #aaa;">
          Iniciando...
        </div>
        <div style="background: #333; border-radius: 10px; overflow: hidden;
                    height: 24px; margin-bottom: 10px;">
          <div id="progress-bar"
               style="background: linear-gradient(90deg, #4CAF50, #8BC34A);
                      height: 100%; width: 0%; transition: width 0.3s ease;
                      display: flex; align-items: center; justify-content: center;
                      font-size: 12px; font-weight: bold;"></div>
        </div>
        <div id="progress-percent"
             style="font-size: 16px; font-weight: bold; color: #4CAF50;">0%</div>
      </div>
    </div>
  `;
    document.body.appendChild(div);
    return div;
}
/**
 * Actualiza el indicador de progreso con el porcentaje y mensaje recibidos.
 *
 * @param progress - Valor 0–100 (progreso normal) o –1 (error).
 * @param message  - Texto descriptivo del estado actual.
 */
export function updateProgressIndicator(progress, message) {
    const barEl = document.getElementById('progress-bar');
    const msgEl = document.getElementById('progress-message');
    const pctEl = document.getElementById('progress-percent');
    if (!barEl || !msgEl || !pctEl)
        return;
    if (progress === -1) {
        barEl.style.background = 'linear-gradient(90deg, #f44336, #e53935)';
        barEl.style.width = '100%';
        msgEl.textContent = `Error: ${message}`;
        pctEl.textContent = 'Error';
        pctEl.style.color = '#f44336';
        return;
    }
    const pct = Math.max(0, Math.min(100, progress));
    barEl.style.width = `${pct}%`;
    barEl.textContent = pct > 20 ? `${pct}%` : '';
    msgEl.textContent = message;
    pctEl.textContent = `${pct}%`;
}
/**
 * Elimina el indicador de progreso del DOM.
 * @param delayMs - Espera opcional antes de eliminarlo (ms).
 */
export function removeProgressIndicator(delayMs = 0) {
    var _a;
    if (delayMs > 0) {
        setTimeout(() => { var _a; return (_a = document.getElementById(INDICATOR_ID)) === null || _a === void 0 ? void 0 : _a.remove(); }, delayMs);
    }
    else {
        (_a = document.getElementById(INDICATOR_ID)) === null || _a === void 0 ? void 0 : _a.remove();
    }
}
//# sourceMappingURL=progress.js.map