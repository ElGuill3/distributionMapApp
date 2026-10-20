const HORIZONS = [1, 3, 7] as const;
const DISCLAIMER =
  'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.';
const MAX_POLL_MS = 30 * 60 * 1000;
const OFFICIAL_URL =
  'https://tabasco.gob.mx/ceipc/acciones/semaforo-hidrometeorologico';

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
    return {
      forecast: parseBdctbForecast(value['forecast']),
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

let generation = 0;
let timer: number | undefined;
let request: AbortController | undefined;
let activeDialog: HTMLDialogElement | undefined;
let deadline = 0;
let waiting = false;
function stop(): void {
  window.clearTimeout(timer);
  timer = undefined;
  request?.abort();
  request = undefined;
}
export function bdctbForecastAction(stationId: string, isHydrometric: boolean): string {
  return stationId.replace(/_(hidro|clima)$/, '') === 'BDCTB' && isHydrometric
    ? '<button type="button" class="station-popup-btn station-forecast-link">Ver pronóstico del río</button>'
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
    <div class="forecast-dialog-header"><div><p class="forecast-eyebrow">Usumacinta · BDCTB</p><h2 id="bdctb-forecast-title">Pronóstico de Boca del Cerro</h2></div><button type="button" class="forecast-close" aria-label="Cerrar pronóstico">&times;</button></div>
    <div class="forecast-state" role="status" aria-live="polite"></div>
    <div class="forecast-content" hidden></div>`;
  dialog
    .querySelector('.forecast-close')
    ?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    generation++;
    stop();
    waiting = false;
    activeDialog = undefined;
  });
  document.body.append(dialog);
  return dialog;
}
function chart(forecast: BdctbForecast): SVGSVGElement {
  const points = HORIZONS.map(h => forecast.forecasts[`h${h}`]);
  const min = Math.min(19.21, ...points.map(p => p.q10)) - 0.4;
  const max = Math.max(19.21, ...points.map(p => p.q90)) + 0.6;
  const y = (value: number) => 210 - ((value - min) / (max - min)) * 170;
  const x = (i: number) => 55 + ((HORIZONS[i]! - 1) / 6) * 400;
  const coordinates = (key: 'q10' | 'q50' | 'q90') =>
    points.map((p, i) => `${x(i)},${y(p[key])}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 510 250');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    'Nivel modelado: mediana q50 e intervalo q10–q90 frente al NAMO 19.21 m'
  );
  // Only validated finite numeric coordinates enter SVG markup; remote text uses textContent.
  svg.innerHTML = `<title>Nivel modelado e intervalo nominal del 80%</title>
    <polygon class="forecast-band" points="${[...coordinates('q10'), ...coordinates('q90').reverse()].join(' ')}" />
    <polyline class="forecast-median" points="${coordinates('q50').join(' ')}" />
    <line class="forecast-namo" x1="40" x2="480" y1="${y(19.21)}" y2="${y(19.21)}" />
    <text x="45" y="${y(19.21) - 8}">NAMO 19.21 m</text>
    <text x="5" y="${y(min) - 5}">${min.toFixed(1)} m</text>
    ${HORIZONS.map((h, i) => `<circle class="forecast-dot" cx="${x(i)}" cy="${y(points[i]!.q50)}" r="4" /><text text-anchor="middle" x="${x(i)}" y="237">h${h}</text>`).join('')}`;
  return svg;
}
function render(dialog: HTMLDialogElement, response: ForecastResponse): void {
  const f = response.forecast;
  const content = dialog.querySelector<HTMLElement>('.forecast-content')!;
  const fragment = document.createDocumentFragment();
  const paragraph = (text: string, className = '') => {
    const node = document.createElement('p');
    node.className = className;
    node.textContent = text;
    fragment.append(node);
  };
  const issueDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(f.issue_time));
  paragraph(
    response.source === 'cache'
      ? `Pronóstico guardado, emitido el ${issueDate} (sin conexión)`
      : `Emitido el ${issueDate} (11:00, Ciudad de México)`,
    'forecast-meta'
  );
  paragraph(
    f.mode === 'live' && f.live_input
      ? `Con nivel IPCET del ${f.live_input.date} (06:00)`
      : 'Sin nivel IPCET reciente: pronóstico solo con GloFAS, menos preciso'
  );
  fragment.append(chart(f));
  paragraph(
    'Línea: mediana (q50) · Banda: intervalo q10–q90 (80% nominal, no es garantía).'
  );
  const table = document.createElement('table');
  table.className = 'forecast-table';
  const caption = table.createCaption();
  caption.textContent = 'Nivel modelado y distancia al NAMO';
  const body = table.createTBody();
  HORIZONS.forEach((h, index) => {
    const p = f.forecasts[`h${h}`];
    const distance = p.distance_to_namo_m;
    const row = body.insertRow();
    row.insertCell().textContent = `${['Mañana', 'En 3 días', 'En 7 días'][index]}: ${p.q50.toFixed(1)} m (${p.q10.toFixed(1)}–${p.q90.toFixed(1)}) · ${distance > 0 ? `${distance.toFixed(1)} m sobre el NAMO` : `a ${Math.abs(distance).toFixed(1)} m del NAMO`}`;
    row.insertCell().textContent = p.target_date;
  });
  fragment.append(table);
  paragraph(f.disclaimer, 'forecast-warning');
  const link = document.createElement('a');
  link.href = OFFICIAL_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Consultar el semáforo oficial de IPCET';
  fragment.append(link);
  content.replaceChildren(fragment);
  content.hidden = false;
  dialog.querySelector('.forecast-state')!.textContent = response.updating
    ? 'Actualizando con el nivel de IPCET de hoy…'
    : '';
}
function schedule(dialog: HTMLDialogElement, owner: number): void {
  if (
    !waiting ||
    owner !== generation ||
    !dialog.open ||
    document.hidden ||
    Date.now() >= deadline
  )
    return;
  timer = window.setTimeout(
    () => {
      void refresh(dialog, owner);
    },
    Math.min(60000, deadline - Date.now())
  );
}
async function refresh(dialog: HTMLDialogElement, owner: number): Promise<void> {
  if (owner !== generation || !dialog.open || document.hidden) return;
  request = new AbortController();
  const controller = request;
  try {
    const result = await fetchBdctbForecast(
      fetch,
      5000,
      '/api/v1/forecasts/bdctb',
      controller.signal
    );
    if (owner !== generation || !dialog.open) return;
    render(dialog, result);
    waiting = result.updating;
  } catch (error) {
    if (owner !== generation || !dialog.open) return;
    dialog.querySelector('.forecast-state')!.textContent = dialog.querySelector('svg')
      ? 'Se conserva el último pronóstico válido; no se pudo actualizar.'
      : error instanceof ForecastRequestError
        ? error.message
        : 'No se pudo mostrar el pronóstico.';
  } finally {
    if (request === controller) request = undefined;
    schedule(dialog, owner);
  }
}
export async function openBdctbForecastDialog(): Promise<void> {
  stop();
  const dialog = ensureDialog();
  activeDialog = dialog;
  const owner = ++generation;
  deadline = Date.now() + MAX_POLL_MS;
  waiting = false;
  dialog.querySelector('.forecast-state')!.textContent = 'Consultando el pronóstico…';
  const content = dialog.querySelector<HTMLElement>('.forecast-content')!;
  content.replaceChildren();
  content.hidden = true;
  if (!dialog.open) dialog.showModal();
  await refresh(dialog, owner);
}
document.addEventListener('visibilitychange', () => {
  if (!activeDialog?.open) return;
  stop();
  const owner = ++generation;
  // Hiding the tab aborts any request, so reload on return if nothing is shown yet.
  const empty = activeDialog.querySelector<HTMLElement>('.forecast-content')!.hidden;
  if (!document.hidden && (empty || (waiting && Date.now() < deadline)))
    void refresh(activeDialog, owner);
});
