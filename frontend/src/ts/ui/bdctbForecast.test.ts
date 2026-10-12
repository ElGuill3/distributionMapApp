import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bdctbForecastAction,
  ForecastRequestError,
  fetchBdctbForecast,
  openBdctbForecastDialog,
  parseBdctbForecast,
} from './bdctbForecast.js';

function validPayload(): Record<string, unknown> {
  return {
    schema_version: 'bdctb-forecast/v1',
    station: { code: 'BDCTB', name: 'Boca del Cerro, Tabasco' },
    model_version: 'BDCTB Exogenous Quantile Gradient Boosting v1',
    issue_time: '2026-07-28T12:00:00+00:00',
    generated_at: '2026-07-28T12:00:00+00:00',
    status: {
      availability: 'available',
      freshness: 'fresh',
      age_seconds: 60,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T12:01:00+00:00',
    },
    forecasts: [
      { horizon_days: 1, target_date: '2026-07-29', q10: 4.1, q50: 4.3, q90: 4.7 },
      { horizon_days: 3, target_date: '2026-07-31', q10: 4.0, q50: 4.5, q90: 5.1 },
      { horizon_days: 7, target_date: '2026-08-04', q10: 3.8, q50: 4.8, q90: 5.8 },
    ],
    unit: 'm',
    data_kind: 'modeled_not_observed',
    warning: 'Modeled river-stage forecast, not an observation or an official warning.',
    provenance: 'synthetic_demo',
    scientific_use: 'prohibited',
  };
}

afterEach(() => {
  if (!('Plotly' in globalThis)) {
    vi.stubGlobal('Plotly', { purge: vi.fn(), Plots: { resize: vi.fn() } });
  }
  document
    .querySelector<HTMLDialogElement>('.forecast-dialog')
    ?.dispatchEvent(new Event('close'));
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installDialogAndPlotly() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  const plotly = {
    newPlot: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
  };
  vi.stubGlobal('Plotly', plotly);
  return plotly;
}

describe('BDCTB forecast contract', () => {
  it('offers the action only for the BDCTB hydrometric popup', () => {
    expect(bdctbForecastAction('BDCTB_hidro', true)).toContain('station-forecast-link');
    expect(bdctbForecastAction('BDCTB_clima', false)).toBe('');
    expect(bdctbForecastAction('SPTTB_hidro', true)).toBe('');
  });

  it('accepts the exact ordered q10/q50/q90 response', () => {
    const parsed = parseBdctbForecast(validPayload());
    expect(parsed.forecasts.map(point => point.horizon_days)).toEqual([1, 3, 7]);
    expect(parsed.forecasts[2]?.q50).toBe(4.8);
  });

  it('rejects unknown fields and crossed quantiles', () => {
    expect(() => parseBdctbForecast({ ...validPayload(), extra: true })).toThrow(
      ForecastRequestError
    );
    const payload = validPayload();
    const points = payload['forecasts'] as Array<Record<string, unknown>>;
    points[0]!['q10'] = 9;
    expect(() => parseBdctbForecast(payload)).toThrow(/quantiles/);
  });

  it('maps a 503 to a visible unavailable error', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'forecast_unavailable' } }), {
        status: 503,
      })
    );
    await expect(fetchBdctbForecast(fetcher, 100)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('rejects malformed JSON from an otherwise successful response', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{partial', { status: 200 }));
    await expect(fetchBdctbForecast(fetcher, 100)).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('aborts and reports a bounded timeout', async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    ) as unknown as typeof fetch;

    await expect(fetchBdctbForecast(fetcher, 1)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('shows an unavailable state without disturbing the surrounding page', async () => {
    document.body.innerHTML = '<div id="map">map remains mounted</div>';
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    );

    await openBdctbForecastDialog();

    expect(document.querySelector('.forecast-state')?.textContent).toMatch(
      /No valid cached/
    );
    expect(document.getElementById('map')?.textContent).toBe('map remains mounted');
    vi.unstubAllGlobals();
  });

  it('renders stale provenance after opening and purges Plotly on close', async () => {
    const payload = validPayload();
    payload['provenance'] = 'model_run';
    payload['scientific_use'] = 'model_output';
    payload['status'] = {
      availability: 'available',
      freshness: 'stale',
      age_seconds: 21601,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T18:00:01+00:00',
    };
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    const plotly = {
      newPlot: vi.fn().mockResolvedValue(undefined),
      purge: vi.fn(),
      Plots: { resize: vi.fn() },
    };
    vi.stubGlobal('Plotly', plotly);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await openBdctbForecastDialog();

    const dialog = document.querySelector<HTMLDialogElement>('.forecast-dialog')!;
    expect(plotly.newPlot).toHaveBeenCalledOnce();
    expect(plotly.Plots.resize).toHaveBeenCalledOnce();
    expect(dialog.querySelector('.forecast-meta')?.textContent).toContain('STALE');
    expect(dialog.querySelector('.forecast-meta')?.textContent).toContain('Model run');

    dialog.dispatchEvent(new Event('close'));
    expect(plotly.purge).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('names the dialog with its stable heading', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    );

    await openBdctbForecastDialog();

    const dialog = document.querySelector<HTMLDialogElement>('.forecast-dialog')!;
    const heading = document.getElementById('bdctb-forecast-title');
    expect(dialog.getAttribute('aria-labelledby')).toBe('bdctb-forecast-title');
    expect(heading?.textContent).toBe('Boca del Cerro forecast');
    vi.unstubAllGlobals();
  });

  it('discards an obsolete Plotly completion after close and reopen', async () => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(validPayload()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    );

    const pendingPlots: Array<{
      chart: HTMLDivElement;
      resolve: () => void;
    }> = [];
    const plotly = {
      newPlot: vi.fn().mockImplementation((chart: HTMLDivElement) => {
        const plotNumber = pendingPlots.length + 1;
        return new Promise<void>(resolve => {
          pendingPlots.push({
            chart,
            resolve: () => {
              chart.dataset['plot'] = String(plotNumber);
              resolve();
            },
          });
        });
      }),
      purge: vi.fn(),
      Plots: { resize: vi.fn() },
    };
    vi.stubGlobal('Plotly', plotly);

    const firstOpen = openBdctbForecastDialog();
    await vi.waitFor(() => expect(pendingPlots).toHaveLength(1));
    const dialog = document.querySelector<HTMLDialogElement>('.forecast-dialog')!;
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));

    const secondOpen = openBdctbForecastDialog();
    await vi.waitFor(() => expect(pendingPlots).toHaveLength(2));
    pendingPlots[1]!.resolve();
    await secondOpen;
    const activeChart = dialog.querySelector<HTMLDivElement>('.forecast-chart')!;
    expect(activeChart.dataset['plot']).toBe('2');

    pendingPlots[0]!.resolve();
    await firstOpen;
    expect(dialog.querySelector('.forecast-chart')).toBe(activeChart);
    expect(activeChart.dataset['plot']).toBe('2');
    expect(pendingPlots[0]!.chart.isConnected).toBe(false);
    expect(plotly.purge).toHaveBeenCalledWith(pendingPlots[0]!.chart);
    vi.unstubAllGlobals();
  });

  it('polls while visible and redraws only for a new issue or generation', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plotly = installDialogAndPlotly();
    const changed = validPayload();
    changed['generated_at'] = '2026-07-28T12:02:00+00:00';
    changed['status'] = {
      availability: 'available',
      freshness: 'fresh',
      age_seconds: 0,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T12:02:00+00:00',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPayload()), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPayload()), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await openBdctbForecastDialog();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(plotly.newPlot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(plotly.newPlot).toHaveBeenCalledTimes(2);
  });

  it('updates freshness metadata without redrawing an unchanged forecast', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plotly = installDialogAndPlotly();
    const stale = validPayload();
    stale['status'] = {
      availability: 'available',
      freshness: 'stale',
      age_seconds: 21601,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T18:00:01+00:00',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPayload()), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(stale), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);

    await openBdctbForecastDialog();
    expect(document.querySelector('.forecast-meta')?.textContent).toContain('FRESH');
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(document.querySelector('.forecast-meta')?.textContent).toContain('STALE');
    expect(document.querySelector('.forecast-stale')).not.toBeNull();
    expect(plotly.newPlot).toHaveBeenCalledOnce();
  });

  it('stops while hidden and refreshes immediately when visibility returns', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    installDialogAndPlotly();
    let hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(validPayload()), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await openBdctbForecastDialog();

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('discards an old render that resolves after a visibility refresh', async () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    const changed = validPayload();
    changed['generated_at'] = '2026-07-28T12:02:00+00:00';
    changed['status'] = {
      availability: 'available',
      freshness: 'fresh',
      age_seconds: 0,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T12:02:00+00:00',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(validPayload()), { status: 200 })
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 }))
    );
    const pendingPlots: Array<{ chart: HTMLDivElement; resolve: () => void }> = [];
    const plotly = {
      newPlot: vi.fn().mockImplementation(
        (chart: HTMLDivElement) =>
          new Promise<void>(resolve => {
            const plotNumber = pendingPlots.length + 1;
            pendingPlots.push({
              chart,
              resolve: () => {
                chart.dataset['plot'] = String(plotNumber);
                resolve();
              },
            });
          })
      ),
      purge: vi.fn(),
      Plots: { resize: vi.fn() },
    };
    vi.stubGlobal('Plotly', plotly);

    const initialOpen = openBdctbForecastDialog();
    await vi.waitFor(() => expect(pendingPlots).toHaveLength(1));
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(pendingPlots).toHaveLength(2));

    pendingPlots[1]!.resolve();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLDivElement>('.forecast-chart')?.dataset['plot']
      ).toBe('2')
    );
    const activeChart = document.querySelector<HTMLDivElement>('.forecast-chart')!;
    pendingPlots[0]!.resolve();
    await initialOpen;

    expect(document.querySelector('.forecast-chart')).toBe(activeChart);
    expect(activeChart.dataset['plot']).toBe('2');
    expect(pendingPlots[0]!.chart.isConnected).toBe(false);
    expect(plotly.purge).toHaveBeenCalledWith(pendingPlots[0]!.chart);
  });

  it('aborts on close and retains the last chart after a transient poll failure', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plotly = installDialogAndPlotly();
    let aborted = false;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPayload()), { status: 200 })
      )
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          })
      );
    vi.stubGlobal('fetch', fetcher);
    await openBdctbForecastDialog();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    const dialog = document.querySelector<HTMLDialogElement>('.forecast-dialog')!;
    expect(dialog.querySelector('.forecast-content')?.hasAttribute('hidden')).toBe(
      false
    );
    expect(dialog.querySelector('.forecast-state')?.textContent).toContain(
      'last valid forecast'
    );
    expect(plotly.newPlot).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
    await Promise.resolve();
    expect(aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps the last visible chart when a replacement Plotly render rejects', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const changed = validPayload();
    changed['generated_at'] = '2026-07-28T12:02:00+00:00';
    changed['status'] = {
      availability: 'available',
      freshness: 'fresh',
      age_seconds: 0,
      stale_after_seconds: 21600,
      evaluated_at: '2026-07-28T12:02:00+00:00',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(validPayload()), { status: 200 })
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 }))
    );
    const plotly = installDialogAndPlotly();
    plotly.newPlot
      .mockImplementationOnce(async (chart: HTMLDivElement) => {
        chart.dataset['plot'] = 'valid';
      })
      .mockRejectedValueOnce(new Error('Plotly render failed'));

    await openBdctbForecastDialog();
    const dialog = document.querySelector<HTMLDialogElement>('.forecast-dialog')!;
    const validChart = dialog.querySelector<HTMLDivElement>('.forecast-chart')!;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(dialog.querySelector('.forecast-chart')).toBe(validChart);
    expect(validChart.dataset['plot']).toBe('valid');
    expect(validChart.dataset['rendered']).toBe('true');
    expect(dialog.querySelector('.forecast-state')?.textContent).toContain(
      'last valid forecast'
    );
    expect(plotly.purge.mock.calls.some(([chart]) => chart === validChart)).toBe(false);
  });
});
