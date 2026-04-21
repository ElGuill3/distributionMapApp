/**
 * Helpers para errores inline de formulario.
 *
 * showFieldError() inyecta un <span> con rol="alert" debajo del campo
 * indicado, facilitando la retroalimentación visual inmediata sin modal.
 * clearFieldError() lo elimina del DOM.
 */

const FIELD_ERROR_CLASS = 'field-error';

/**
 * Inyecta un mensaje de error inline debajo del elemento field.
 *
 * @param field   - Elemento HTML sobre el cual se muestra el error (se
 *                  usa como referencia para insertar el <span> adyacente).
 * @param message - Texto de error a mostrar.
 */
export function showFieldError(field: HTMLElement, message: string): void {
  if (!field) return;

  // Eliminar error previo si existe
  clearFieldError(field);

  const span = document.createElement('span');
  span.className = FIELD_ERROR_CLASS;
  span.setAttribute('role', 'alert');
  span.setAttribute('aria-live', 'polite');
  span.setAttribute('tabindex', '-1'); // keyboard reachable
  span.textContent = message;

  // Insertar como nodo hermano justo después del field
  field.parentNode?.insertBefore(span, field.nextSibling);

  // Mover foco al field para que keyboard users vean el error inmediatamente
  (field as HTMLElement).focus?.();
}

/**
 * Elimina el span de error inline asociado a un field, si existe.
 *
 * @param field - Elemento HTML cuya zona de error se quiere limpiar.
 */
export function clearFieldError(field: HTMLElement): void {
  if (!field?.parentNode) return;

  const existing = field.parentNode.querySelector(
    `:scope > .${FIELD_ERROR_CLASS}`
  );
  existing?.remove();
}
