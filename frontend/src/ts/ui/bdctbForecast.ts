import { ipcetStatus } from './ipcetStatus.js';

const HORIZONS = [1, 3, 7] as const;
const DISCLAIMER =
  'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.';

export interface ForecastPoint {
  target_date: string;
  q10: number;
  q50: number;
  q90: number;
  distance_to_namo_m: number;
  namo_m: number;
  data_kind: 'modeled_not_observed';
}
export interface BdctbForecast {
  schema: 'bdctb-forecast/v2';
  station: { code: 'BDCTB'; name: string };
  model_version: string;
  issue_time: string;
  generated_at: string;
  mode: 'live' | 'glofas_only';
  live_input: { date: string; stage_m: number; age_days: number } | null;
  forecasts: Record<'h1' | 'h3' | 'h7', ForecastPoint>;
  disclaimer: string;
}
export interface ForecastResponse {
  forecast: BdctbForecast;
  source: 'network' | 'cache';
  fetched_at: string;
  updating: boolean;
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
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === names.length &&
    names.every(name => Object.prototype.hasOwnProperty.call(value, name))
  );
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) &&
    calendarDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function malformed(): never {
  throw new ForecastRequestError('malformed', 'El pronóstico recibido no es válido.');
}
export function parseBdctbForecast(value: unknown): BdctbForecast {
  if (
    !keys(value, [
      'schema',
      'station',
      'model_version',
      'issue_time',
      'generated_at',
      'mode',
      'live_input',
      'forecasts',
      'disclaimer',
    ])
  )
    malformed();
  if (
    value['schema'] !== 'bdctb-forecast/v2' ||
    !keys(value['station'], ['code', 'name']) ||
    value['station']['code'] !== 'BDCTB' ||
    value['station']['name'] !== 'Boca del Cerro' ||
    typeof value['model_version'] !== 'string' ||
    !value['model_version'].trim() ||
    !timestamp(value['issue_time']) ||
    !timestamp(value['generated_at']) ||
    value['disclaimer'] !== DISCLAIMER ||
    !keys(value['forecasts'], ['h1', 'h3', 'h7'])
  )
    malformed();
  const issue = value['issue_time'] as string;
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(issue));
  if (!local.endsWith('11:00:00')) malformed();
  const issueDate = local.slice(0, 10);
  const live = value['live_input'];
  if (value['mode'] === 'live') {
    if (
      !keys(live, ['date', 'stage_m', 'age_days']) ||
      !calendarDate(live['date']) ||
      !number(live['stage_m']) ||
      !Number.isInteger(live['age_days'])
    )
      malformed();
    const age =
      (Date.parse(`${issueDate}T00:00:00Z`) -
        Date.parse(`${live['date'] as string}T00:00:00Z`)) /
      86400000;
    if (age < 0 || age > 7 || live['age_days'] !== age) malformed();
  } else if (value['mode'] !== 'glofas_only' || live !== null) malformed();
  for (const h of HORIZONS) {
    const point = (value['forecasts'] as Record<string, unknown>)[`h${h}`];
    const target = new Date(`${issueDate}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() + h);
    if (
      !keys(point, [
        'target_date',
        'q10',
        'q50',
        'q90',
        'namo_m',
        'distance_to_namo_m',
        'data_kind',
      ]) ||
      point['target_date'] !== target.toISOString().slice(0, 10) ||
      !number(point['q10']) ||
      !number(point['q50']) ||
      !number(point['q90']) ||
      point['q10'] > point['q50'] ||
      point['q50'] > point['q90'] ||
      point['namo_m'] !== 19.21 ||
      point['data_kind'] !== 'modeled_not_observed' ||
      !number(point['distance_to_namo_m']) ||
      Math.abs(point['distance_to_namo_m'] - (point['q50'] - 19.21)) > 1e-6
    )
      malformed();
  }
  return value as unknown as BdctbForecast;
}
export async function fetchBdctbForecast(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
  endpoint = '/api/v1/forecasts/bdctb',
  signal?: AbortSignal
): Promise<ForecastResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = window.setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new ForecastRequestError(
        response.status === 503 ? 'unavailable' : 'network',
        response.status === 503
          ? 'No hay un pronóstico válido guardado. Intente de nuevo cuando haya conexión.'
          : 'No se pudo consultar el pronóstico.'
      );
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      malformed();
    }
    if (
      !keys(value, ['forecast', 'source', 'fetched_at', 'updating']) ||
      !['network', 'cache'].includes(String(value['source'])) ||
      !timestamp(value['fetched_at']) ||
      typeof value['updating'] !== 'boolean'
    )
      malformed();
    const forecast = parseBdctbForecast(value['forecast']);
    if (!controller.signal.aborted) {
      ipcetStatus.setModelMark(
        forecast.station.code,
        forecast.mode === 'live' &&
          Object.values(forecast.forecasts).some(p => p.q50 >= p.namo_m)
      );
    }
    return {
      forecast,
      source: value['source'] as 'network' | 'cache',
      fetched_at: value['fetched_at'] as string,
      updating: value['updating'] as boolean,
    };
  } catch (error) {
    if (error instanceof ForecastRequestError) throw error;
    if (controller.signal.aborted)
      throw new ForecastRequestError(
        'timeout',
        'La consulta del pronóstico tardó demasiado.'
      );
    throw new ForecastRequestError('network', 'No se pudo consultar el pronóstico.');
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Three compact logical lines; dates use the publication's Mexico City timezone. */
export function formatForecastSummary(
  response: ForecastResponse
): [string, string, string] {
  const f = response.forecast;
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(f.issue_time));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === name)?.value;
  const date = `${part('day')}/${part('month')}`;
  const points = HORIZONS.map(h => f.forecasts[`h${h}`]);
  const closest = Math.min(...points.map(p => p.namo_m - p.q50));
  const namo =
    closest <= 0
      ? 'alcanza el NAMO'
      : closest < 0.05
        ? 'prácticamente en el NAMO'
        : `mín. ${closest.toFixed(1)} m bajo el NAMO`;
  const note = response.updating
    ? 'Actualizando con el nivel de hoy…'
    : f.mode === 'glofas_only'
      ? 'Sin nivel en vivo: puede sobrestimar'
      : response.source === 'cache'
        ? `Copia guardada del ${date}`
        : '';
  return [
    `Pronóstico del modelo · emitido ${date} ${part('hour')}:${part('minute')}`,
    points
      .map((p, i) => `${['Mañana', '3 días', '7 días'][i]} ${p.q50.toFixed(1)} m`)
      .join(' · ') + ` · ${namo}`,
    `Modelado, no es aviso oficial${note ? ` · ${note}` : ''}`,
  ];
}
