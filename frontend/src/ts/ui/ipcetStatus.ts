const STATES = [
  'NORMAL',
  'A LA BAJA',
  'BAJO',
  'PREVENCION',
  'ALERTA',
  'EMERGENCIA',
] as const;
type OfficialState = (typeof STATES)[number];
const STATE_CLASSES: Record<OfficialState, string> = {
  NORMAL: 'ipcet-state-normal',
  'A LA BAJA': 'ipcet-state-a-la-baja',
  BAJO: 'ipcet-state-bajo',
  PREVENCION: 'ipcet-state-prevencion',
  ALERTA: 'ipcet-state-alerta',
  EMERGENCIA: 'ipcet-state-emergencia',
};
interface Station {
  code: string | null;
  river: string;
  station: string;
  semaforo: OfficialState | null;
  problems: string[];
}
interface Publication {
  schema: 'ipcet-levels/v1';
  table_date: string;
  source_url: string | null;
  stations: Station[];
}
export interface StationStatus extends Station {
  table_date: string;
  source_url: string | null;
}
export const MODEL_TITLE =
  'Pronóstico del modelo: alcanza el NAMO (no es aviso oficial)';
export const STATUS_LEGEND =
  'Color: semáforo oficial IPCET · Anillo punteado: pronóstico del modelo';
const codeFor = (id: string) => id.replace(/_(hidro|clima)$/, '');
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function parse(value: unknown): Publication {
  if (
    !isRecord(value) ||
    value['schema'] !== 'ipcet-levels/v1' ||
    typeof value['table_date'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value['table_date']) ||
    !Number.isFinite(Date.parse(value['table_date'])) ||
    new Date(value['table_date']).toISOString().slice(0, 10) !== value['table_date'] ||
    typeof value['issued_at'] !== 'string' ||
    !Number.isFinite(Date.parse(value['issued_at'])) ||
    typeof value['last_modified'] !== 'string' ||
    (value['source_url'] !== null && typeof value['source_url'] !== 'string') ||
    !['network', 'cache'].includes(String(value['source'])) ||
    !Array.isArray(value['stations'])
  )
    throw new Error('Publicación IPCET inválida');
  for (const row of value['stations']) {
    if (
      !isRecord(row) ||
      (row['code'] !== null &&
        (typeof row['code'] !== 'string' || !/^[A-Z]{5}$/.test(row['code']))) ||
      typeof row['river'] !== 'string' ||
      typeof row['station'] !== 'string' ||
      !Array.isArray(row['problems']) ||
      !row['problems'].every(p => typeof p === 'string') ||
      !['namo', 'namino', 'ayer', 'hoy', 'diff', 'capacity'].every(
        k => row[k] === null || (typeof row[k] === 'number' && Number.isFinite(row[k]))
      )
    )
      throw new Error('Estación IPCET inválida');
  }
  // Unknown official states deliberately have no visual interpretation.
  return value as unknown as Publication;
}
export function stateLabel(state: string): string {
  return state === 'PREVENCION' ? 'PREVENCIÓN' : state;
}
export function tableDate(date: string): string {
  return date.split('-').reverse().join('/');
}
export function safeSource(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
export class IpcetStatus {
  private payload: Publication | undefined;
  private marks = new Set<string>();
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | undefined;
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  stateFor(code: string): StationStatus | null {
    const station = this.payload?.stations.find(s => s.code === codeFor(code));
    return station && this.payload
      ? {
          ...station,
          table_date: this.payload.table_date,
          source_url: this.payload.source_url,
        }
      : null;
  }
  modelMarkFor(code: string): boolean {
    return this.marks.has(codeFor(code));
  }
  setModelMark(code: string, active: boolean): void {
    if (active) this.marks.add(codeFor(code));
    else this.marks.delete(codeFor(code));
    this.notify();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(): void {
    this.listeners.forEach(listener => listener());
  }
  async refresh(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetcher('/api/v1/ipcet/levels', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const payload = parse(await response.json());
      if (controller.signal.aborted) return;
      this.payload = payload;
      this.notify();
    } catch {
      /* Keep the last good official publication on failure. */
    } finally {
      clearTimeout(timeout);
    }
  }
  start(): () => void {
    if (this.interval === undefined) {
      void this.refresh();
      this.interval = setInterval(() => {
        void this.refresh();
      }, 30 * 60000);
    }
    return () => {
      clearInterval(this.interval);
      this.interval = undefined;
    };
  }
}
export const ipcetStatus = new IpcetStatus();
export function applyStationStatus(
  el: HTMLElement,
  id: string,
  name: string,
  store = ipcetStatus
): void {
  for (const className of Object.values(STATE_CLASSES)) el.classList.remove(className);
  el.classList.remove('ipcet-blink');
  const status = store.stateFor(id);
  const state = status?.semaforo;
  const known = state && STATES.includes(state);
  const official = known
    ? `${status.station || name}: ${stateLabel(state)} (IPCET, ${tableDate(status.table_date)})`
    : '';
  if (known) {
    el.classList.add(STATE_CLASSES[state]);
    const blink = ['PREVENCION', 'ALERTA', 'EMERGENCIA'].includes(state);
    el.classList.toggle('ipcet-blink', blink);
  }
  const marked = store.modelMarkFor(id);
  el.classList.toggle('ipcet-model-mark', marked);
  el.querySelector('.ipcet-model-ring')?.remove();
  if (marked) {
    const ring = document.createElement('span');
    ring.className = 'ipcet-model-ring';
    ring.title = MODEL_TITLE;
    ring.setAttribute('aria-hidden', 'true');
    el.append(ring);
  }
  const label = [official, marked ? MODEL_TITLE : ''].filter(Boolean).join(' · ');
  // Leaflet's keyboard-focusable outer marker also needs the accessible label.
  for (const target of [el, el.parentElement].filter(
    (node): node is HTMLElement => !!node
  )) {
    if (label) {
      target.title = label;
      target.setAttribute('aria-label', label);
    } else {
      target.removeAttribute('title');
      target.removeAttribute('aria-label');
    }
  }
}
/** Subscribe only while Leaflet has the marker mounted; reapply after layer toggles. */
export function bindStationStatus(marker: L.Marker, id: string, name: string): void {
  let unsubscribe: (() => void) | undefined;
  const update = () => {
    const el = marker.getElement()?.querySelector<HTMLElement>('.station-icon-hidro');
    if (el) applyStationStatus(el, id, name);
  };
  marker.on('add', () => {
    unsubscribe?.();
    unsubscribe = ipcetStatus.subscribe(update);
    update();
  });
  marker.on('remove', () => {
    unsubscribe?.();
    unsubscribe = undefined;
  });
  if (marker.getElement()) {
    unsubscribe = ipcetStatus.subscribe(update);
    update();
  }
}
