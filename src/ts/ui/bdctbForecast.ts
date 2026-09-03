const SCHEMA_VERSION = 'bdctb-forecast/v1';
const MODEL_VERSION = 'BDCTB Exogenous Quantile Gradient Boosting v1';
const WARNING =
  'Modeled river-stage forecast, not an observation or an official warning.';
const HORIZONS = [1, 3, 7] as const;
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const POLL_JITTER_FRACTION = 0.1;

export interface ForecastPoint {
  horizon_days: number;
  target_date: string;
  q10: number;
  q50: number;
  q90: number;
}

export interface BdctbForecast {
  schema_version: string;
  station: { code: string; name: string };
  model_version: string;
  issue_time: string;
  generated_at: string;
  status: {
    availability: 'available';
    freshness: 'fresh' | 'stale';
    age_seconds: number;
    stale_after_seconds: number;
    evaluated_at: string;
  };
  forecasts: ForecastPoint[];
  unit: 'm';
  data_kind: 'modeled_not_observed';
  warning: string;
  provenance: 'synthetic_demo' | 'model_run';
  scientific_use: 'prohibited' | 'model_output';
}

export class ForecastRequestError extends Error {
  constructor(
    readonly code: 'unavailable' | 'timeout' | 'malformed' | 'network',
    message: string
  ) {
    super(message);
    this.name = 'ForecastRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function isOffsetTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseBdctbForecast(value: unknown): BdctbForecast {
  const rootKeys = [
    'schema_version',
    'station',
    'model_version',
    'issue_time',
    'generated_at',
    'status',
    'forecasts',
    'unit',
    'data_kind',
    'warning',
    'provenance',
    'scientific_use',
  ];
  if (!isRecord(value) || !hasExactKeys(value, rootKeys)) {
    throw new ForecastRequestError(
      'malformed',
      'The forecast response has an invalid shape.'
    );
  }
  const station = value['station'];
  const status = value['status'];
  const points = value['forecasts'];
  if (
    !isRecord(station) ||
    !hasExactKeys(station, ['code', 'name']) ||
    station['code'] !== 'BDCTB' ||
    typeof station['name'] !== 'string' ||
    station['name'].trim() === '' ||
    !isRecord(status) ||
    !hasExactKeys(status, [
      'availability',
      'freshness',
      'age_seconds',
      'stale_after_seconds',
      'evaluated_at',
    ]) ||
    status['availability'] !== 'available' ||
    !['fresh', 'stale'].includes(String(status['freshness'])) ||
    !Number.isInteger(status['age_seconds']) ||
    Number(status['age_seconds']) < 0 ||
    !Number.isInteger(status['stale_after_seconds']) ||
    Number(status['stale_after_seconds']) <= 0 ||
    !isOffsetTimestamp(status['evaluated_at']) ||
    !Array.isArray(points) ||
    points.length !== HORIZONS.length
  ) {
    throw new ForecastRequestError('malformed', 'The forecast metadata is invalid.');
  }

  const parsedPoints: ForecastPoint[] = points.map((point, index) => {
    if (
      !isRecord(point) ||
      !hasExactKeys(point, ['horizon_days', 'target_date', 'q10', 'q50', 'q90'])
    ) {
      throw new ForecastRequestError(
        'malformed',
        'The forecast quantiles are invalid.'
      );
    }
    const horizon = HORIZONS[index]!;
    const target = new Date(`${String(point['target_date'])}T00:00:00Z`);
    const expectedTarget = new Date(
      `${String(value['issue_time']).slice(0, 10)}T00:00:00Z`
    );
    expectedTarget.setUTCDate(expectedTarget.getUTCDate() + horizon);
    if (
      point['horizon_days'] !== horizon ||
      typeof point['target_date'] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(point['target_date']) ||
      !Number.isFinite(target.getTime()) ||
      target.toISOString().slice(0, 10) !== expectedTarget.toISOString().slice(0, 10) ||
      !isFiniteNumber(point['q10']) ||
      !isFiniteNumber(point['q50']) ||
      !isFiniteNumber(point['q90']) ||
      point['q10'] > point['q50'] ||
      point['q50'] > point['q90']
    ) {
      throw new ForecastRequestError(
        'malformed',
        'The forecast quantiles are invalid.'
      );
    }
    return point as unknown as ForecastPoint;
  });

  if (
    value['schema_version'] !== SCHEMA_VERSION ||
    value['model_version'] !== MODEL_VERSION ||
    !isOffsetTimestamp(value['issue_time']) ||
    !isOffsetTimestamp(value['generated_at']) ||
    Date.parse(value['generated_at']) < Date.parse(value['issue_time']) ||
    value['unit'] !== 'm' ||
    value['data_kind'] !== 'modeled_not_observed' ||
    value['warning'] !== WARNING ||
    !['synthetic_demo', 'model_run'].includes(String(value['provenance'])) ||
    (value['provenance'] === 'synthetic_demo'
      ? value['scientific_use'] !== 'prohibited'
      : value['scientific_use'] !== 'model_output')
  ) {
    throw new ForecastRequestError(
      'malformed',
      'The forecast contract is not supported.'
    );
  }
  const ageSeconds = Number(status['age_seconds']);
  const staleAfterSeconds = Number(status['stale_after_seconds']);
  const evaluatedAge = Math.max(
    0,
    Math.floor(
      (Date.parse(String(status['evaluated_at'])) - Date.parse(value['generated_at'])) /
        1000
    )
  );
  if (
    status['freshness'] !== (ageSeconds > staleAfterSeconds ? 'stale' : 'fresh') ||
    ageSeconds !== evaluatedAge
  ) {
    throw new ForecastRequestError(
      'malformed',
      'The forecast freshness metadata is invalid.'
    );
  }

  return { ...value, station, status, forecasts: parsedPoints } as BdctbForecast;
}

export async function fetchBdctbForecast(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
  endpoint = '/api/v1/forecasts/bdctb',
  signal?: AbortSignal
): Promise<BdctbForecast> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 503) {
        throw new ForecastRequestError(
          'unavailable',
          'No valid cached forecast is currently available.'
        );
      }
      throw new ForecastRequestError(
        'network',
        `Forecast API returned HTTP ${response.status}.`
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ForecastRequestError(
        'malformed',
        'The forecast API returned malformed JSON.'
      );
    }
    return parseBdctbForecast(payload);
  } catch (error) {
    if (error instanceof ForecastRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ForecastRequestError('timeout', 'The forecast request timed out.');
    }
    throw new ForecastRequestError(
      'network',
      'The local forecast API could not be reached.'
    );
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

let requestGeneration = 0;
let pollTimer: number | undefined;
let activeRequest: AbortController | undefined;
let renderedIdentity: string | undefined;
let activeDialog: HTMLDialogElement | undefined;

function stopPolling(): void {
  if (pollTimer !== undefined) window.clearTimeout(pollTimer);
  pollTimer = undefined;
  activeRequest?.abort();
  activeRequest = undefined;
}

function schedulePoll(dialog: HTMLDialogElement, generation: number): void {
  if (generation !== requestGeneration || !dialog.open || document.hidden) return;
  const jitter = 1 + POLL_JITTER_FRACTION * (2 * Math.random() - 1);
  pollTimer = window.setTimeout(() => {
    pollTimer = undefined;
    void refreshForecast(dialog, generation, false);
  }, POLL_INTERVAL_MS * jitter);
}

function purgeChart(dialog: HTMLDialogElement, force = false): void {
  const chart = dialog.querySelector<HTMLDivElement>('.forecast-chart');
  if (!chart) return;
  if (force || chart.dataset['rendered']) Plotly.purge(chart);
  delete chart.dataset['rendered'];
}

export function bdctbForecastAction(stationId: string, isHydrometric: boolean): string {
  const code = stationId.replace(/_(hidro|clima)$/, '');
  return code === 'BDCTB' && isHydrometric
    ? '<button type="button" class="station-popup-btn station-forecast-link">View modeled forecast</button>'
    : '';
}

function ensureDialog(): HTMLDialogElement {
  const existing = document.getElementById(
    'bdctb-forecast-dialog'
  ) as HTMLDialogElement | null;
  if (existing) return existing;
  const dialog = document.createElement('dialog');
  dialog.id = 'bdctb-forecast-dialog';
  dialog.className = 'forecast-dialog';
  dialog.setAttribute('aria-labelledby', 'bdctb-forecast-title');
  dialog.innerHTML = `
    <div class="forecast-dialog-header">
      <div><p class="forecast-eyebrow">BDCTB modeled trajectory</p><h2 id="bdctb-forecast-title">Boca del Cerro forecast</h2></div>
      <button type="button" class="forecast-close" aria-label="Close forecast">&times;</button>
    </div>
    <div class="forecast-state" role="status" aria-live="polite"></div>
    <div class="forecast-content" hidden>
      <div class="forecast-meta"></div>
      <div class="forecast-chart" aria-label="Forecast median and uncertainty chart"></div>
      <p class="forecast-warning"></p>
    </div>`;
  dialog
    .querySelector('.forecast-close')
    ?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    requestGeneration += 1;
    stopPolling();
    if (activeDialog === dialog) activeDialog = undefined;
    renderedIdentity = undefined;
    purgeChart(dialog, true);
  });
  window.addEventListener('resize', () => {
    const chart = dialog.querySelector<HTMLDivElement>('.forecast-chart');
    if (dialog.open && chart?.dataset['rendered']) Plotly.Plots.resize(chart);
  });
  document.body.appendChild(dialog);
  return dialog;
}

async function renderForecast(
  dialog: HTMLDialogElement,
  forecast: BdctbForecast,
  generation: number
): Promise<void> {
  const previousChart = dialog.querySelector<HTMLDivElement>('.forecast-chart')!;
  const chart = previousChart.cloneNode(false) as HTMLDivElement;
  const x = forecast.forecasts.map(point => point.target_date);
  const q10 = forecast.forecasts.map(point => point.q10);
  const q50 = forecast.forecasts.map(point => point.q50);
  const q90 = forecast.forecasts.map(point => point.q90);
  try {
    await Plotly.newPlot(
      chart,
      [
        {
          x,
          y: q10,
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          hoverinfo: 'skip',
          showlegend: false,
        },
        {
          x,
          y: q90,
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          fill: 'tonexty',
          fillcolor: 'rgba(14, 116, 144, 0.22)',
          name: 'q10-q90 uncertainty',
          hovertemplate: 'q90: %{y:.2f} m<extra></extra>',
        },
        {
          x,
          y: q50,
          type: 'scatter',
          mode: 'lines+markers',
          line: { color: '#0e7490', width: 3 },
          marker: { size: 8 },
          name: 'q50 median',
          hovertemplate: '%{x}<br>q50: %{y:.2f} m<extra></extra>',
        },
      ],
      {
        autosize: true,
        margin: { l: 52, r: 20, t: 20, b: 48 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        xaxis: { title: 'Target date', type: 'date' },
        yaxis: { title: 'Modeled stage (m)' },
        legend: { orientation: 'h', y: 1.12 },
      },
      { responsive: true, displaylogo: false }
    );
  } catch (error) {
    Plotly.purge(chart);
    throw error;
  }
  if (generation !== requestGeneration || !dialog.open) {
    Plotly.purge(chart);
    return;
  }
  previousChart.replaceWith(chart);
  chart.dataset['rendered'] = 'true';
  if (previousChart.dataset['rendered']) Plotly.purge(previousChart);
  Plotly.Plots.resize(chart);
}

function updateForecastMetadata(
  dialog: HTMLDialogElement,
  forecast: BdctbForecast
): void {
  const state = dialog.querySelector<HTMLElement>('.forecast-state')!;
  const content = dialog.querySelector<HTMLElement>('.forecast-content')!;
  const meta = dialog.querySelector<HTMLElement>('.forecast-meta')!;
  const warning = dialog.querySelector<HTMLElement>('.forecast-warning')!;
  state.textContent = '';
  content.hidden = false;
  meta.replaceChildren();
  const entries: Array<[string, string]> = [
    ['Issue time', new Date(forecast.issue_time).toLocaleString()],
    ['Generated', new Date(forecast.generated_at).toLocaleString()],
    ['Evaluated', new Date(forecast.status.evaluated_at).toLocaleString()],
    ['Model', forecast.model_version],
    [
      'Provenance',
      forecast.provenance === 'synthetic_demo' ? 'Synthetic demo' : 'Model run',
    ],
    ['Freshness', forecast.status.freshness.toUpperCase()],
  ];
  for (const [label, text] of entries) {
    const item = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    item.append(strong, text);
    if (label === 'Freshness') item.className = `forecast-${forecast.status.freshness}`;
    meta.appendChild(item);
  }
  if (forecast.provenance === 'synthetic_demo') {
    const demo = document.createElement('span');
    demo.className = 'forecast-demo';
    demo.textContent = 'SYNTHETIC DEMO - prohibited as scientific/model evidence';
    meta.appendChild(demo);
  }
  warning.textContent = forecast.warning;
}

export async function openBdctbForecastDialog(): Promise<void> {
  const dialog = ensureDialog();
  activeDialog = dialog;
  const generation = ++requestGeneration;
  const state = dialog.querySelector<HTMLElement>('.forecast-state')!;
  const content = dialog.querySelector<HTMLElement>('.forecast-content')!;
  purgeChart(dialog);
  state.textContent = 'Loading the latest cached forecast...';
  content.hidden = true;
  if (!dialog.open) dialog.showModal();
  stopPolling();
  await refreshForecast(dialog, generation, true);
}

document.addEventListener('visibilitychange', () => {
  if (!activeDialog?.open) return;
  const generation = ++requestGeneration;
  stopPolling();
  if (!document.hidden) void refreshForecast(activeDialog, generation, false);
});

async function refreshForecast(
  dialog: HTMLDialogElement,
  generation: number,
  initial: boolean
): Promise<void> {
  if (generation !== requestGeneration || !dialog.open || document.hidden) return;
  const state = dialog.querySelector<HTMLElement>('.forecast-state')!;
  const content = dialog.querySelector<HTMLElement>('.forecast-content')!;
  const controller = new AbortController();
  activeRequest?.abort();
  activeRequest = controller;
  try {
    const forecast = await fetchBdctbForecast(
      fetch,
      5000,
      '/api/v1/forecasts/bdctb',
      controller.signal
    );
    if (generation !== requestGeneration || !dialog.open) return;
    const identity = `${forecast.issue_time}\n${forecast.generated_at}`;
    const chart = dialog.querySelector<HTMLDivElement>('.forecast-chart');
    updateForecastMetadata(dialog, forecast);
    if (identity !== renderedIdentity || !chart?.dataset['rendered']) {
      await renderForecast(dialog, forecast, generation);
      if (generation !== requestGeneration || !dialog.open) return;
      renderedIdentity = identity;
    }
  } catch (error) {
    if (generation !== requestGeneration || !dialog.open) return;
    const hasChart = Boolean(
      dialog.querySelector<HTMLDivElement>('.forecast-chart')?.dataset['rendered']
    );
    if (hasChart && !initial) {
      state.textContent =
        'The latest refresh failed; the last valid forecast remains displayed.';
      content.hidden = false;
    } else {
      state.textContent =
        error instanceof ForecastRequestError
          ? error.message
          : 'The forecast could not be displayed.';
    }
  } finally {
    if (activeRequest === controller) activeRequest = undefined;
    schedulePoll(dialog, generation);
  }
}
