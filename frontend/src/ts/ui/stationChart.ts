import {
  claimChart,
  isDarkModeActive,
  buildChartLayout,
  buildChartYAxis,
  buildChartConfig,
  hexToRgba,
  buildTrace,
} from './chart.js';
import {
  fetchBdctbForecast,
  type BdctbForecast,
  type ForecastResponse,
} from './bdctbForecast.js';
import { ipcetStatus } from './ipcetStatus.js';

// Adding another published model only requires registering its loader here.
const forecastLoaders: Record<
  string,
  (signal: AbortSignal) => Promise<ForecastResponse>
> = {
  BDCTB: signal => fetchBdctbForecast(fetch, 5000, '/api/v1/forecasts/bdctb', signal),
};
export function forecastLoaderFor(id: string) {
  return forecastLoaders[id.replace(/_(hidro|clima)$/, '')];
}
interface RecentPoint {
  date: string;
  hoy: number | null;
}
export interface ChartStation {
  code: string;
  name: string;
  river: string;
}
const UNAVAILABLE = 'Los niveles no están disponibles. Intente de nuevo más tarde.';
const TIMEOUT = 'La consulta de niveles tardó demasiado. Intente de nuevo.';

function parseRecent(value: unknown, code: string): RecentPoint[] {
  const payload = value as {
    schema?: unknown;
    stations?: Record<string, unknown>;
  } | null;
  const points = payload?.stations?.[code];
  if (payload?.schema !== 'ipcet-recent/v1' || !Array.isArray(points))
    throw new Error(UNAVAILABLE);
  let previous = '';
  for (const point of points) {
    if (
      !point ||
      typeof point.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
      !Number.isFinite(Date.parse(point.date)) ||
      new Date(point.date).toISOString().slice(0, 10) !== point.date ||
      point.date <= previous ||
      (point.hoy !== null &&
        (typeof point.hoy !== 'number' || !Number.isFinite(point.hoy)))
    )
      throw new Error(UNAVAILABLE);
    previous = point.date;
  }
  return points as RecentPoint[];
}

/** User-triggered only. Station and analysis content replace each other in panel A. */
export async function openStationChart(
  chartDiv: HTMLDivElement,
  placeholder: HTMLDivElement,
  station: ChartStation,
  onShow: () => void
): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  let redraw = () => {};
  let originalPlaceholder = '';
  let originalRole: string | null = null;
  const current = claimChart(chartDiv, {
    kind: 'station',
    redraw: () => redraw(),
    release: () => {
      controller.abort();
      placeholder.innerHTML = originalPlaceholder;
      if (originalRole === null) placeholder.removeAttribute('role');
      else placeholder.setAttribute('role', originalRole);
    },
  });
  originalPlaceholder = placeholder.innerHTML;
  originalRole = placeholder.getAttribute('role');
  const message = (text: string) => {
    Plotly.purge(chartDiv);
    placeholder.textContent = text;
    placeholder.setAttribute('role', 'status');
    placeholder.classList.remove('chart-placeholder--hidden');
  };
  onShow();
  message('Consultando los niveles…');
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 5000);
  try {
    const code = station.code.replace(/_(hidro|clima)$/, '');
    const loadForecast = forecastLoaderFor(code);
    const [points, result] = await Promise.all([
      (async () => {
        const response = await fetch(
          `/api/v1/ipcet/levels/${encodeURIComponent(code)}/recent`,
          {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          }
        );
        if (!response.ok) throw new Error(UNAVAILABLE);
        return parseRecent(await response.json(), code);
      })(),
      loadForecast ? loadForecast(controller.signal) : Promise.resolve(undefined),
    ]);
    if (!current() || controller.signal.aborted) return;
    const forecast = result?.forecast;
    const namo = forecast?.forecasts.h1.namo_m ?? ipcetStatus.stateFor(code)?.namo;
    if (points.length === 0 && !forecast) {
      message('No hay niveles recientes disponibles para esta estación.');
      return;
    }
    redraw = () => {
      if (!current()) return;
      placeholder.classList.add('chart-placeholder--hidden');
      drawStation(chartDiv, station, points, forecast, namo);
    };
    redraw();
  } catch (error) {
    if (!current()) return;
    message(
      timedOut || (error as { code?: string })?.code === 'timeout'
        ? TIMEOUT
        : UNAVAILABLE
    );
    controller.abort();
  } finally {
    window.clearTimeout(timer);
  }
}

function drawStation(
  chartDiv: HTMLDivElement,
  station: ChartStation,
  points: RecentPoint[],
  forecast: BdctbForecast | undefined,
  namo: number | null | undefined
): void {
  const dark = isDarkModeActive();
  const observed = dark ? '#7dd3fc' : '#0369a1';
  const modeled = dark ? '#c4b5fd' : '#6d28d9';
  const fg = dark ? '#e5e7eb' : '#374151';
  // Missing reports do not move the 30-day observation window forward. A
  // validated live model input is also a dated IPCET observation.
  const observationDates = points.filter(p => p.hoy !== null).map(p => p.date);
  if (forecast?.mode === 'live' && forecast.live_input)
    observationDates.push(forecast.live_input.date);
  const latest = observationDates.sort().pop() ?? points[points.length - 1]?.date;
  const start = latest
    ? new Date(Date.parse(`${latest}T00:00:00Z`) - 29 * 86400000)
        .toISOString()
        .slice(0, 10)
    : undefined;
  points = start
    ? points.filter(p => p.date >= start && (!latest || p.date <= latest))
    : points;
  chartDiv.setAttribute(
    'aria-label',
    `${station.name} · ${station.river}: niveles y pronóstico`
  );
  const traces: Record<string, unknown>[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Nivel observado (IPCET)',
      x: points.map(p => p.date),
      y: points.map(p => p.hoy),
      connectgaps: false,
      line: { color: observed, width: 3, dash: 'solid', shape: 'spline' },
      fill: 'tozeroy',
      fillcolor: hexToRgba(observed, 0.08),
    },
  ];
  const dates = points.map(p => p.date);
  if (forecast) {
    const issue = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(forecast.issue_time));
    const predictions = [
      forecast.forecasts.h1,
      forecast.forecasts.h3,
      forecast.forecasts.h7,
    ];
    const x = [issue, ...predictions.map(p => p.target_date)];
    // Only a same-day live observation anchors the model at issue. Never invent a GloFAS-only level.
    const anchor =
      forecast.live_input?.date === issue ? forecast.live_input.stage_m : null;
    const common = {
      type: 'scatter',
      mode: 'lines',
      x,
      connectgaps: false,
      legendgroup: 'probability',
    };
    traces.push(
      {
        ...common,
        name: '',
        y: [anchor, ...predictions.map(p => p.q10)],
        line: { width: 0 },
        showlegend: false,
        hoverinfo: 'skip',
      },
      {
        ...common,
        name: 'Rango probable (10–90 %)',
        y: [anchor, ...predictions.map(p => p.q90)],
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: dark ? 'rgba(196,181,253,0.22)' : 'rgba(109,40,217,0.16)',
      },
      {
        type: 'scatter',
        // Markers sit only on modelled leads; the line between them is a visual link.
        mode: 'lines+markers',
        name: 'Pronóstico (mediana)',
        x,
        y: [anchor, ...predictions.map(p => p.q50)],
        connectgaps: false,
        line: { color: modeled, width: 3, dash: 'dash' },
        marker: { color: modeled, size: [0, ...predictions.map(() => 7)] },
      }
    );
    dates.push(...x);
  }
  dates.sort();
  if (namo != null && dates.length)
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: `NAMO ${namo} m (oficial)`,
      x: [dates[0], dates[dates.length - 1]],
      y: [namo, namo],
      line: { color: dark ? '#d1d5db' : '#4b5563', width: 2, dash: 'dot' },
    });
  const values = [
    ...points.flatMap(p => (p.hoy === null ? [] : [p.hoy])),
    ...(forecast
      ? Object.values(forecast.forecasts).flatMap(p => [p.q10, p.q50, p.q90])
      : []),
    ...(namo == null ? [] : [namo]),
  ];
  const shared = buildChartLayout(chartDiv);
  const layout = {
    ...shared,
    xaxis: {
      ...shared.xaxis,
      ...(start ? { range: [start, dates[dates.length - 1]] } : {}),
    },
    yaxis: {
      ...buildChartYAxis('Nivel (m)'),
      ...(values.length
        ? { range: buildTrace('ipcet_hidro', dates, values).yRange }
        : {}),
    },
    annotations:
      forecast?.mode === 'glofas_only'
        ? [
            {
              text: 'Sin nivel en vivo: el pronóstico puede sobrestimar',
              xref: 'paper',
              yref: 'paper',
              x: 0,
              y: 0.98,
              yanchor: 'top',
              showarrow: false,
              font: { color: fg, size: 11 },
            },
          ]
        : [],
  };
  const config = buildChartConfig();
  if ((chartDiv as HTMLDivElement & { _fullLayout?: unknown })._fullLayout)
    Plotly.react(chartDiv, traces, layout, config);
  else Plotly.newPlot(chartDiv, traces, layout, config);
}
