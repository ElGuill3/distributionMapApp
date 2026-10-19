import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bdctbForecastAction,
  fetchBdctbForecast,
  openBdctbForecastDialog,
  parseBdctbForecast,
} from './bdctbForecast.js';

function forecast() {
  return {
    schema: 'bdctb-forecast/v2',
    station: { code: 'BDCTB', name: 'Boca del Cerro' },
    issue_time: '2026-10-19T11:00:00-06:00',
    generated_at: '2026-10-19T18:00:00Z',
    model_version: 'bdctb-L1-postaudit-v1',
    mode: 'live',
    live_input: { date: '2026-10-19', stage_m: 18, age_days: 0 },
    forecasts: Object.fromEntries(
      [1, 3, 7].map(h => [
        `h${h}`,
        {
          target_date: `2026-10-${19 + h}`,
          q10: 17.9,
          q50: h === 7 ? 19.5 : 18.4,
          q90: 20,
          namo_m: 19.21,
          distance_to_namo_m: (h === 7 ? 19.5 : 18.4) - 19.21,
          data_kind: 'modeled_not_observed',
        },
      ])
    ),
    disclaimer:
      'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
  };
}
function envelope(updating = false, source = 'network') {
  return { forecast: forecast(), source, fetched_at: '2026-10-19T18:00:00Z', updating };
}
function response(value: unknown) {
  return new Response(JSON.stringify(value));
}
function setup() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
}
afterEach(() => {
  document.querySelector('dialog')?.dispatchEvent(new Event('close'));
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('published forecast v2', () => {
  it('preserves the BDCTB-only hydrometric action', () => {
    expect(bdctbForecastAction('BDCTB_hidro', true)).toContain('station-forecast-link');
    expect(bdctbForecastAction('BDCTB_clima', false)).toBe('');
    expect(bdctbForecastAction('SPTTB_hidro', true)).toBe('');
  });
  it('accepts v2 and rejects crossed quantiles, invalid dates and NAMO distances', () => {
    expect(parseBdctbForecast(forecast()).forecasts.h1.q50).toBe(18.4);
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
  it('fetches an envelope and keeps bounded timeout and unavailable errors', async () => {
    expect(
      await fetchBdctbForecast(vi.fn().mockResolvedValue(response(envelope())))
    ).toEqual(envelope());
    await expect(
      fetchBdctbForecast(vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      fetchBdctbForecast(vi.fn().mockResolvedValue(new Response('{')))
    ).rejects.toMatchObject({ code: 'malformed' });
    const slow = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    await expect(fetchBdctbForecast(slow, 1)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
  it('renders SVG band, median, NAMO, table, live provenance, issue and official link', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(envelope())));
    await openBdctbForecastDialog();
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('svg polygon')).not.toBeNull();
    expect(dialog.querySelector('svg polyline')).not.toBeNull();
    expect(dialog.textContent).toContain('NAMO 19.21 m');
    expect(dialog.textContent).toContain(
      'Mañana: 18.4 m (17.9–20.0) · a 0.8 m del NAMO'
    );
    expect(dialog.textContent).toContain(
      'En 7 días: 19.5 m (17.9–20.0) · 0.3 m sobre el NAMO'
    );
    expect(dialog.textContent).toContain('Con nivel IPCET del 2026-10-19 (06:00)');
    expect(dialog.textContent).toContain('Emitido el 2026-10-19');
    expect(dialog.textContent).toContain(forecast().disclaimer);
    expect(dialog.querySelector('a')?.href).toContain('https://tabasco.gob.mx/');
    expect(dialog.querySelector('.forecast-content')?.hasAttribute('hidden')).toBe(
      false
    );
  });
  it('renders fallback and cached issue notice safely', async () => {
    setup();
    const cached = envelope(false, 'cache');
    Object.assign(cached.forecast, { mode: 'glofas_only', live_input: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cached)));
    await openBdctbForecastDialog();
    expect(document.body.textContent).toContain(
      'Sin nivel IPCET reciente: pronóstico solo con GloFAS, menos preciso'
    );
    expect(document.body.textContent).toContain(
      'Pronóstico guardado, emitido el 2026-10-19 (sin conexión)'
    );
  });
  it('keeps forecast visible while updating and swaps to live after 60 seconds', async () => {
    setup();
    vi.useFakeTimers();
    const old = envelope(true);
    Object.assign(old.forecast, { mode: 'glofas_only', live_input: null });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(old))
      .mockResolvedValueOnce(response(envelope()));
    vi.stubGlobal('fetch', fetcher);
    await openBdctbForecastDialog();
    expect(document.body.textContent).toContain(
      'Actualizando con el nivel de IPCET de hoy…'
    );
    expect(document.querySelector('svg')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Con nivel IPCET del 2026-10-19');
    expect(document.body.textContent).not.toContain('Actualizando con');
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('caps polling at 30 minutes, retains valid content on failure and cancels on close', async () => {
    setup();
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response(envelope(true))));
    vi.stubGlobal('fetch', fetcher);
    await openBdctbForecastDialog();
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(document.querySelector('svg')).not.toBeNull();
    expect(document.body.textContent).toContain(
      'Se conserva el último pronóstico válido'
    );
    await vi.advanceTimersByTimeAsync(30 * 60000);
    const count = fetcher.mock.calls.length;
    expect(count).toBeLessThanOrEqual(31);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    document.querySelector('dialog')!.dispatchEvent(new Event('close'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('keeps the page mounted on 503 and ignores a response after close', async () => {
    setup();
    document.body.innerHTML = '<div id="map">map</div>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    );
    await openBdctbForecastDialog();
    expect(document.body.textContent).toContain('No hay un pronóstico válido');
    expect(document.getElementById('map')?.textContent).toBe('map');
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>(r => {
            resolve = r;
          })
      )
    );
    const pending = openBdctbForecastDialog();
    document.querySelector('dialog')!.dispatchEvent(new Event('close'));
    resolve(response(envelope()));
    await pending;
    expect(document.querySelector('svg')).toBeNull();
  });
});
