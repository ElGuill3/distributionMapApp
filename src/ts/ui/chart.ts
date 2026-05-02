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
  label:     string;
  lineColor: string;
  yRange?: (dataMin: number, dataMax: number, padding: number) => [number, number];
}

const VARIABLE_CHART_CONFIG: Record<VariableKey, VariableChartConfig> = {
  ndvi: {
    label:     'NDVI',
    lineColor: '#006837',
    yRange: (min, max, pad) => [Math.max(0, min - pad), Math.min(1, max + pad)],
  },
  temp: {
    label:     'Temp (°C)',
    lineColor: '#ff4f00',
  },
  soil: {
    label:     'Humedad suelo (%)',
    lineColor: '#2b6cb0',
    yRange: () => [0, 100],
  },
  precip: {
    label:     'Precipitación diaria (mm/día)',
    lineColor: '#0044aa',
    yRange: (min, max, pad) => [Math.max(0, min - pad), max + pad],
  },
  water: {
    label:     'Superficie agua (ha)',
    lineColor: '#0000ff',
    yRange: (_min, max, pad) => [0, max + pad],
  },
  local_sp: {
    label:     'Nivel San Pedro (m)',
    lineColor: '#8b5cf6',
  },
  local_bd: {
    label:     'Nivel Boca del Cerro (m)',
    lineColor: '#ec4899',
  },
};

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface TraceConfig {
  variable:  VariableKey;
  label:     string;
  lineColor: string;
  dates:     string[];
  values:    number[];
  yRange:    [number, number];
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
  values: number[],
): TraceConfig {
  const cfg     = VARIABLE_CHART_CONFIG[variable];
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span    = Math.max(dataMax - dataMin, 1e-6);
  const padding = span * 0.1;

  const yRange: [number, number] = cfg.yRange
    ? cfg.yRange(dataMin, dataMax, padding)
    : [dataMin - padding, dataMax + padding];

  return { variable, label: cfg.label, lineColor: cfg.lineColor, dates, values, yRange };
}

/**
 * Exporta la gráfica actual como PNG usando Plotly.toImage().
 *
 * @param chartDiv - Elemento DOM donde está renderizada la gráfica Plotly.
 * @returns Blob de la imagen PNG.
 */
export async function plotChartAsPng(chartDiv: HTMLDivElement): Promise<Blob> {
  // Plotly.toImage devuelve una string data URL (data:image/png;base64,...)
  const dataUrl = await Plotly.toImage(chartDiv, {
    format: 'png',
    width: 1200,
    height: 600,
    scale: 2,
  } as Record<string, unknown>);

  // Convertir data URL a Blob
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Renderiza todas las series activas en la gráfica Plotly.
 *
 * @param chartDiv    - Elemento DOM donde se monta Plotly.
 * @param allSeries   - Mapa con los datos de cada variable activa.
 * @param onShow      - Callback llamado cuando la gráfica tiene al menos una serie.
 * @param onHide      - Callback llamado cuando no hay ninguna serie.
 */
export function plotAllSelectedSeries(
  chartDiv: HTMLDivElement,
  allSeries: Partial<Record<VariableKey, SeriesData | undefined>>,
  onShow: () => void,
  onHide: () => void,
): void {
  const vars: VariableKey[] = ['ndvi', 'temp', 'soil', 'precip', 'local_sp', 'local_bd'];

  const seriesReady = vars
    .map(key => {
      const data = allSeries[key];
      if (!data || data.values.length === 0) return null;
      return buildTrace(key, data.dates, data.values);
    })
    .filter((s): s is TraceConfig => s !== null);

  if (seriesReady.length === 0) {
    Plotly.purge(chartDiv);
    onHide();
    return;
  }

  onShow();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yAxesConfig: Record<string, any> = {};

  seriesReady.forEach((s, idx) => {
    const axisName = idx === 0 ? 'y' : `y${idx + 1}`;
    const axisKey  = idx === 0 ? 'yaxis' : `yaxis${idx + 1}`;

    yAxesConfig[axisKey] = {
      title:      s.label,
      range:      s.yRange,
      side:       idx === 0 ? 'left' : 'right',
      overlaying: idx === 0 ? undefined : 'y',
    };

    traces.push({
      x:             s.dates,
      y:             s.values,
      type:          'scatter',
      mode:          'lines',
      name:          s.label,
      line:          { color: s.lineColor, width: 2 },
      hovertemplate: `Fecha: %{x}<br>${s.label}: %{y:.2f}<extra></extra>`,
      yaxis:         axisName,
    });
  });

  requestAnimationFrame(() => {
    const width  = chartDiv.clientWidth  || 600;
    const height = chartDiv.clientHeight || 280;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      margin:     { l: 60, r: 60, t: 30, b: 50 },
      width,
      height,
      xaxis:      { title: 'Fecha', type: 'date' },
      showlegend: true,
      ...yAxesConfig,
    };

    const config = {
      responsive:               true,
      displaylogo:              false,
      modeBarButtonsToRemove:   ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((chartDiv as any)._fullLayout) {
      Plotly.react(chartDiv, traces, layout, config);
    } else {
      Plotly.newPlot(chartDiv, traces, layout, config);
    }
  });
}
