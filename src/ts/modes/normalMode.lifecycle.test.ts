import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as mapState from '../state/mapState.js';
import { clearNormalMode, initNormalMode, requestGifAndSeries } from './normalMode.js';

const doubles = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  closeWarning: vi.fn(),
  streams: [] as {
    message: (progress: number, text: string) => void;
    close: ReturnType<typeof vi.fn>;
  }[],
  players: [] as { dispose: ReturnType<typeof vi.fn>; url: string }[],
  loads: new Map<string, Promise<void>>(),
  frameCount: 2,
}));
vi.mock('../apiClient.js', () => ({
  fetchGifAndSeries: doubles.fetch,
  extractTimeseriesValues: vi.fn(() => null),
  createProgressEventSource: vi.fn((_task, message) => {
    const stream = { message, close: vi.fn(), readyState: 1 };
    doubles.streams.push(stream);
    return stream;
  }),
}));
vi.mock('../map/overlays.js', () => ({
  switchColorbar: vi.fn(),
  removeActiveOverlay: vi.fn(),
  setActiveOverlay: vi.fn(),
}));
vi.mock('../ui/progress.js', () => ({
  createProgressIndicator: vi.fn(),
  updateProgressIndicator: doubles.update,
  removeProgressIndicator: doubles.remove,
  showWarningModal: vi.fn(),
  closeWarningModal: doubles.closeWarning,
}));
vi.mock('../ui/chart.js', () => ({ plotAllSelectedSeries: vi.fn() }));
vi.mock('../ui/icons.js', () => ({ setLucideIcon: vi.fn() }));
vi.mock('../ui/gifPlayer.js', () => ({
  GifPlayer: class {
    dispose = vi.fn();
    url = '';
    frameCount = doubles.frameCount;
    constructor() {
      doubles.players.push(this);
    }
    async load(url: string) {
      await doubles.loads.get(url);
      this.url = url;
    }
    getFrameUrl() {
      return this.url;
    }
  },
  SoloPlayer: class {
    start = vi.fn();
    stop = vi.fn();
    isPlaying = true;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing fixture item ${index}`);
  return item;
}

function payload(path: string, dates: string[] = []) {
  return {
    gifData: { gifUrl: path, bbox: [-92, 17, -91, 18], dates },
    tsData: null,
  };
}
function request() {
  return requestGifAndSeries('ndvi', '2020-01-01', '2020-12-31', [-92, 17, -91, 18]);
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.players.length = 0;
  doubles.streams.length = 0;
  doubles.loads.clear();
  doubles.frameCount = 2;
  mapState.setCompareModeActive(false);
  vi.stubGlobal('L', {
    latLng: vi.fn(),
    latLngBounds: vi.fn(),
    imageOverlay: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), setUrl: vi.fn() })),
  });
  initNormalMode({
    map: { fitBounds: vi.fn() } as unknown as L.Map,
    chartDiv: null,
    playerControlsDiv: null,
    playerSlider: null,
    playerFrameLabel: null,
    playerPlayIcon: null,
    playerSpeedSelect: null,
  });
  clearNormalMode();
});
afterEach(() => {
  clearNormalMode();
  vi.unstubAllGlobals();
});

it('labels date-only API frames by their UTC season and year', async () => {
  doubles.frameCount = 6;
  doubles.fetch.mockResolvedValue(
    payload('/calendar.gif', [
      '2020-01-01',
      '2020-02-29',
      '2020-03-01',
      '2020-06-01',
      '2020-09-01',
      '2020-12-01',
    ])
  );
  expect(await request()).toEqual({ success: true });
  expect(mapState.getFrameDateLabels()).toEqual([
    { year: 2020, season: 'invierno', label: 'Invierno 2020' },
    { year: 2020, season: 'invierno', label: 'Invierno 2020' },
    { year: 2020, season: 'primavera', label: 'Primavera 2020' },
    { year: 2020, season: 'verano', label: 'Verano 2020' },
    { year: 2020, season: 'otono', label: 'Otoño 2020' },
    { year: 2020, season: 'invierno', label: 'Invierno 2020' },
  ]);
  expect(mapState.getActiveGifPathA()).toBe('/calendar.gif');
  expect(at(doubles.streams, 0).close).toHaveBeenCalledOnce();
});

it('keeps valid generation, player replacement and own SSE closure', async () => {
  doubles.fetch.mockResolvedValue(payload('/first.gif'));
  expect(await request()).toEqual({ success: true });
  const first = at(doubles.players, 0);
  doubles.fetch.mockResolvedValue(payload('/second.gif'));
  expect(await request()).toEqual({ success: true });
  expect(first.dispose).toHaveBeenCalledOnce();
  expect(mapState.getActiveGifPathA()).toBe('/second.gif');
  expect(doubles.streams.every(stream => stream.close.mock.calls.length === 1)).toBe(
    true
  );
});

it('prevents an old response and its SSE/finally callbacks from replacing or clearing a newer request', async () => {
  const old = deferred<ReturnType<typeof payload>>();
  doubles.fetch
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(payload('/new.gif'));
  const earlier = request();
  expect(await request()).toEqual({ success: true });
  doubles.update.mockClear();
  doubles.remove.mockClear();
  doubles.closeWarning.mockClear();
  at(doubles.streams, 0).message(-1, 'old error');
  old.resolve(payload('/old.gif'));
  const result = await earlier;
  expect(result.success).toBe(false);
  expect(mapState.getActiveGifPathA()).toBe('/new.gif');
  expect(doubles.players).toHaveLength(1);
  expect(doubles.update).not.toHaveBeenCalled();
  expect(doubles.remove).not.toHaveBeenCalled();
  expect(doubles.closeWarning).not.toHaveBeenCalled();
});

it('disposes an obsolete decoded candidate without replacing the new player', async () => {
  const decode = deferred<void>();
  doubles.loads.set('/slow.gif', decode.promise);
  doubles.fetch
    .mockResolvedValueOnce(payload('/slow.gif'))
    .mockResolvedValueOnce(payload('/new.gif'));
  const earlier = request();
  await vi.waitFor(() => expect(doubles.players).toHaveLength(1));
  expect(await request()).toEqual({ success: true });
  decode.resolve();
  expect((await earlier).success).toBe(false);
  expect(at(doubles.players, 0).dispose).toHaveBeenCalledOnce();
  expect(mapState.getActiveGifPathA()).toBe('/new.gif');
});

it('does not republish a response after clearNormalMode', async () => {
  const pending = deferred<ReturnType<typeof payload>>();
  doubles.fetch.mockReturnValueOnce(pending.promise);
  const loading = request();
  clearNormalMode();
  pending.resolve(payload('/cleared.gif'));
  expect((await loading).success).toBe(false);
  expect(mapState.getGifPlayerA()).toBeNull();
  expect(mapState.getActiveGifPathA()).toBeNull();
});

it('preserves the owned animation and error contract when replacement decoding fails', async () => {
  doubles.fetch
    .mockResolvedValueOnce(payload('/owned.gif'))
    .mockResolvedValueOnce(payload('/broken.gif'));
  expect((await request()).success).toBe(true);
  const reject = deferred<void>();
  doubles.loads.set('/broken.gif', reject.promise);
  const loading = request();
  await vi.waitFor(() => expect(doubles.players).toHaveLength(2));
  reject.reject(new Error('decode failed'));
  expect(await loading).toEqual({
    success: false,
    error: 'Error de red al generar animación / serie temporal.',
  });
  expect(mapState.getActiveGifPathA()).toBe('/owned.gif');
  expect(at(doubles.players, 0).dispose).not.toHaveBeenCalled();
  expect(at(doubles.players, 1).dispose).toHaveBeenCalledOnce();
});
