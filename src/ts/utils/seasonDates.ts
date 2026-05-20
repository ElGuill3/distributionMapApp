/**
 * Date utilities for season/year conversion.
 *
 * Extracted from variableListeners.ts (PR2) to provide a pure,
 * framework-agnostic home for season→date logic.
 */

import type { Season } from '../types.js';

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Convierte año + temporada a un rango de fechas ISO.
 *
 * Temporadas:
 *   invierno  → Y-12-01 .. (Y+1)-02-28/29
 *   primavera → Y-03-01 .. Y-05-31
 *   verano    → Y-06-01 .. Y-08-31
 *   otono     → Y-09-01 .. Y-11-30
 *   anual     → Y-01-01 .. Y-12-31
 */
export function seasonToDates(
  year: number,
  season: Season
): { start: string; end: string } {
  switch (season) {
    case 'invierno': {
      const endYear = year + 1;
      const endDay = isLeapYear(endYear) ? 29 : 28;
      return {
        start: `${year}-12-01`,
        end: `${endYear}-02-${String(endDay).padStart(2, '0')}`,
      };
    }
    case 'primavera':
      return { start: `${year}-03-01`, end: `${year}-05-31` };
    case 'verano':
      return { start: `${year}-06-01`, end: `${year}-08-31` };
    case 'otono':
      return { start: `${year}-09-01`, end: `${year}-11-30` };
    case 'anual':
      return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
}
