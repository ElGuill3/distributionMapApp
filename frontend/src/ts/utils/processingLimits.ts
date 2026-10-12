/**
 * Límites de procesamiento del servidor para el cliente — distributionMapApp.
 *
 * El backend inyecta sus límites configurados como JSON numérico en
 * frontend/templates/index.html (script #runtime-limits, antes del módulo principal).
 * Este módulo los lee una sola vez al cargar, valida que sean números finitos
 * positivos y expone las mismas precondiciones que aplica el backend, que
 * sigue siendo autoritativo.
 */

import type { BBox } from '../types.js';

/** Límites de procesamiento compartidos con config.py. */
export interface RuntimeLimits {
  MAX_SPAN_DEG: number;
  MAX_YEARS_RANGE: number;
  MAX_SPAN_DEG_S2: number;
}

/** Valores por defecto, idénticos a los defaults de config.py. */
export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  MAX_SPAN_DEG: 8.0,
  MAX_YEARS_RANGE: 10.0,
  MAX_SPAN_DEG_S2: 4.0,
};

const LIMIT_KEYS = Object.keys(DEFAULT_RUNTIME_LIMITS) as (keyof RuntimeLimits)[];

function finitePositive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Lee y valida el contexto JSON servido por el backend. Cada clave debe ser
 * un número finito positivo; las claves ausentes o malformadas conservan el
 * valor por defecto correspondiente.
 */
export function readRuntimeLimits(doc: Document): RuntimeLimits {
  const limits: RuntimeLimits = { ...DEFAULT_RUNTIME_LIMITS };
  const script = doc.getElementById('runtime-limits');
  if (!script) return limits;
  try {
    const raw = JSON.parse(script.textContent ?? '') as Record<string, unknown>;
    for (const key of LIMIT_KEYS) {
      const value = finitePositive(raw[key]);
      if (value !== null) limits[key] = value;
    }
  } catch {
    // JSON malformado o no-JSON: se conservan los defaults.
  }
  return limits;
}

/** Límites vigentes (el backend es autoritativo; esto solo anticipa su política). */
export const RUNTIME_LIMITS: RuntimeLimits =
  typeof document === 'undefined'
    ? { ...DEFAULT_RUNTIME_LIMITS }
    : readRuntimeLimits(document);

/** Mismo mensaje que lanza gee/utils.validate_bbox al exceder el máximo. */
function spanViolationMessage(maxSpan: number): string {
  const label =
    maxSpan < 1e-4 || maxSpan >= 1e16
      ? maxSpan
          .toExponential()
          .replace(
            /e([+-])(\d+)$/,
            (_, sign, digits) => `e${sign}${digits.padStart(2, '0')}`
          )
      : Number.isInteger(maxSpan)
        ? maxSpan.toFixed(1)
        : String(maxSpan);
  return `El bounding box es demasiado grande (máx. ${label}°). Reduce el área seleccionada.`;
}

/**
 * Devuelve el mensaje de violación de extensión o null si el bbox es válido.
 * Misma política estricta que el backend: solo rechaza si un lado supera
 * estrictamente el máximo en grados.
 */
export function bboxSpanViolation(bbox: BBox, maxSpan: number): string | null {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (maxLon - minLon > maxSpan || maxLat - minLat > maxSpan) {
    return spanViolationMessage(maxSpan);
  }
  return null;
}

/** Convierte YYYY-MM-DD a días UTC, o null si el formato no es válido. */
function utcDays(value: string): number | null {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return null;
  return date.getTime() / 86_400_000;
}

/**
 * Devuelve el mensaje de violación del rango de años o null si es válido.
 * Mismo cálculo de calendario UTC con denominador 365.25 que el backend;
 * las fechas malformadas o invertidas se dejan al backend autoritativo.
 */
export function dateRangeViolation(
  start: string,
  end: string,
  maxYears: number
): string | null {
  const startDays = utcDays(start);
  const endDays = utcDays(end);
  if (startDays === null || endDays === null || endDays <= startDays) {
    return null;
  }
  if ((endDays - startDays) / 365.25 > maxYears) {
    return `El rango de fechas excede el límite de ${Math.trunc(maxYears)} años. Reduce el intervalo.`;
  }
  return null;
}
