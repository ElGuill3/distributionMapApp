import { mactbPublication } from './stationForecast.fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcetStatus } from './ipcetStatus.js';
import {
  fetchBdctbForecast,
  formatForecastSummary,
  parseBdctbForecast,
} from './bdctbForecast.js';

function forecast() {
  return {
    schema: 'bdctb-forecast/v2',
    station: { code: 'BDCTB', name: 'Boca del Cerro' },
    issue_time: '2026-10-19T11:00:00-06:00',
    generated_at: '2026-10-19T18:00:00Z',
    model_version: 'test',
    mode: 'live',
    live_input: { date: '2026-10-19', stage_m: 18, age_days: 0 },
    forecasts: Object.fromEntries(
      [1, 3, 7].map(h => [
        `h${h}`,
        {
          target_date: `2026-10-${19 + h}`,
          q10: 17,
          q50: h === 3 ? 18.8 : 17.8,
          q90: 20,
          namo_m: 19.21,
          distance_to_namo_m: (h === 3 ? 18.8 : 17.8) - 19.21,
          data_kind: 'modeled_not_observed',
        },
      ])
    ),
    disclaimer:
      'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
  };
}
const envelope = () => ({
  forecast: forecast(),
  source: 'network' as const,
  fetched_at: '2026-10-19T18:00:00Z',
  updating: false,
});
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('published forecast v2', () => {
  it('preserves validation of quantiles, dates, NAMO distances and schema', () => {
    expect(parseBdctbForecast(forecast()).forecasts.h1.q50).toBe(17.8);
    for (const change of [
      { q10: 25 },
      { q50: NaN },
      { target_date: '2026-02-30' },
      { distance_to_namo_m: 10 },
    ]) {
      const bad = forecast();
      Object.assign(bad.forecasts['h1']!, change);
      expect(() => parseBdctbForecast(bad)).toThrow();
    }
    expect(() =>
      parseBdctbForecast({ ...forecast(), schema: 'bdctb-forecast/v1' })
    ).toThrow();
  });
  it('preserves the live-only S4 mark including exact NAMO and clearing on later loads', async () => {
    for (const [mode, median, marked] of [
      ['live', 19.21, true],
      ['glofas_only', 20, false],
      ['live', 20, true],
      ['live', 19.2, false],
    ] as const) {
      const value = envelope();
      Object.assign(value.forecast, {
        mode,
        live_input: mode === 'live' ? value.forecast.live_input : null,
      });
      Object.assign(value.forecast.forecasts['h7']!, {
        q50: median,
        distance_to_namo_m: median - 19.21,
      });
      await fetchBdctbForecast(vi.fn().mockResolvedValue(json(value)));
      expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(marked);
    }
  });
  it('preserves envelope, bounded timeout and unavailable/malformed errors', async () => {
    expect(
      await fetchBdctbForecast(vi.fn().mockResolvedValue(json(envelope())))
    ).toEqual(envelope());
    await expect(
      fetchBdctbForecast(vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      fetchBdctbForecast(vi.fn().mockResolvedValue(new Response('{')))
    ).rejects.toMatchObject({ code: 'malformed' });
    const slow = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        )
    );
    await expect(fetchBdctbForecast(slow, 1)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
  it('formats three compact summary lines with q50 values, issue and closest NAMO approach', () => {
    const value = { ...envelope(), forecast: parseBdctbForecast(forecast()) };
    expect(formatForecastSummary(value)).toEqual([
      'Pronóstico del modelo · emitido 19/10 11:00',
      'Mañana 17.8 m · 3 días 18.8 m · 7 días 17.8 m · mín. 0.4 m bajo el NAMO',
      'Modelado, no es aviso oficial',
    ]);
    value.forecast.forecasts.h7.q50 = 19.21;
    expect(formatForecastSummary(value)[1]).toContain('alcanza el NAMO');
    value.forecast.forecasts.h7.q50 = 20;
    expect(formatForecastSummary(value)[1]).toContain('alcanza el NAMO');
  });
  it.each([
    [19.17, 'prácticamente en el NAMO'],
    [19.16, 'mín. 0.1 m bajo el NAMO'],
    [19.21, 'alcanza el NAMO'],
    [19.22, 'alcanza el NAMO'],
  ] as const)('formats the NAMO boundary for q50=%s', (median, phrase) => {
    const value = { ...envelope(), forecast: parseBdctbForecast(forecast()) };
    value.forecast.forecasts.h7.q50 = median;
    if (median === 19.16) {
      const gap = value.forecast.forecasts.h7.namo_m - median;
      expect(gap).toBeCloseTo(0.05);
      expect(gap.toFixed(1)).toBe('0.1');
    }
    expect(formatForecastSummary(value)[1]).toBe(
      `Mañana 17.8 m · 3 días 18.8 m · 7 días ${median.toFixed(1)} m · ${phrase}`
    );
  });
  it.each([
    ['glofas_only', 'network', false, 'Sin nivel en vivo: puede sobrestimar'],
    ['live', 'cache', false, 'Copia guardada del 19/10'],
    ['live', 'network', true, 'Actualizando con el nivel de hoy…'],
    ['glofas_only', 'cache', true, 'Actualizando con el nivel de hoy…'],
  ] as const)('formats %s/%s/updating=%s note', (mode, source, updating, note) => {
    const f = parseBdctbForecast(forecast());
    f.mode = mode;
    const lines = formatForecastSummary({
      ...envelope(),
      forecast: f,
      source,
      updating,
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`Modelado, no es aviso oficial · ${note}`);
  });
});

it('uses MACTB NAMO for the neutral live-only ring, including equality and clearing', async () => {
  for (const [mode, median, marked] of [
    ['live', 9.85, true],
    ['live', 9.84, false],
    ['live', 10, true],
    ['glofas_only', 10, false],
  ] as const) {
    const f = structuredClone(mactbPublication);
    f.mode = mode;
    if (mode === 'glofas_only') f.live_input = null as unknown as typeof f.live_input;
    Object.assign(f.forecasts.h7, {
      q50: median,
      q90: 11,
      distance_to_namo_m: median - 9.85,
    });
    const value = { ...envelope(), forecast: f };
    const load = (await import('./stationChart.js')).forecastLoaderFor('MACTB')!;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
    await load(new AbortController().signal);
    expect(ipcetStatus.modelMarkFor('MACTB')).toBe(marked);
  }
});
it('rejects a valid publication for a different requested station without changing marks', async () => {
  ipcetStatus.setModelMark('MACTB', false);
  ipcetStatus.setModelMark('BDCTB', false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(envelope())));
  const load = (await import('./stationChart.js')).forecastLoaderFor('MACTB')!;
  await expect(load(new AbortController().signal)).rejects.toMatchObject({
    code: 'malformed',
  });
  expect(ipcetStatus.modelMarkFor('MACTB')).toBe(false);
  expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(false);
});
