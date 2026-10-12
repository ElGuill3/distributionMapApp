import { beforeEach, expect, it, vi } from 'vitest';
import type { BBox } from '../types.js';
import { bboxSpanViolation, dateRangeViolation } from './processingLimits.js';

const DEFAULTS = { MAX_SPAN_DEG: 8, MAX_YEARS_RANGE: 10, MAX_SPAN_DEG_S2: 4 };

async function loadWithScript(json: string | null) {
  document.body.innerHTML =
    json === null
      ? ''
      : `<script id="runtime-limits" type="application/json">${json}</script>`;
  vi.resetModules();
  return import('./processingLimits.js');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Server context adoption with fallback defaults
// ---------------------------------------------------------------------------

it('falls back to defaults when the server context script is absent', async () => {
  const { RUNTIME_LIMITS } = await loadWithScript(null);
  expect(RUNTIME_LIMITS).toEqual(DEFAULTS);
});

it('adopts the server context values when present', async () => {
  const { RUNTIME_LIMITS } = await loadWithScript(
    '{"MAX_SPAN_DEG":5.5,"MAX_YEARS_RANGE":2.25,"MAX_SPAN_DEG_S2":1}'
  );
  expect(RUNTIME_LIMITS).toEqual({
    MAX_SPAN_DEG: 5.5,
    MAX_YEARS_RANGE: 2.25,
    MAX_SPAN_DEG_S2: 1,
  });
});

it.each([
  'not json at all',
  '{"MAX_SPAN_DEG":"8","MAX_YEARS_RANGE":"10","MAX_SPAN_DEG_S2":"4"}',
  '{"MAX_SPAN_DEG":-1,"MAX_YEARS_RANGE":0,"MAX_SPAN_DEG_S2":null}',
  '{"MAX_SPAN_DEG":NaN,"MAX_YEARS_RANGE":Infinity,"MAX_SPAN_DEG_S2":8e400}',
])('falls back to defaults when the context is malformed: %s', async json => {
  const { RUNTIME_LIMITS } = await loadWithScript(json);
  expect(RUNTIME_LIMITS).toEqual(DEFAULTS);
});

it('keeps valid keys when only one entry is malformed', async () => {
  const { RUNTIME_LIMITS } = await loadWithScript(
    '{"MAX_SPAN_DEG":6,"MAX_YEARS_RANGE":"x"}'
  );
  expect(RUNTIME_LIMITS).toEqual({ ...DEFAULTS, MAX_SPAN_DEG: 6 });
});

// ---------------------------------------------------------------------------
// Shared bbox span precondition (strict >, same policy as the backend)
// ---------------------------------------------------------------------------

it('accepts a bbox exactly at the span limit', () => {
  expect(bboxSpanViolation([0, 0, 8, 8] as BBox, 8)).toBeNull();
  expect(bboxSpanViolation([-4, -2, 4, 6] as BBox, 8)).toBeNull();
});

it('rejects only when one side strictly exceeds the span', () => {
  expect(bboxSpanViolation([0, 0, 8.0001, 4] as BBox, 8)).toMatch(/demasiado grande/);
  expect(bboxSpanViolation([0, 0, 4, 8.5] as BBox, 8)).toMatch(/demasiado grande/);
});

it('names the configured span in the violation message', () => {
  expect(bboxSpanViolation([0, 0, 5, 5] as BBox, 4)).toContain('máx. 4.0°');
});

// ---------------------------------------------------------------------------
// Shared date range precondition (UTC calendar, 365.25 denominator)
// ---------------------------------------------------------------------------

it('accepts a range of 3652 days at the default ten-year boundary', () => {
  expect(dateRangeViolation('2015-01-01', '2024-12-31', 10)).toBeNull();
});

it('rejects 3653 days as beyond the default ten-year boundary', () => {
  expect(dateRangeViolation('2015-01-01', '2025-01-01', 10)).toBe(
    'El rango de fechas excede el límite de 10 años. Reduce el intervalo.'
  );
});

it('spans leap days on the UTC calendar without local shifts', () => {
  expect(dateRangeViolation('2016-02-28', '2016-03-01', 10)).toBeNull();
  expect(dateRangeViolation('2016-01-01', '2026-03-01', 10)).toMatch(/excede/);
});

it('leaves malformed or inverted dates to the authoritative backend', () => {
  expect(dateRangeViolation('bad', '2024-01-01', 10)).toBeNull();
  expect(dateRangeViolation('2024-01-01', '2020-01-01', 10)).toBeNull();
});

it.each(['2024-02-31', '2024-13-01', '0000-01-01'])(
  'leaves invalid calendar day %s to backend validation',
  start => {
    expect(dateRangeViolation(start, '2026-01-01', 0.5)).toBeNull();
  }
);

it('uses ISO calendar years below 100 rather than the Date.UTC 1900 offset', () => {
  expect(dateRangeViolation('0099-01-01', '0100-01-01', 0.5)).not.toBeNull();
});

it.each([
  [1e-6, '1e-06'],
  [1e-7, '1e-07'],
] as const)('matches backend scientific span text for %s', (limit, label) => {
  expect(bboxSpanViolation([0, 0, limit * 1.01, limit * 0.1], limit)).toBe(
    `El bounding box es demasiado grande (máx. ${label}°). Reduce el área seleccionada.`
  );
});
