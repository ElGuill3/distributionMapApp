/**
 * Unit tests for fieldErrors.ts
 *
 * Covers:
 * - showFieldError() creates span with class "field-error", role="alert", aria-live
 * - clearFieldError() removes the error span correctly
 * - Multiple calls to showFieldError replace rather than accumulate
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showFieldError, clearFieldError } from './fieldErrors.js';

describe('fieldErrors.ts', () => {
  // Setup a DOM container before each test
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('showFieldError', () => {
    it('creates a <span> with class "field-error"', () => {
      const field = document.createElement('button');
      field.textContent = 'Generar';
      container.appendChild(field);

      showFieldError(field, 'Error de prueba');

      const errorSpan = container.querySelector('.field-error');
      expect(errorSpan).not.toBeNull();
      expect(errorSpan?.textContent).toBe('Error de prueba');
    });

    it('span has role="alert"', () => {
      const field = document.createElement('button');
      container.appendChild(field);

      showFieldError(field, 'Mensaje de error');

      const errorSpan = container.querySelector('.field-error');
      expect(errorSpan?.getAttribute('role')).toBe('alert');
    });

    it('span has aria-live="polite"', () => {
      const field = document.createElement('input');
      container.appendChild(field);

      showFieldError(field, 'Campo requerido');

      const errorSpan = container.querySelector('.field-error');
      expect(errorSpan?.getAttribute('aria-live')).toBe('polite');
    });

    it('span is inserted as sibling after the field (parentNode.insertBefore)', () => {
      const parent = document.createElement('div');
      const field = document.createElement('button');
      parent.appendChild(field);
      container.appendChild(parent);

      showFieldError(field, 'Error inline');

      // The span should be inserted right after the field
      expect(field.nextSibling).not.toBeNull();
      expect((field.nextSibling as HTMLElement)?.className).toBe('field-error');
    });

    it('calling showFieldError twice replaces the span instead of accumulating', () => {
      const field = document.createElement('button');
      container.appendChild(field);

      showFieldError(field, 'Primer error');
      showFieldError(field, 'Segundo error');

      const spans = container.querySelectorAll('.field-error');
      expect(spans.length).toBe(1);
      expect(spans.item(0)?.textContent ?? null).toBe('Segundo error');
    });

    it('does nothing if field is falsy', () => {
      // Should not throw
      expect(() => showFieldError(null as unknown as HTMLElement, 'error')).not.toThrow();
    });
  });

  describe('clearFieldError', () => {
    it('removes the error span from DOM', () => {
      const field = document.createElement('button');
      container.appendChild(field);

      showFieldError(field, 'Error transient');
      clearFieldError(field);

      const errorSpan = container.querySelector('.field-error');
      expect(errorSpan).toBeNull();
    });

    it('calling clearFieldError on field without error is safe (no throw)', () => {
      const field = document.createElement('button');
      container.appendChild(field);

      expect(() => clearFieldError(field)).not.toThrow();
    });

    it('clearFieldError removes the span without affecting other sibling fields', () => {
      // Test that clearFieldError only removes its own error span
      // using separate parent containers for each field
      const parent1 = document.createElement('div');
      const parent2 = document.createElement('div');
      const field1 = document.createElement('button');
      const field2 = document.createElement('button');
      parent1.appendChild(field1);
      parent2.appendChild(field2);
      container.appendChild(parent1);
      container.appendChild(parent2);

      showFieldError(field1, 'Error 1');
      showFieldError(field2, 'Error 2');

      // Clear field1's error
      clearFieldError(field1);

      // field1's error is gone
      const field1Error = parent1.querySelector('.field-error');
      expect(field1Error).toBeNull();
      // field2's error should still exist
      const field2Error = parent2.querySelector('.field-error');
      expect(field2Error?.textContent).toBe('Error 2');
    });
  });
});
