import { mactbPublication } from './stationForecast.fixture.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openStationChart } from './stationChart.js';
import { plotAllSelectedSeries } from './chart.js';
import { ipcetStatus } from './ipcetStatus.js';

const json = (value: unknown) => new Response(JSON.stringify(value));
const recent = (code: string) => ({
  schema: 'ipcet-recent/v1',
  stations: {
    [code]: [
      { date: '2026-10-18', hoy: 17.8, semaforo: 'NORMAL' },
      { date: '2026-10-19', hoy: null, semaforo: null },
    ],
  },
  source: 'network',
});
const forecast = (mode = 'live') => ({
  forecast: {
    schema: 'bdctb-forecast/v2',
    station: { code: 'BDCTB', name: 'Boca del Cerro' },
    model_version: 'test',
    issue_time: '2026-10-19T11:00:00-06:00',
    generated_at: '2026-10-19T18:00:00Z',
    mode,
    live_input:
      mode === 'live' ? { date: '2026-10-19', stage_m: 18, age_days: 0 } : null,
    forecasts: Object.fromEntries(
      [1, 3, 7].map(h => [
        `h${h}`,
        {
          target_date: `2026-10-${19 + h}`,
          q10: 17,
          q50: 19.5,
          q90: 20,
          namo_m: 19.21,
          distance_to_namo_m: 19.5 - 19.21,
          data_kind: 'modeled_not_observed',
        },
      ])
    ),
    disclaimer:
      'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
  },
  source: 'network',
  fetched_at: '2026-10-19T18:00:00Z',
  updating: false,
});
let div: HTMLDivElement;
let placeholder: HTMLDivElement;
const station = { code: 'BDCTB', name: 'Boca del Cerro', river: 'Usumacinta' };
const plot = vi.fn();
beforeEach(() => {
  div = document.createElement('div');
  placeholder = document.createElement('div');
  document.body.append(div, placeholder);
  vi.stubGlobal('Plotly', { newPlot: plot, react: plot, purge: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  plot.mockClear();
  ipcetStatus.setModelMark('BDCTB', false);
});
afterEach(() => {
  plotAllSelectedSeries(
    div,
    {},
    () => {},
    () => {}
  );
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('does not request forecasts before a user opens the chart', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  vi.resetModules();
  await import('./stationChart.js');
  expect(fetcher).not.toHaveBeenCalled();
});
it('plots live observed gaps, median from issue, probability band and payload NAMO, updating the model mark', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes('recent') ? recent('BDCTB') : forecast()))
    )
  );
  await openStationChart(div, placeholder, station, () => {});
  const [, traces, layout] = plot.mock.calls[plot.mock.calls.length - 1]!;
  expect(traces.map((t: { name: string }) => t.name)).toEqual([
    'Nivel observado (IPCET)',
    '',
    'Rango probable (10–90 %)',
    'Pronóstico (mediana)',
    'NAMO 19.21 m (oficial)',
  ]);
  expect(traces[0]).toMatchObject({
    y: [17.8, null],
    connectgaps: false,
    line: { dash: 'solid' },
  });
  expect(traces[2]).toMatchObject({ fill: 'tonexty' });
  expect(traces[3]).toMatchObject({
    x: ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-26'],
    y: [18, 19.5, 19.5, 19.5],
    line: { dash: 'dash' },
  });
  expect(layout.title).toBeUndefined();
  expect(layout.yaxis.title.text).toBe('Nivel (m)');
  expect(placeholder.classList.contains('chart-placeholder--hidden')).toBe(true);
  expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(true);
});
it('uses the same layout, font, legend, axes, fill and modebar config as variable charts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(recent('SPTTB'))));
  for (const theme of ['light', 'dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await openStationChart(div, placeholder, { ...station, code: 'SPTTB' }, () => {});
    const [, stationTraces, stationLayout, stationConfig] =
      plot.mock.calls[plot.mock.calls.length - 1]!;
    plotAllSelectedSeries(
      div,
      { soil: { dates: ['2026-10-19'], values: [12] } },
      () => {},
      () => {}
    );
    const [, variableTraces, variableLayout, variableConfig] =
      plot.mock.calls[plot.mock.calls.length - 1]!;
    for (const key of ['legend', 'font', 'margin'])
      expect(stationLayout[key]).toEqual(variableLayout[key]);
    const { range: _range, ...stationXAxis } = stationLayout.xaxis;
    expect(stationXAxis).toEqual(variableLayout.xaxis);
    for (const key of [
      'tickfont',
      'gridcolor',
      'zeroline',
      'zerolinecolor',
      'showline',
    ])
      expect(stationLayout.yaxis[key]).toEqual(variableLayout.yaxis[key]);
    expect(stationLayout.yaxis.title.font).toEqual(variableLayout.yaxis.title.font);
    expect(stationConfig).toEqual(variableConfig);
    expect(stationTraces[0].fill).toBe(variableTraces[0].fill);
    expect(stationTraces[0].line.width).toBe(variableTraces[0].line.width);
    expect(stationTraces[0].fillcolor).toContain('0.08');
  }
  document.documentElement.removeAttribute('data-theme');
});
it('filters by 30 calendar days, not row count, retaining boundary, gaps and h7', async () => {
  const data = recent('BDCTB');
  data.stations.BDCTB = [
    { date: '2026-09-19', hoy: 15, semaforo: 'NORMAL' },
    { date: '2026-09-20', hoy: 16, semaforo: 'NORMAL' },
    { date: '2026-10-18', hoy: null as unknown as number, semaforo: 'NORMAL' },
    { date: '2026-10-19', hoy: 18, semaforo: 'NORMAL' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes('recent') ? data : forecast()))
    )
  );
  await openStationChart(div, placeholder, station, () => {});
  const [, traces, layout] = plot.mock.calls[plot.mock.calls.length - 1]!;
  expect(traces[0].x).toEqual(['2026-09-20', '2026-10-18', '2026-10-19']);
  expect(traces[0].y).toEqual([16, null, 18]);
  expect(layout.yaxis.range[0]).toBeGreaterThan(14);
  expect(layout.yaxis.range[1]).toBeGreaterThan(20);
  expect(traces[3].x[3]).toBe('2026-10-26');
  expect(layout.xaxis.range).toEqual(['2026-09-20', '2026-10-26']);
});
it('anchors the calendar window to the latest actual observation, not a later missing report', async () => {
  const data = recent('SPTTB');
  data.stations.SPTTB = [
    { date: '2026-09-19', hoy: 17, semaforo: 'NORMAL' },
    { date: '2026-10-18', hoy: 18, semaforo: 'NORMAL' },
    { date: '2026-10-19', hoy: null as unknown as number, semaforo: 'NORMAL' },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(data)));
  await openStationChart(div, placeholder, { ...station, code: 'SPTTB' }, () => {});
  const [, traces, layout] = plot.mock.calls[plot.mock.calls.length - 1]!;
  expect(traces[0].x).toEqual(['2026-09-19', '2026-10-18']);
  expect(layout.xaxis.range).toEqual(['2026-09-19', '2026-10-18']);
});
it('uses latest official NAMO for any station without a forecast', async () => {
  vi.spyOn(ipcetStatus, 'stateFor').mockReturnValue({
    code: 'SPTTB',
    station: 'San Pedro',
    river: 'San Pedro',
    namo: 8,
    semaforo: 'NORMAL',
    problems: [],
    table_date: '2026-10-19',
    source_url: null,
  });
  const fetcher = vi.fn().mockResolvedValue(json(recent('SPTTB')));
  vi.stubGlobal('fetch', fetcher);
  await openStationChart(
    div,
    placeholder,
    { code: 'SPTTB', name: 'San Pedro', river: 'San Pedro' },
    () => {}
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    plot.mock.calls[plot.mock.calls.length - 1]![1].map((t: { name: string }) => t.name)
  ).toEqual(['Nivel observado (IPCET)', 'NAMO 8 m (oficial)']);
});
it('starts the band at zero width on a same-day live level and marks only modelled points', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes('recent') ? recent('BDCTB') : forecast()))
    )
  );
  await openStationChart(div, placeholder, station, () => {});
  const [, traces] = plot.mock.calls[plot.mock.calls.length - 1]!;
  expect(traces[1].y).toEqual([18, 17, 17, 17]);
  expect(traces[2].y).toEqual([18, 20, 20, 20]);
  expect(traces[3]).toMatchObject({
    mode: 'lines+markers',
    marker: { size: [0, 7, 7, 7] },
  });
});
it('keeps the gap when the live level is older than the issue day', async () => {
  const stale = forecast();
  stale.forecast.live_input = { date: '2026-10-18', stage_m: 17.5, age_days: 1 };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes('recent') ? recent('BDCTB') : stale))
    )
  );
  await openStationChart(div, placeholder, station, () => {});
  const [, traces] = plot.mock.calls[plot.mock.calls.length - 1]!;
  for (const trace of traces.slice(1, 4)) expect(trace.y[0]).toBeNull();
  expect(traces[3].x[0]).toBe('2026-10-19');
});
it('shows the GloFAS-only note without inventing an issue-day level', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        json(url.includes('recent') ? recent('BDCTB') : forecast('glofas_only'))
      )
    )
  );
  await openStationChart(div, placeholder, station, () => {});
  const [, traces, layout] = plot.mock.calls[plot.mock.calls.length - 1]!;
  expect(layout.annotations[0].text).toBe(
    'Sin nivel en vivo: el pronóstico puede sobrestimar'
  );
  expect(traces[3].y[0]).toBeNull();
  expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(false);
});
it('shows a Spanish placeholder on 503 and can recover', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
  );
  await openStationChart(div, placeholder, station, () => {});
  expect(placeholder.textContent).toBe(
    'Los niveles no están disponibles. Intente de nuevo más tarde.'
  );
  expect(placeholder.classList.contains('chart-placeholder--hidden')).toBe(false);
  expect(plot).not.toHaveBeenCalled();
});
it('aborts after five seconds and shows the timeout placeholder', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url, init) =>
      new Promise<Response>((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      )
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = openStationChart(
    div,
    placeholder,
    { ...station, code: 'SPTTB' },
    () => {}
  );
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(placeholder.textContent).toBe(
    'La consulta de niveles tardó demasiado. Intente de nuevo.'
  );
});
it('another analysis replaces the station and theme changes do not restore it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(recent('SPTTB'))));
  await openStationChart(div, placeholder, { ...station, code: 'SPTTB' }, () => {});
  plotAllSelectedSeries(
    div,
    { soil: { dates: ['2026-01-01'], values: [12] } },
    () => {},
    () => {}
  );
  window.dispatchEvent(new Event('theme-change'));
  expect(plot.mock.calls[plot.mock.calls.length - 1]![1][0].name).toBe(
    'Humedad suelo (%)'
  );
});
it('repaints station traces for light and dark themes without another request', async () => {
  const fetcher = vi.fn().mockResolvedValue(json(recent('SPTTB')));
  vi.stubGlobal('fetch', fetcher);
  document.documentElement.setAttribute('data-theme', 'light');
  await openStationChart(div, placeholder, { ...station, code: 'SPTTB' }, () => {});
  expect(plot.mock.calls[plot.mock.calls.length - 1]![1][0].line.color).toBe('#0369a1');
  document.documentElement.setAttribute('data-theme', 'dark');
  window.dispatchEvent(new Event('theme-change'));
  expect(plot.mock.calls[plot.mock.calls.length - 1]![1][0].line.color).toBe('#7dd3fc');
  expect(fetcher).toHaveBeenCalledTimes(1);
  document.documentElement.removeAttribute('data-theme');
});
it('cancels a pending station load when an analysis replaces it, restoring the original placeholder', async () => {
  placeholder.innerHTML = '<p>Sin gráfica cargada</p>';
  const fetcher = vi.fn(
    (_url, init) =>
      new Promise<Response>((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      )
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = openStationChart(
    div,
    placeholder,
    { ...station, code: 'SPTTB' },
    () => {}
  );
  plotAllSelectedSeries(
    div,
    { soil: { dates: ['2026-01-01'], values: [12] } },
    () => {},
    () => {}
  );
  await pending;
  expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(placeholder.innerHTML).toBe('<p>Sin gráfica cargada</p>');
  expect(plot.mock.calls[plot.mock.calls.length - 1]![1][0].name).toBe(
    'Humedad suelo (%)'
  );
});

it('plots MACTB h1/h3/h7, its band, markers and own NAMO with 30 days of observations', async () => {
  const fetcher = vi.fn((url: string) =>
    Promise.resolve(
      json(
        url.includes('recent')
          ? {
              schema: 'ipcet-recent/v1',
              stations: {
                MACTB: [
                  { date: '2026-09-23', hoy: 7 },
                  { date: '2026-09-24', hoy: 7.1 },
                  { date: '2026-10-22', hoy: null },
                  { date: '2026-10-23', hoy: 6.99 },
                ],
              },
            }
          : { ...forecast(), forecast: mactbPublication }
      )
    )
  );
  vi.stubGlobal('fetch', fetcher);
  await openStationChart(
    div,
    placeholder,
    { code: 'MACTB_hidro', name: 'Macuspana', river: 'Puxcatán' },
    () => {}
  );
  expect(fetcher.mock.calls.map(c => c[0])).toEqual([
    '/api/v1/ipcet/levels/MACTB/recent',
    '/api/v1/forecasts/mactb',
  ]);
  expect(plot).toHaveBeenCalledTimes(1);
  const [, traces, layout] = plot.mock.calls[0]!;
  expect(traces[0].x).toEqual(['2026-09-24', '2026-10-22', '2026-10-23']);
  expect(traces[0].y).toEqual([7.1, null, 6.99]);
  const points = Object.values(mactbPublication.forecasts);
  expect(traces[1].y).toEqual([null, ...points.map(p => p.q10)]);
  expect(traces[2]).toMatchObject({
    fill: 'tonexty',
    y: [null, ...points.map(p => p.q90)],
  });
  expect(traces[3]).toMatchObject({
    x: ['2026-10-25', '2026-10-26', '2026-10-28', '2026-11-01'],
    y: [null, ...points.map(p => p.q50)],
    mode: 'lines+markers',
    marker: { size: [0, 7, 7, 7] },
  });
  expect(traces[4]).toMatchObject({ name: 'NAMO 9.85 m (oficial)', y: [9.85, 9.85] });
  expect(layout.xaxis.range).toEqual(['2026-09-24', '2026-11-01']);
});
