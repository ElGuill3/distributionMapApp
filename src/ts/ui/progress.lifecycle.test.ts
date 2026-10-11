import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeErrorModal,
  closeWarningModal,
  showErrorModal,
  showWarningModal,
} from './progress.js';

/**
 * Observa el API público document.addEventListener / removeEventListener
 * para llevar la cuenta de los listeners keydown activos en cada momento.
 */
function trackDocumentKeydownListeners(): { activeCount: () => number } {
  const active = new Set<EventListenerOrEventListenerObject>();
  const originalAdd = document.addEventListener.bind(document);
  const originalRemove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      if (type === 'keydown' && listener !== null) {
        active.add(listener);
      }
      return originalAdd(type, listener, options);
    }
  );
  vi.spyOn(document, 'removeEventListener').mockImplementation(
    (type, listener, options) => {
      if (type === 'keydown' && listener !== null) {
        active.delete(listener);
      }
      return originalRemove(type, listener, options);
    }
  );
  return { activeCount: () => active.size };
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('warning modal lifecycle', () => {
  let listeners: { activeCount: () => number };

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = trackDocumentKeydownListeners();
  });

  afterEach(() => {
    closeWarningModal();
    document.getElementById('warning-modal')?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('close button removes the modal and its Escape listener', () => {
    showWarningModal('Aviso', 'mensaje');
    expect(document.getElementById('warning-modal')).not.toBeNull();
    expect(listeners.activeCount()).toBe(1);

    (document.getElementById('warning-modal-close') as HTMLButtonElement).click();

    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
    pressEscape();
    expect(document.getElementById('warning-modal')).toBeNull();
  });

  it('Escape removes the modal and its keydown listener', () => {
    showWarningModal('Aviso', 'mensaje');
    expect(listeners.activeCount()).toBe(1);

    pressEscape();

    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
  });

  it('auto-dismiss timer removes the modal and its Escape listener after 8s', () => {
    showWarningModal('Aviso', 'mensaje');

    vi.advanceTimersByTime(7999);
    expect(document.getElementById('warning-modal')).not.toBeNull();
    vi.advanceTimersByTime(1);

    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
  });

  it('programmatic closeWarningModal removes modal, listener and pending timer', () => {
    showWarningModal('Aviso', 'mensaje');

    closeWarningModal();

    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);

    vi.advanceTimersByTime(8000);
    expect(document.getElementById('warning-modal')).toBeNull();
  });

  it('old warning auto-dismiss timer does not close a newer warning', () => {
    showWarningModal('Primero', 'primer aviso');
    vi.advanceTimersByTime(5000);

    showWarningModal('Segundo', 'segundo aviso');
    expect(
      document.querySelector('#warning-modal .modal-warning-title')?.textContent
    ).toBe('Segundo');

    // El timer del primer aviso dispara a los 8s de su creación.
    vi.advanceTimersByTime(3000);
    expect(document.getElementById('warning-modal')).not.toBeNull();
    expect(
      document.querySelector('#warning-modal .modal-warning-title')?.textContent
    ).toBe('Segundo');

    // El segundo aviso se auto-cierra con su propio timer (8s desde su aparición).
    vi.advanceTimersByTime(5000);
    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
  });

  it('replacing a warning keeps exactly one Escape listener', () => {
    showWarningModal('Primero', 'primer aviso');
    showWarningModal('Segundo', 'segundo aviso');
    expect(listeners.activeCount()).toBe(1);

    pressEscape();
    expect(document.getElementById('warning-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
  });

  it('keeps existing behavior: warning text is escaped, copy and close button preserved', () => {
    showWarningModal('Título <b>hostil</b>', 'Mensaje & "citado"');

    const modal = document.getElementById('warning-modal');
    expect(modal).not.toBeNull();
    expect(modal?.querySelector('.modal-warning-title')?.textContent).toBe(
      'Título <b>hostil</b>'
    );
    expect(modal?.querySelector('.modal-warning-message')?.textContent).toBe(
      'Mensaje & "citado"'
    );
    expect(modal?.querySelector('#warning-modal-close')?.textContent).toBe('×');
    expect(modal?.innerHTML).not.toContain('<b>hostil</b>');
  });
});

describe('error modal lifecycle', () => {
  let listeners: { activeCount: () => number };

  beforeEach(() => {
    listeners = trackDocumentKeydownListeners();
  });

  afterEach(() => {
    closeErrorModal();
    document.getElementById('error-modal')?.remove();
    vi.restoreAllMocks();
  });

  it('close button removes the modal and its Escape listener', () => {
    showErrorModal('Error', 'detalle');
    expect(document.getElementById('error-modal')).not.toBeNull();
    expect(listeners.activeCount()).toBe(1);

    (document.getElementById('error-modal-close') as HTMLButtonElement).click();

    expect(document.getElementById('error-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
    pressEscape();
    expect(document.getElementById('error-modal')).toBeNull();
  });

  it('Escape removes the modal and its keydown listener', () => {
    showErrorModal('Error', 'detalle');
    expect(listeners.activeCount()).toBe(1);

    pressEscape();

    expect(document.getElementById('error-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
  });

  it('retry button closes the modal, removes the Escape listener and runs the action once', () => {
    const retryAction = vi.fn();
    showErrorModal('Error', 'detalle', retryAction);

    (document.getElementById('error-modal-retry') as HTMLButtonElement).click();

    expect(retryAction).toHaveBeenCalledTimes(1);
    expect(document.getElementById('error-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
    pressEscape();
    expect(retryAction).toHaveBeenCalledTimes(1);
    expect(document.getElementById('error-modal')).toBeNull();
  });

  it('programmatic closeErrorModal removes the modal and its Escape listener', () => {
    showErrorModal('Error', 'detalle');

    closeErrorModal();

    expect(document.getElementById('error-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
    pressEscape();
    expect(document.getElementById('error-modal')).toBeNull();
  });

  it('replacing an error modal removes the old Escape listener and old retry is gone', () => {
    const firstRetry = vi.fn();
    const secondRetry = vi.fn();
    showErrorModal('Error 1', 'detalle', firstRetry);
    showErrorModal('Error 2', 'detalle', secondRetry);

    expect(listeners.activeCount()).toBe(1);
    expect(document.querySelector('#error-modal #error-modal-title')?.textContent).toBe(
      'Error 2'
    );

    pressEscape();
    expect(document.getElementById('error-modal')).toBeNull();
    expect(listeners.activeCount()).toBe(0);
    expect(firstRetry).not.toHaveBeenCalled();
    expect(secondRetry).not.toHaveBeenCalled();
  });

  it('keeps existing behavior: role, focus, escaped content and retry copy preserved', () => {
    const retryAction = vi.fn();
    showErrorModal('Error <img src=x>', 'Detalle & "comillas"', retryAction);

    const modal = document.getElementById('error-modal');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('role')).toBe('alertdialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
    expect(modal?.getAttribute('aria-labelledby')).toBe('error-modal-title');
    expect(modal?.querySelector('#error-modal-title')?.textContent).toBe(
      'Error <img src=x>'
    );
    expect(modal?.querySelector('#error-modal-title')?.innerHTML).not.toContain('<img');
    expect(modal?.querySelector('.modal-error-message')?.textContent).toBe(
      'Detalle & "comillas"'
    );
    expect(document.getElementById('error-modal-close')?.textContent).toBe('Cerrar');
    expect(document.getElementById('error-modal-retry')?.textContent).toBe(
      'Reintentar'
    );
    expect(document.activeElement?.id).toBe('error-modal-close');
  });
});
