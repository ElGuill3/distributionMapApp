/**
 * Módulo de gráfica temporal (Plotly).
 *
 * Responsabilidades:
 *  - buildTrace()            : construye la configuración de una traza de Plotly.
 *  - plotAllSelectedSeries() : renderiza todas las series activas en la gráfica.
 */

import type { VariableKey, SeriesData } from '../types.js';

// ---------------------------------------------------------------------------
// Configuración por variable
// ---------------------------------------------------------------------------

interface VariableChartConfig {
  label: string;
  lineColorLight: string;
  lineColorDark: string;
  yRange?: (dataMin: number, dataMax: number, padding: number) => [number, number];
}

const VARIABLE_CHART_CONFIG: Record<VariableKey, VariableChartConfig> = {
  ndvi: {
    label: 'NDVI',
    lineColorLight: '#006837', // Verde oscuro rico
    lineColorDark: '#34d399', // Esmeralda brillante
    yRange: (min, max, pad) => [Math.max(0, min - pad), Math.min(1, max + pad)],
  },
  temp: {
    label: 'Temp (°C)',
    lineColorLight: '#ef4444', // Rojo
    lineColorDark: '#f97316', // Naranja
  },
  soil: {
    label: 'Humedad suelo (%)',
    lineColorLight: '#1d4ed8', // Azul royal
    lineColorDark: '#60a5fa', // Azul cielo brillante
    yRange: () => [0, 100],
  },
  precip: {
    label: 'Precipitación diaria (mm/día)',
    lineColorLight: '#0369a1', // Azul profundo
    lineColorDark: '#38bdf8', // Celeste vibrante
    yRange: (min, max, pad) => [Math.max(0, min - pad), max + pad],
  },
  local_sp: {
    label: 'Nivel San Pedro (m)',
    lineColorLight: '#6d28d9', // Violeta
    lineColorDark: '#c084fc', // Lavanda pastel
  },
  local_bd: {
    label: 'Nivel Boca del Cerro (m)',
    lineColorLight: '#be185d', // Rosa profundo
    lineColorDark: '#f472b6', // Rosa pastel brillante
  },
};

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface TraceConfig {
  variable: VariableKey;
  label: string;
  lineColor: string;
  dates: string[];
  values: number[];
  yRange: [number, number];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getThemeColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return val || fallback;
}

function hexToRgba(hex: string, opacity: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ---------------------------------------------------------------------------
// Funciones exportadas
// ---------------------------------------------------------------------------

/**
 * Construye la configuración de una traza Plotly para la variable indicada.
 */
export function buildTrace(
  variable: VariableKey,
  dates: string[],
  values: number[]
): TraceConfig {
  const cfg = VARIABLE_CHART_CONFIG[variable];
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = Math.max(dataMax - dataMin, 1e-6);
  const padding = span * 0.1;

  const yRange: [number, number] = cfg.yRange
    ? cfg.yRange(dataMin, dataMax, padding)
    : [dataMin - padding, dataMax + padding];

  const isDark = isDarkModeActive();
  const lineColor = isDark ? cfg.lineColorDark : cfg.lineColorLight;

  return {
    variable,
    label: cfg.label,
    lineColor,
    dates,
    values,
    yRange,
  };
}

/**
 * Exporta la gráfica actual como PNG usando Plotly.toImage().
 *
 * @param chartDiv - Elemento DOM donde está renderizada la gráfica Plotly.
 * @returns Blob de la imagen PNG.
 */
export async function plotChartAsPng(chartDiv: HTMLDivElement): Promise<Blob> {
  const dataUrl = await Plotly.toImage(chartDiv, {
    format: 'png',
    width: 1200,
    height: 600,
    scale: 2,
  } as Record<string, unknown>);

  const response = await fetch(dataUrl);
  return response.blob();
}

// Registro de gráficas activas para el repintado ante cambio de tema
interface LastPlotState {
  allSeries: Partial<Record<VariableKey, SeriesData | undefined>>;
  onShow: () => void;
  onHide: () => void;
  onShowPlaceholder?: () => void;
  onHidePlaceholder?: () => void;
}

const activeCharts = new Map<HTMLDivElement, LastPlotState>();

export function isDarkModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

if (typeof window !== 'undefined') {
  const redraw = () => {
    for (const [chartDiv, state] of activeCharts.entries()) {
      plotAllSelectedSeries(
        chartDiv,
        state.allSeries,
        state.onShow,
        state.onHide,
        state.onShowPlaceholder,
        state.onHidePlaceholder
      );
    }
  };
  if (typeof window.matchMedia === 'function') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', redraw);
  }
  window.addEventListener('theme-change', redraw);
}

/**
 * Renderiza todas las series activas en la gráfica Plotly.
 */
export function plotAllSelectedSeries(
  chartDiv: HTMLDivElement,
  allSeries: Partial<Record<VariableKey, SeriesData | undefined>>,
  onShow: () => void,
  onHide: () => void,
  onShowPlaceholder?: () => void,
  onHidePlaceholder?: () => void
): void {
  const vars: VariableKey[] = [
    'ndvi',
    'temp',
    'soil',
    'precip',
    'local_sp',
    'local_bd',
  ];

  const seriesReady = vars
    .map(key => {
      const data = allSeries[key];
      if (!data || data.values.length === 0) return null;
      return buildTrace(key, data.dates, data.values);
    })
    .filter((s): s is TraceConfig => s !== null);

  if (seriesReady.length === 0) {
    Plotly.purge(chartDiv);
    activeCharts.delete(chartDiv);
    onHide();
    if (onShowPlaceholder) onShowPlaceholder();
    return;
  }

  onShow();
  if (onHidePlaceholder) onHidePlaceholder();

  // Guardar estado de la gráfica activa
  const state: LastPlotState = {
    allSeries,
    onShow,
    onHide,
  };
  if (onShowPlaceholder !== undefined) state.onShowPlaceholder = onShowPlaceholder;
  if (onHidePlaceholder !== undefined) state.onHidePlaceholder = onHidePlaceholder;
  activeCharts.set(chartDiv, state);

  const isDark = isDarkModeActive();
  const fgColor = getThemeColor('--surface-fg', '#374151');
  const gridColor = getThemeColor('--gray-200', '#dce1e7');
  const zeroLineColor = getThemeColor('--gray-300', '#b0b8c4');
  const textColor = getThemeColor('--gray-400', '#6b7280');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yAxesConfig: Record<string, any> = {};

  seriesReady.forEach((s, idx) => {
    const axisName = idx === 0 ? 'y' : `y${idx + 1}`;
    const axisKey = idx === 0 ? 'yaxis' : `yaxis${idx + 1}`;

    yAxesConfig[axisKey] = {
      title: {
        text: s.label,
        font: { family: 'system-ui, sans-serif', size: 11, color: fgColor },
      },
      range: s.yRange,
      side: idx === 0 ? 'left' : 'right',
      overlaying: idx === 0 ? undefined : 'y',
      gridcolor: gridColor,
      zeroline: true,
      zerolinecolor: zeroLineColor,
      tickfont: { family: 'system-ui, sans-serif', size: 10, color: textColor },
      showline: false,
    };

    traces.push({
      x: s.dates,
      y: s.values,
      type: 'scatter',
      mode: 'lines',
      name: s.label,
      line: { color: s.lineColor, width: 3, shape: 'spline' },
      fill: 'tozeroy',
      fillcolor: hexToRgba(s.lineColor, 0.08),
      hovertemplate: `Fecha: %{x}<br>${s.label}: %{y:.2f}<extra></extra>`,
      hoverlabel: {
        bgcolor: isDark ? '#1f2933' : '#ffffff',
        bordercolor: s.lineColor,
        font: { family: 'system-ui, sans-serif', size: 12, color: fgColor },
      },
      yaxis: axisName,
    });
  });

  requestAnimationFrame(() => {
    const width = chartDiv.clientWidth || 600;
    const height = chartDiv.clientHeight || 280;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      margin: { l: 60, r: 60, t: 30, b: 50 },
      width,
      height,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: {
        title: {
          text: 'Fecha',
          font: { family: 'system-ui, sans-serif', size: 12, color: textColor },
        },
        type: 'date',
        tickfont: { family: 'system-ui, sans-serif', size: 10, color: textColor },
        showgrid: false,
        zeroline: false,
        showline: true,
        linecolor: gridColor,
        showspikes: true,
        spikemode: 'across',
        spikedash: 'dash',
        spikethickness: 1,
        spikecolor: zeroLineColor,
      },
      showlegend: true,
      legend: {
        font: { family: 'system-ui, sans-serif', size: 10, color: fgColor },
        orientation: 'h',
        yanchor: 'bottom',
        y: 1.02,
        xanchor: 'right',
        x: 1,
        bgcolor: 'rgba(0,0,0,0)',
      },
      ...yAxesConfig,
    };

    const config = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        'select2d',
        'lasso2d',
        'autoScale2d',
        'toggleSpikelines',
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((chartDiv as any)._fullLayout) {
      Plotly.react(chartDiv, traces, layout, config);
    } else {
      Plotly.newPlot(chartDiv, traces, layout, config);
    }
  });
}
