import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Season } from '../../src/ts/types.js';

/**
 * Pure formatting function - extracted from main.ts updateDateLabel
 * Capitalizes first letter of season name for Spanish display.
 */
function formatFrameLabel(season: string, year: number): string {
  const SEASON_LABELS: Record<string, string> = {
    verano: 'Verano',
    invierno: 'Invierno',
    primavera: 'Primavera',
    otono: 'Otoño',
    anual: 'Anual',
  };
  const label = SEASON_LABELS[season] ?? season.charAt(0).toUpperCase() + season.slice(1);
  return `${label} ${year}`;
}

/**
 * Updates the date label DOM element with the formatted season/year.
 * Returns early if labels array is empty or frameIndex is out of bounds.
 */
function updateDateLabel(
  frameIdx: number,
  labels: Array<{ year: number; season: Season; label: string }>,
  elementId: string
): void {
  const dateLabelEl = document.getElementById(elementId);
  if (!dateLabelEl) return;
  if (labels.length === 0) return;
  const info = labels[frameIdx];
  if (!info) {
    dateLabelEl.textContent = '';
    return;
  }
  dateLabelEl.textContent = formatFrameLabel(info.season, info.year);
}

// Mock the DOM environment
const mockDateLabel = document.createElement('span');
mockDateLabel.id = 'animation-date-label';
document.body.appendChild(mockDateLabel);

const mockDateLabelB = document.createElement('span');
mockDateLabelB.id = 'animation-date-label-b';
document.body.appendChild(mockDateLabelB);

describe('date label overlay', () => {
  beforeEach(() => {
    mockDateLabel.textContent = '';
    mockDateLabelB.textContent = '';
  });

  afterEach(() => {
    mockDateLabel.textContent = '';
    mockDateLabelB.textContent = '';
  });

  describe('formatFrameLabel', () => {
    it('should format verano 2022 correctly', () => {
      const result = formatFrameLabel('verano', 2022);
      expect(result).toBe('Verano 2022');
    });

    it('should format invierno 2021 correctly', () => {
      const result = formatFrameLabel('invierno', 2021);
      expect(result).toBe('Invierno 2021');
    });

    it('should format primavera 2023 correctly', () => {
      const result = formatFrameLabel('primavera', 2023);
      expect(result).toBe('Primavera 2023');
    });

    it('should format otono 2020 correctly with Spanish accent', () => {
      const result = formatFrameLabel('otono', 2020);
      expect(result).toBe('Otoño 2020');
    });

    it('should format anual correctly', () => {
      const result = formatFrameLabel('anual', 2022);
      expect(result).toBe('Anual 2022');
    });
  });

  describe('updateDateLabel', () => {
    it('should update animation-date-label with correct season and year', () => {
      const labels = [
        { year: 2022, season: 'verano' as Season, label: 'Verano 2022' },
        { year: 2022, season: 'otono' as Season, label: 'Otoño 2022' },
      ];

      updateDateLabel(0, labels, 'animation-date-label');
      expect(mockDateLabel.textContent).toBe('Verano 2022');
    });

    it('should update animation-date-label for frame 1', () => {
      const labels = [
        { year: 2022, season: 'verano' as Season, label: 'Verano 2022' },
        { year: 2022, season: 'otono' as Season, label: 'Otoño 2022' },
      ];

      updateDateLabel(1, labels, 'animation-date-label');
      expect(mockDateLabel.textContent).toBe('Otoño 2022');
    });

    it('should not throw when labels array is empty', () => {
      const labels: Array<{ year: number; season: Season; label: string }> = [];
      expect(() => updateDateLabel(0, labels, 'animation-date-label')).not.toThrow();
    });

    it('should not throw when frame index is out of range', () => {
      const labels = [
        { year: 2022, season: 'verano' as Season, label: 'Verano 2022' },
      ];
      expect(() => updateDateLabel(5, labels, 'animation-date-label')).not.toThrow();
      expect(mockDateLabel.textContent).toBe('');
    });

    it('should update animation-date-label-b for compare mode', () => {
      const labels = [
        { year: 2022, season: 'verano' as Season, label: 'Verano 2022' },
      ];

      updateDateLabel(0, labels, 'animation-date-label-b');
      expect(mockDateLabelB.textContent).toBe('Verano 2022');
    });
  });
});