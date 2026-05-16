/**
 * Cliente de API para el frontend — distributionMapApp.
 *
 * Centraliza todas las llamadas HTTP al backend en funciones tipadas.
 * Mantiene la misma firma y comportamiento que el código original en main.ts.
 *
 * TODO (Phase B-C): Eliminar duplicaciones entre requestGifAndSeries y
 *   requestGifAndSeriesForPanel; unificar _loadCompareStation con
 *   requestLocalStationLevel.
 */

import type {
  BBox,
  GifResponse,
  TimeseriesResponse,
  StationResponse,
  FloodRiskResponse,
  VariableKey,
  SeriesData,
} from './types.js';
import { VARIABLE_DATA_KEY } from './types.js';
import { GIF_ENDPOINT, TS_ENDPOINT } from './config.js';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Construye la URL completa para una petición de animación GIF. */
function buildGifUrl(
  variable: string,
  start: string,
  end: string,
  bbox: BBox,
  taskId: string,
): string {
  const bboxJson = JSON.stringify(bbox);
  return `${GIF_ENDPOINT[variable as keyof typeof GIF_ENDPOINT]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`
    + `&task_id=${encodeURIComponent(taskId)}`;
}

/** Construye la URL completa para una petición de serie temporal. */
function buildTsUrl(variable: string, start: string, end: string, bbox: BBox): string {
  const bboxJson = JSON.stringify(bbox);
  return `${TS_ENDPOINT[variable as keyof typeof TS_ENDPOINT]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`;
}

/** Tipo para los datos de progreso SSE */
interface ProgressEvent {
  progress?: number;
  message?: string;
}

/**
 * Crea un EventSource para seguimiento de progreso SSE.
 * Devuelve el EventSource para poder cerrarlo desde quien lo llama.
 *
 * @param taskId - Identificador de la tarea de procesamiento
 * @param onProgress - Callback invoked en cada mensaje de progreso
 * @param onError - Callback invocado cuando ocurre un error de conexión
 */
export function createProgressEventSource(
  taskId: string,
  onProgress: (progress: number, message: string) => void,
  onError: () => void,
): EventSource {
  const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ProgressEvent;
      if (typeof data.progress !== 'number') return;
      onProgress(data.progress, data.message ?? '');
    } catch { /* ignore */ }
  };
  eventSource.onerror = () => {
    eventSource.close();
    onError();
  };
  return eventSource;
}

// ---------------------------------------------------------------------------
// GIF + Serie temporal — modo NORMAL (panel A)
// ---------------------------------------------------------------------------

export interface FetchGifAndSeriesResult {
  gifData: GifResponse & { error?: string };
  tsData: (TimeseriesResponse & { error?: string }) | null;
}

export interface FetchGifAndSeriesOptions {
  variable: string;
  start: string;
  end: string;
  bbox: BBox;
  /** Genera un taskId nuevo si no se provee */
  taskId?: string;
}

/**
 * Obtiene GIF y serie temporal para una variable (modo normal).
 * Incluye SSE de progreso y manejo de errores.
 *
 * @returns Objeto con gifData y tsData (puede ser null si la serie falla)
 * @throwsnothing Este función nunca lanza — los errores se manejan internamente
 */
export async function fetchGifAndSeries(
  options: FetchGifAndSeriesOptions,
): Promise<FetchGifAndSeriesResult> {
  const { variable, start, end, bbox } = options;
  const taskId = options.taskId ?? `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const gifUrl = buildGifUrl(variable, start, end, bbox, taskId);
  const tsUrl  = buildTsUrl(variable, start, end, bbox);

  // Nota: el manejo de progress indicator queda a cargo del llamador
  // (createProgressIndicator / updateProgressIndicator / removeProgressIndicator)

  const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);

  const gifData = await gifResp.json() as GifResponse & { error?: string };
  const tsData  = await tsResp.json() as TimeseriesResponse & { error?: string };

  return { gifData, tsData: tsResp.ok ? tsData : null };
}

/**
 * Obtiene GIF y serie temporal para un panel específico (modo comparativa).
 * Incluye SSE de progreso y manejo de errores.
 *
 * @returns Objeto con gifData y tsData (puede ser null si la serie falla)
 */
export async function fetchGifAndSeriesForPanel(
  options: FetchGifAndSeriesOptions,
): Promise<FetchGifAndSeriesResult> {
  // Phase A: usa la misma implementación que fetchGifAndSeries
  // (las diferencias entre modo normal y comparativa están en main.ts,
  // no en el fetching en sí)
  return fetchGifAndSeries(options);
}

// ---------------------------------------------------------------------------
// Riesgo de inundación por municipio
// ---------------------------------------------------------------------------

export interface FetchFloodRiskOptions {
  municipio: string;
}

/**
 * Obtiene el mapa de riesgo de inundación para un municipio.
 *
 * @returns FloodRiskResponse con mapUrl y bbox
 * @throws Error si la respuesta no es OK
 */
export async function fetchFloodRisk(options: FetchFloodRiskOptions): Promise<FloodRiskResponse & { error?: string }> {
  const resp = await fetch(`/api/flood-risk-municipio?muni=${encodeURIComponent(options.municipio)}`);
  const data = await resp.json() as FloodRiskResponse & { error?: string };

  if (!resp.ok) {
    throw new Error(data.error ?? 'Error generando mapa de riesgo por municipio.');
  }

  return data;
}

// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------

export interface FetchLocalStationLevelOptions {
  stationId: 'SPTTB' | 'BDCTB';
  start: string;
  end: string;
}

/**
 * Obtiene la serie temporal de nivel para una estación local.
 *
 * @returns StationResponse con station, dates y level_m
 */
export async function fetchLocalStationLevel(
  options: FetchLocalStationLevelOptions,
): Promise<StationResponse & { error?: string }> {
  const url = `/api/local-station-level-range?station=${encodeURIComponent(options.stationId)}`
    + `&start=${encodeURIComponent(options.start)}`
    + `&end=${encodeURIComponent(options.end)}`;

  const resp = await fetch(url);
  const data = await resp.json() as StationResponse & { error?: string };

  if (!resp.ok) {
    throw new Error(data.error ?? 'Error cargando serie de nivel de estación local.');
  }

  return data;
}

// ---------------------------------------------------------------------------
// Helpers para extraer datos de respuestas
// ---------------------------------------------------------------------------

/**
 * Extrae los valores de una respuesta de serie temporal según la variable.
 * Compatible con la lógica original de main.ts.
 */
export function extractTimeseriesValues(
  tsData: TimeseriesResponse,
  variable: string,
): { dates: string[]; values: number[] } | null {
  const dataKey = VARIABLE_DATA_KEY[variable as keyof typeof VARIABLE_DATA_KEY] as keyof TimeseriesResponse;
  const values = tsData[dataKey] as number[] | undefined;
  if (!tsData.dates || !values) return null;
  return { dates: tsData.dates, values };
}

// ---------------------------------------------------------------------------
// Utils para construir URLs de descarga (futuro — Phase B-C)
// ---------------------------------------------------------------------------

/** Construye la URL de descarga directa para un archivo en el backend. */
export function buildDownloadUrl(endpoint: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `${endpoint}?${searchParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Export bundle
// ---------------------------------------------------------------------------

/** Mapa de series temporales por variable: { [variableKey]: { dates, values } } */
export type SeriesDataMap = Partial<Record<VariableKey, SeriesData | undefined>>;

export interface ExportBundleOptions {
  gifPaths: string[];
  seriesDataA: SeriesDataMap;
  seriesDataB: SeriesDataMap | null;
  bbox: BBox;
  panel: 'A' | 'B';
}

/**
 * Envía los datos de serie al backend y devuelve el ZIP.
 *
 * @returns Blob con el ZIP del servidor (contiene timeseries.csv, GIFs, metadata.json)
 */
export async function exportBundle(options: ExportBundleOptions): Promise<Blob> {
  const { gifPaths, seriesDataA, seriesDataB, bbox, panel } = options;

  // Construir seriesData con el formato que espera ExportRequestSchema
  const allDates: string[] = [];
  const allVariables: Record<string, (number | null)[]> = {};

  // Recopilar todas las fechas y valores de panel A
  for (const [key, data] of Object.entries(seriesDataA)) {
    if (!data) continue;
    if (allDates.length === 0) {
      allDates.push(...data.dates);
    }
    allVariables[key] = [...data.values];
  }

  // Agregar datos del panel B si existe
  if (seriesDataB) {
    for (const [key, data] of Object.entries(seriesDataB)) {
      if (!data) continue;
      if (!(key in allVariables)) {
        // Nueva variable solo en B — completar A con nulls
        allVariables[key] = new Array(allDates.length).fill(null);
      }
      allVariables[key]!.push(...data.values);
    }
  }

  const variableKeys = Object.keys(allVariables);

  const payload = {
    gifPaths,
    panel,
    seriesData: {
      dates: allDates,
      variables: allVariables,
    },
    bbox,
    metadata: {
      variableKeys,
      panel,
    },
  };

  const resp = await fetch('/api/export/bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let errorMsg = 'Error exporting bundle';
    try {
      const errData = await resp.json();
      errorMsg = errData.error ?? errorMsg;
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  return resp.blob();
}

// ---------------------------------------------------------------------------
// PDF Report Export
// ---------------------------------------------------------------------------

export interface ExportPdfReportOptions {
  chartBlob: string;
  gifPath: string;
  seriesData: { dates: string[]; variables: Record<string, (number | null)[]> };
  bbox: [number, number, number, number];
  metadata: { variableKeys: string[]; panel: string };
  report_type?: string;
}

export async function exportPdfReport(options: ExportPdfReportOptions): Promise<Blob> {
  const {
    chartBlob,
    gifPath,
    seriesData,
    bbox,
    metadata,
    report_type = 'summary',
  } = options;

  const payload = {
    chart_blob: chartBlob,
    gif_path: gifPath,
    series_data: seriesData,
    bbox,
    metadata,
    report_type,
  };

  const resp = await fetch('/api/export/pdf-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    let errorMsg = 'Error generating PDF report';
    try {
      const errData = await resp.json();
      errorMsg = errData.error ?? errorMsg;
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  return resp.blob();
}

// ---------------------------------------------------------------------------
// Client-side ZIP assembly
// ---------------------------------------------------------------------------

/** Genera timestamp para nombre de archivo. */
function exportTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}`;
}

/** Dispara descarga de un Blob en el navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Combina el ZIP del servidor con el PNG del chart y dispara la descarga.
 *
 * @param pngBlob   - PNG del chart generado por plotChartAsPng()
 * @param zipBlob   - ZIP devuelto por exportBundle() (contiene timeseries.csv, GIFs, metadata.json)
 */
export async function buildExportBundleZip(
  pngBlob: Blob,
  zipBlob: Blob,
): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const timestamp = exportTimestamp();

  // Cargar ZIP del servidor
  const serverZip = await JSZip.loadAsync(zipBlob, { base64: false });

  // Crear ZIP final
  const zip = new JSZip();

  // Agregar PNG del chart como chart.png
  zip.file('chart.png', pngBlob);

  // Copiar todos los archivos del ZIP del servidor
  const serverFiles = await serverZip.files;
  for (const [filename, file] of Object.entries(serverFiles)) {
    if (!file.dir) {
      const content = await file.async('uint8array');
      zip.file(filename, content);
    }
  }

  const finalZip = await zip.generateAsync({ type: 'blob' });
  downloadBlob(finalZip, `analysis_export_${timestamp}.zip`);
}