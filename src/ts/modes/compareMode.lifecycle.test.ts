import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as mapState from '../state/mapState.js';
import {
  cleanupComparePanels,
  clearPanelA,
  clearPanelB,
  initCompareMode,
  requestGifAndSeriesForPanel,
} from './compareMode.js';
import type { CompareModeDomRefs } from './compareMode.js';

const doubles = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  streams: [] as {
    message: (progress: number, text: string) => void;
    close: ReturnType<typeof vi.fn>;
  }[],
  players: [] as { url: string; dispose: ReturnType<typeof vi.fn> }[],
  loads: new Map<string, Promise<void>>(),
}));
vi.mock('../apiClient.js', () => ({
  fetchGifAndSeriesForPanel: doubles.fetch,
  fetchGifAndSeries: vi.fn(),
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
  municipalFloodOverlays: new Map(),
}));
vi.mock('../ui/progress.js', () => ({
  createProgressIndicator: vi.fn(),
  updateProgressIndicator: doubles.update,
  removeProgressIndicator: doubles.remove,
  showWarningModal: vi.fn(),
  showErrorModal: doubles.error,
  closeWarningModal: doubles.warning,
}));
vi.mock('../ui/chart.js', () => ({ plotAllSelectedSeries: vi.fn() }));
vi.mock('../ui/icons.js', () => ({ setLucideIcon: vi.fn(), initLucideIcons: vi.fn() }));
vi.mock('../ui/gifPlayer.js', () => ({
  GifPlayer: class {
    url = '';
    frameCount = 2;
    dispose = vi.fn();
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
  SyncPlayer: class {
    start = vi.fn();
    stop = vi.fn();
    isPlaying = true;
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Missing fixture');
  return item;
}
function payload(path: string) {
  return {
    gifData: { gifUrl: path, bbox: [-92, 17, -91, 18], dates: [] },
    tsData: null,
  };
}
function request(panel: 'A' | 'B') {
  return requestGifAndSeriesForPanel(
    panel,
    'ndvi',
    '2020-01-01',
    '2020-12-31',
    [-92, 17, -91, 18]
  );
}
function path(panel: 'A' | 'B') {
  return panel === 'A' ? mapState.getActiveGifPathA() : mapState.getActiveGifPathB();
}
function map() {
  return {
    fitBounds: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    setView: vi.fn(),
    getCenter: vi.fn(),
    getZoom: vi.fn(),
  };
}
let mapB: ReturnType<typeof map>;

beforeEach(() => {
  vi.useFakeTimers();
  doubles.loads.clear();
  doubles.players.length = 0;
  doubles.streams.length = 0;
  vi.stubGlobal('L', {
    latLng: vi.fn(),
    latLngBounds: vi.fn(),
    imageOverlay: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), setUrl: vi.fn() })),
  });
  const refs: CompareModeDomRefs = {
    map: map() as unknown as L.Map,
    stationMarkersMap: [],
    stationMarkersMapB: [],
    playerControlsDiv: null,
    playerSlider: null,
    playerFrameLabel: null,
    playerPlayIcon: null,
    playerSpeedSelect: null,
    ndviChartDiv: null,
    chartBDiv: null,
    compareControlsA: null,
    compareModeHint: null,
    chartBContainer: null,
    compareVarASelect: null,
    compareYearASelect: null,
    compareSeasonASelect: null,
    btnGenerateA: null,
    compareVarBSelect: null,
    compareYearBSelect: null,
    compareSeasonBSelect: null,
    btnGenerateB: null,
    selStationHidroA: null,
    selStationClimaA: null,
    selStationHidroB: null,
    selStationClimaB: null,
  };
  mapB = map();
  mapState.setMapB(mapB as unknown as L.Map);
  mapState.setCompareModeActive(true);
  initCompareMode(refs);
  cleanupComparePanels();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanupComparePanels();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('preserves serial A/B generation and synchronized-player setup', async () => {
  doubles.fetch
    .mockResolvedValueOnce(payload('/a.gif'))
    .mockResolvedValueOnce(payload('/b.gif'));
  await request('A');
  await request('B');
  expect(path('A')).toBe('/a.gif');
  expect(path('B')).toBe('/b.gif');
  expect(mapState.getSyncPlayer()).not.toBeNull();
  expect(doubles.error).not.toHaveBeenCalled();
});

it.each(['A', 'B'] as const)(
  'keeps valid %s generation and discards reverse-order older response',
  async panel => {
    const old = deferred<ReturnType<typeof payload>>();
    doubles.fetch
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(payload('/new.gif'));
    const earlier = request(panel);
    await request(panel);
    old.resolve(payload('/old.gif'));
    await earlier;
    expect(path(panel)).toBe('/new.gif');
    expect(doubles.players).toHaveLength(1);
    expect(doubles.streams.every(stream => stream.close.mock.calls.length === 1)).toBe(
      true
    );
  }
);

it.each(['A', 'B'] as const)(
  'disposes stale decoded %s candidate without replacing current frames',
  async panel => {
    const decode = deferred<void>();
    doubles.loads.set('/slow.gif', decode.promise);
    doubles.fetch
      .mockResolvedValueOnce(payload('/slow.gif'))
      .mockResolvedValueOnce(payload('/new.gif'));
    const earlier = request(panel);
    await vi.waitFor(() => expect(doubles.players).toHaveLength(1));
    await request(panel);
    decode.resolve();
    await earlier;
    expect(path(panel)).toBe('/new.gif');
    expect(at(doubles.players, 0).dispose).toHaveBeenCalledOnce();
  }
);

it('lets A and B finish independently while only the latest request controls shared progress', async () => {
  const a = deferred<ReturnType<typeof payload>>();
  const b = deferred<ReturnType<typeof payload>>();
  doubles.fetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const left = request('A');
  const right = request('B');
  doubles.update.mockClear();
  doubles.remove.mockClear();
  doubles.warning.mockClear();
  at(doubles.streams, 0).message(-1, 'old UI error');
  expect(doubles.update).not.toHaveBeenCalled();
  expect(doubles.remove).not.toHaveBeenCalled();
  expect(doubles.warning).not.toHaveBeenCalled();
  a.resolve(payload('/a.gif'));
  await left;
  expect(path('A')).toBe('/a.gif');
  expect(doubles.remove).not.toHaveBeenCalled();
  b.resolve(payload('/b.gif'));
  await right;
  expect(path('B')).toBe('/b.gif');
  expect(mapState.getSyncPlayer()).not.toBeNull();
});

it.each(['A', 'B'] as const)(
  'does not publish pending %s response after clearing the panel',
  async panel => {
    const pending = deferred<ReturnType<typeof payload>>();
    doubles.fetch.mockReturnValueOnce(pending.promise);
    const loading = request(panel);
    (panel === 'A' ? clearPanelA : clearPanelB)();
    pending.resolve(payload('/cleared.gif'));
    await loading;
    expect(path(panel)).toBeNull();
  }
);

it('clears active A frames and stops their solo playback', async () => {
  doubles.fetch.mockResolvedValue(payload('/a.gif'));
  await request('A');
  const solo = mapState.getSoloPlayer();
  expect(solo).not.toBeNull();
  const stop = vi.spyOn(solo!, 'stop');
  clearPanelA();
  expect(path('A')).toBeNull();
  expect(at(doubles.players, 0).dispose).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(mapState.getSoloPlayer()).toBeNull();
});

it('does not apply a late B view-sync timer after cleanup', async () => {
  doubles.fetch.mockResolvedValue(payload('/b.gif'));
  await request('B');
  cleanupComparePanels();
  mapB.setView.mockClear();
  await vi.advanceTimersByTimeAsync(100);
  expect(mapB.setView).not.toHaveBeenCalled();
});
