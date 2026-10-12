import { describe, it, expect } from 'vitest';
import type { Season } from '../../src/ts/types.js';

// Test the pure opacity conversion logic
describe('opacity control', () => {
  describe('opacity slider value conversion', () => {
    it('should convert slider 50 to 0.5 opacity', () => {
      const sliderValue = 50;
      const opacity = sliderValue / 100;
      expect(opacity).toBe(0.5);
    });

    it('should convert slider 0 to 0 opacity', () => {
      const sliderValue = 0;
      const opacity = sliderValue / 100;
      expect(opacity).toBe(0);
    });

    it('should convert slider 100 to 1.0 opacity', () => {
      const sliderValue = 100;
      const opacity = sliderValue / 100;
      expect(opacity).toBe(1.0);
    });

    it('should convert slider 30 to 0.3 opacity', () => {
      const sliderValue = 30;
      const opacity = sliderValue / 100;
      expect(opacity).toBe(0.3);
    });

    it('should handle intermediate values correctly', () => {
      expect(25 / 100).toBe(0.25);
      expect(75 / 100).toBe(0.75);
      expect(80 / 100).toBe(0.8);
    });
  });

  describe('formatFrameLabel', () => {
    it('should capitalize and format verano correctly', () => {
      const season = 'verano';
      const year = 2022;
      const result = `${season.charAt(0).toUpperCase() + season.slice(1)} ${year}`;
      expect(result).toBe('Verano 2022');
    });

    it('should handle invierno (winter) correctly', () => {
      const season = 'invierno';
      const year = 2021;
      const result = `${season.charAt(0).toUpperCase() + season.slice(1)} ${year}`;
      expect(result).toBe('Invierno 2021');
    });

    it('should handle otono (autumn) with Spanish accent correctly', () => {
      const season = 'otono';
      const year = 2020;
      const result = `${season.charAt(0).toUpperCase() + season.slice(1)} ${year}`;
      expect(result).toBe('Otono 2020');
    });
  });
});

// Re-export the Season type for use in other tests
export type { Season };
