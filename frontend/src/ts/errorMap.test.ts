/**
 * Unit tests for errorMap.ts
 *
 * Covers:
 * - translateBackendError('bbox too large') returns message containing "área"
 * - Fallback for unknown error keys
 * - Edge cases: empty string, non-string input
 */

import { describe, it, expect } from 'vitest';
import { translateBackendError } from './errorMap.js';

describe('errorMap.ts', () => {
  describe('translateBackendError — known error keys', () => {
    it('bbox too large → message contains "área"', () => {
      const result = translateBackendError('bbox too large');
      expect(result.message).toContain('área');
      expect(result.title).toBe('Área demasiado grande');
    });

    it('no data → returns structured UxError with "Sin datos"', () => {
      const result = translateBackendError('no data for region');
      expect(result.title).toBe('Sin datos disponibles');
      expect(result.message).toContain('datos');
    });

    it('invalid region → returns valid UxError', () => {
      const result = translateBackendError('invalid region');
      expect(result.title).toBe('Región inválida');
      expect(result.message).toContain('región');
    });

    it('invalid bbox → returns Bounding box inválido', () => {
      const result = translateBackendError('invalid bbox');
      expect(result.title).toBe('Bounding box inválido');
    });
  });

  describe('translateBackendError — fallback', () => {
    it('unknown error key → title is "Error", message is the raw string', () => {
      const result = translateBackendError('something completely unexpected');
      expect(result.title).toBe('Error');
      expect(result.message).toBe('something completely unexpected');
    });

    it('empty string → returns fallback with title "Error"', () => {
      const result = translateBackendError('');
      expect(result.title).toBe('Error');
      expect(result.message).toBe('Ocurrió un error inesperado.');
    });

    it('null-ish input → returns fallback', () => {
      // @ts-expect-error — intentionally passing invalid input
      const result = translateBackendError(null);
      expect(result.title).toBe('Error');
      expect(result.message).toBe('Ocurrió un error inesperado.');
    });

    it('undefined input → returns fallback', () => {
      // @ts-expect-error — intentionally passing invalid input
      const result = translateBackendError(undefined);
      expect(result.title).toBe('Error');
      expect(result.message).toBe('Ocurrió un error inesperado.');
    });
  });

  describe('translateBackendError — case normalization', () => {
    it('is case-insensitive', () => {
      const result = translateBackendError('BBOX TOO LARGE');
      expect(result.title).toBe('Área demasiado grande');
    });

    it('handles extra whitespace', () => {
      const result = translateBackendError('  bbox too large  ');
      expect(result.title).toBe('Área demasiado grande');
    });
  });
});
