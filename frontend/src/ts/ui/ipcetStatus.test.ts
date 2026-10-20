import { afterEach, expect, it, vi } from 'vitest';
import { IpcetStatus, applyStationStatus, MODEL_TITLE } from './ipcetStatus.js';

const publication = (semaforo: string | null = 'PREVENCION') => ({
  schema: 'ipcet-levels/v1',
  table_date: '2026-10-14',
  issued_at: '2026-10-14T12:00:00Z',
  last_modified: '',
  source_url: 'https://example.org/ipcet',
  source: 'network',
  stations: [
    {
      code: 'ABCDE',
      river: 'Río',
      station: 'Estación',
      namo: 10,
      namino: null,
      ayer: 9,
      hoy: 10,
      diff: 1,
      capacity: null,
      semaforo,
      problems: [],
    },
  ],
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([
  ['NORMAL', 'normal', false, 'NORMAL'],
  ['A LA BAJA', 'a-la-baja', false, 'A LA BAJA'],
  ['BAJO', 'bajo', false, 'BAJO'],
  ['PREVENCION', 'prevencion', true, 'PREVENCIÓN'],
  ['ALERTA', 'alerta', true, 'ALERTA'],
  ['EMERGENCIA', 'emergencia', true, 'EMERGENCIA'],
  [null, null, false, null],
  ['UNKNOWN', null, false, null],
])('maps %s to accessible official styling', async (state, suffix, blink, label) => {
  const store = new IpcetStatus(
    vi.fn().mockResolvedValue(new Response(JSON.stringify(publication(state))))
  );
  await store.refresh();
  const el = document.createElement('div');
  el.className = 'station-icon station-icon-hidro';
  applyStationStatus(el, 'ABCDE_hidro', 'Estación', store);
  expect(el.classList.contains('ipcet-blink')).toBe(blink);
  expect([...el.classList].filter(c => c.startsWith('ipcet-state-'))).toEqual(
    suffix ? [`ipcet-state-${suffix}`] : []
  );
  expect(el.getAttribute('title')).toBe(
    label ? `Estación: ${label} (IPCET, 14/10/2026)` : null
  );
  expect(el.getAttribute('aria-label')).toBe(el.getAttribute('title'));
});
it('fetches only levels at startup, polls every 30 minutes, and retains last good on timeout', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(publication())))
    .mockImplementation(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('abort')))
        )
    );
  const store = new IpcetStatus(fetcher);
  const stop = store.start();
  await vi.advanceTimersByTimeAsync(0);
  const good = store.stateFor('ABCDE');
  expect(good?.semaforo).toBe('PREVENCION');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/ipcet/levels');
  await vi.advanceTimersByTimeAsync(30 * 60000 + 5000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
  expect(store.stateFor('ABCDE')).toEqual(good);
  stop();
});
it('updates existing markers and keeps the model cue separate from official state', async () => {
  const store = new IpcetStatus(
    vi.fn().mockResolvedValue(new Response(JSON.stringify(publication())))
  );
  const el = document.createElement('div');
  el.className = 'station-icon-hidro';
  const unsubscribe = store.subscribe(() =>
    applyStationStatus(el, 'ABCDE', 'Estación', store)
  );
  await store.refresh();
  store.setModelMark('ABCDE', true);
  expect(el.classList.contains('ipcet-model-mark')).toBe(true);
  expect(el.querySelector('.ipcet-model-ring')?.getAttribute('title')).toBe(
    MODEL_TITLE
  );
  expect(el.getAttribute('aria-label')).toContain(MODEL_TITLE);
  expect(el.classList.contains('ipcet-state-prevencion')).toBe(true);
  store.setModelMark('ABCDE', false);
  expect(el.querySelector('.ipcet-model-ring')).toBeNull();
  expect(el.getAttribute('aria-label')).not.toContain(MODEL_TITLE);
  unsubscribe();
});
it('imports the forecast and status modules without fetching any forecast', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  vi.resetModules();
  await import('./bdctbForecast.js');
  const { ipcetStatus } = await import('./ipcetStatus.js');
  expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
