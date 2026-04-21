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
export function createProgressIndicator(): HTMLDivElement {
  document.getElementById(INDICATOR_ID)?.remove();

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
export function updateProgressIndicator(progress: number, message: string): void {
  const barEl     = document.getElementById('progress-bar');
  const msgEl     = document.getElementById('progress-message');
  const pctEl     = document.getElementById('progress-percent');

  if (!barEl || !msgEl || !pctEl) return;

  if (progress === -1) {
    barEl.style.background = 'linear-gradient(90deg, #f44336, #e53935)';
    barEl.style.width      = '100%';
    msgEl.textContent      = `Error: ${message}`;
    pctEl.textContent      = 'Error';
    pctEl.style.color      = '#f44336';
    return;
  }

  const pct             = Math.max(0, Math.min(100, progress));
  barEl.style.width     = `${pct}%`;
  barEl.textContent     = pct > 20 ? `${pct}%` : '';
  msgEl.textContent     = message;
  pctEl.textContent     = `${pct}%`;
}

/**
 * Elimina el indicador de progreso del DOM.
 * @param delayMs - Espera opcional antes de eliminarlo (ms).
 */
export function removeProgressIndicator(delayMs = 0): void {
  if (delayMs > 0) {
    setTimeout(() => document.getElementById(INDICATOR_ID)?.remove(), delayMs);
  } else {
    document.getElementById(INDICATOR_ID)?.remove();
  }
}

// ---------------------------------------------------------------------------
// Error modal
// ---------------------------------------------------------------------------

const ERROR_MODAL_ID = 'error-modal';

/**
 * Muestra un modal de error blocking con título, mensaje y acción opcional.
 *
 * Reutiliza la estructura DOM del loading-indicator existente, reconfigurándolo
 * en modo error (barra roja, título+ mensaje, botón de retry opcional).
 * El modal tiene role="alertdialog" para accessibility.
 *
 * @param title        - Título del error (se muestra en negrita).
 * @param message      - Descripción detallada del error.
 * @param retryAction  - Callback opcional para el botón "Reintentar".
 */
export function showErrorModal(
  title: string,
  message: string,
  retryAction?: () => void,
): void {
  // Eliminar cualquier modal de error previo
  closeErrorModal();

  const div = document.createElement('div');
  div.id = ERROR_MODAL_ID;
  div.setAttribute('role', 'alertdialog');
  div.setAttribute('aria-modal', 'true');
  div.setAttribute('aria-labelledby', 'error-modal-title');
  div.setAttribute('tabindex', '-1');

  const retryButton =
    retryAction !== undefined
      ? `<button id="error-modal-retry"
                     style="margin-top: 16px; padding: 8px 20px;
                            background: #f44336; color: white;
                            border: none; border-radius: 6px;
                            cursor: pointer; font-size: 14px;">
                     Reintentar
                 </button>`
      : '';

  div.innerHTML = `
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.92); color: white; padding: 30px;
                border-radius: 12px; z-index: 10001; min-width: 420px; max-width: 560px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.6);">
      <div style="text-align: center;">
        <div style="font-size: 22px; margin-bottom: 8px; font-weight: bold; color: #f44336;">
          ⚠ <span id="error-modal-title">${escapeHtml(title)}</span>
        </div>
        <div style="font-size: 14px; margin-bottom: 20px; color: #ddd; line-height: 1.5;">
          ${escapeHtml(message)}
        </div>
        <div style="background: #333; border-radius: 10px; overflow: hidden;
                    height: 8px; margin-bottom: 20px;">
          <div style="background: linear-gradient(90deg, #f44336, #e53935);
                     height: 100%; width: 100%;"></div>
        </div>
        ${retryButton}
        <button id="error-modal-close"
                style="margin-top: 12px; padding: 8px 20px;
                       background: transparent; color: #aaa;
                       border: 1px solid #555; border-radius: 6px;
                       cursor: pointer; font-size: 14px;">
          Cerrar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(div);

  // Botón cerrar
  document
    .getElementById('error-modal-close')
    ?.addEventListener('click', closeErrorModal);

  // Botón retry
  if (retryAction !== undefined) {
    document
      .getElementById('error-modal-retry')
      ?.addEventListener('click', () => {
        closeErrorModal();
        retryAction();
      });
  }

  // Escape cierra el modal
  const escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeErrorModal();
      document.removeEventListener('keydown', escListener);
    }
  };
  document.addEventListener('keydown', escListener);

  // Focus inicial en el botón Cerrar para accessibility (keyboard users)
  const closeBtn = document.getElementById('error-modal-close') as HTMLButtonElement | null;
  closeBtn?.focus();
}

/**
 * Cierra y elimina el modal de error del DOM, si existe.
 */
export function closeErrorModal(): void {
  document.getElementById(ERROR_MODAL_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escapa caracteres HTML para prevenir XSS en contenido dinámico del modal. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
