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
export function createProgressIndicator(title = 'Procesando GIF', hideProgressBar = false): HTMLDivElement {
  document.getElementById(INDICATOR_ID)?.remove();

  const div = document.createElement('div');
  div.id = INDICATOR_ID;
  
  const progressBarHtml = hideProgressBar ? '' : `
    <div class="modal-progress-bar-bg">
      <div id="progress-bar" class="modal-progress-bar-fill"></div>
    </div>
    <div id="progress-percent" class="modal-progress-percent">0%</div>
  `;

  div.innerHTML = `
    <div class="modal-overlay modal-progress">
      <div class="modal-progress-title">${title}</div>
      <div id="progress-message" class="modal-progress-message" style="white-space: pre-wrap; word-break: break-word; max-height: 450px; overflow-y: auto; text-align: left; background: var(--gray-100); padding: 12px; border-radius: 6px;">Iniciando...</div>
      ${progressBarHtml}
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
  const barEl = document.getElementById('progress-bar');
  const msgEl = document.getElementById('progress-message');
  const pctEl = document.getElementById('progress-percent');

  if (msgEl) {
    msgEl.textContent = message;
  }

  if (progress === -1) {
    if (barEl) {
      barEl.classList.add('error');
      barEl.style.width = '100%';
    }
    if (msgEl) {
      msgEl.textContent = `Error: ${message}`;
    }
    if (pctEl) {
      pctEl.textContent = 'Error';
      pctEl.classList.add('error');
    }
    return;
  }

  const pct = Math.max(0, Math.min(100, progress));
  if (barEl) {
    barEl.style.width = `${pct}%`;
    barEl.textContent = pct > 20 ? `${pct}%` : '';
  }
  if (pctEl) {
    pctEl.textContent = `${pct}%`;
  }
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
// Warning modal (non-blocking)
// ---------------------------------------------------------------------------

const WARNING_MODAL_ID = 'warning-modal';

/**
 * Muestra un modal de warning NO-bloqueante.
 *
 * A diferencia de showErrorModal:
 * - No tiene overlay oscuro de fondo
 * - No deshabilita ningún botón
 * - No es role="alertdialog" (no intercepta foco)
 * - Solo informa al usuario sin bloquear la interacción
 */
export function showWarningModal(title: string, message: string): void {
  closeWarningModal();
  const div = document.createElement('div');
  div.id = WARNING_MODAL_ID;
  div.innerHTML = `
    <div class="modal-warning">
      <div class="modal-warning-content">
        <div class="modal-warning-text">
          <div class="modal-warning-title">${escapeHtml(title)}</div>
          <div class="modal-warning-message">${escapeHtml(message)}</div>
        </div>
        <button id="warning-modal-close" class="modal-warning-close">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  document
    .getElementById('warning-modal-close')
    ?.addEventListener('click', closeWarningModal);
  // Auto-cerrar a los 8 segundos si el usuario no interactuó
  setTimeout(() => closeWarningModal(), 8000);
  // Escape también cierra
  const escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeWarningModal();
      document.removeEventListener('keydown', escListener);
    }
  };
  document.addEventListener('keydown', escListener);
}

export function closeWarningModal(): void {
  document.getElementById(WARNING_MODAL_ID)?.remove();
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
  retryAction?: () => void
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
      ? `<button id="error-modal-retry" class="modal-error-btn-primary">Reintentar</button>`
      : '';

  div.innerHTML = `
    <div class="modal-error-overlay">
      <div class="modal-error" role="document">
        <div class="modal-error-content">
          <div class="modal-error-title">
            ⚠ <span id="error-modal-title">${escapeHtml(title)}</span>
          </div>
          <div class="modal-error-message">${escapeHtml(message)}</div>
          <div class="modal-error-bar-bg">
            <div class="modal-error-bar-fill"></div>
          </div>
          ${retryButton}
          <button id="error-modal-close" class="modal-error-btn-secondary">Cerrar</button>
        </div>
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
    document.getElementById('error-modal-retry')?.addEventListener('click', () => {
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
  const closeBtn = document.getElementById(
    'error-modal-close'
  ) as HTMLButtonElement | null;
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
