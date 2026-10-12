import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as mapState from '../state/mapState.js';
import { initInundacionesMode, exitInundacionesMode } from './inundacionesMode.js';
import { DEFAULT_RUNTIME_LIMITS, RUNTIME_LIMITS } from '../utils/processingLimits.js';

const doubles = vi.hoisted(() => ({
  error: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../ui/progress.js', () => ({
  showErrorModal: doubles.error,
  createProgressIndicator: doubles.create,
  updateProgressIndicator: doubles.update,
  removeProgressIndicator: doubles.remove,
}));
const fetchMock = vi.fn();
const map = { removeLayer: vi.fn(), removeControl: vi.fn(), fitBounds: vi.fn() };
let button: HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(RUNTIME_LIMITS, DEFAULT_RUNTIME_LIMITS);
  document.body.innerHTML = `<div id="map"></div>
    <select id="inund-satellite"><option>sentinel1</option><option>landsat</option></select>
    <input id="inund-start" value="2020-01-01">
    <input id="inund-end" value="2020-12-31">
    <select id="inund-threshold-mode"><option>auto</option></select>
    <input id="inund-threshold-value" value="-18">
    <button id="inund-btn-process">Process</button>`;
  button = document.querySelector<HTMLButtonElement>('#inund-btn-process')!;
  mapState.setBbox([-92, 17, -91, 18]);
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'fixture' }) });
  vi.stubGlobal('fetch', fetchMock);
  initInundacionesMode({
    map: map as unknown as L.Map,
    toggleInundacionesModeButton: null,
    inundacionesModeHint: null,
  });
});
afterEach(() => {
  exitInundacionesMode();
  Object.assign(RUNTIME_LIMITS, DEFAULT_RUNTIME_LIMITS);
  vi.unstubAllGlobals();
});

it.each(['sentinel1', 'landsat'])(
  'rejects configured flood span for %s before changing map or button',
  async satellite => {
    document.querySelector<HTMLSelectElement>('#inund-satellite')!.value = satellite;
    Object.assign(RUNTIME_LIMITS, { MAX_SPAN_DEG: 8, MAX_SPAN_DEG_S2: 1.5 });
    mapState.setBbox([0, 0, 1.5001, 1]);
    button.click();
    await vi.waitFor(() => expect(doubles.error).toHaveBeenCalled());
    expect(doubles.error).toHaveBeenCalledExactlyOnceWith(
      'Error de validación',
      'El bounding box es demasiado grande (máx. 1.5°). Reduce el área seleccionada.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(document.querySelector('#map')!.className).toBe('');
    for (const fn of [
      doubles.create,
      doubles.update,
      doubles.remove,
      map.removeLayer,
      map.removeControl,
      map.fitBounds,
    ])
      expect(fn).not.toHaveBeenCalled();
    expect(mapState.getBbox()).toEqual([0, 0, 1.5001, 1]);
  }
);

it('rejects configured flood year range before creating progress or requests', async () => {
  RUNTIME_LIMITS.MAX_YEARS_RANGE = 2;
  document.querySelector<HTMLInputElement>('#inund-end')!.value = '2022-03-01';
  button.click();
  await vi.waitFor(() => expect(doubles.error).toHaveBeenCalled());
  expect(doubles.error).toHaveBeenCalledExactlyOnceWith(
    'Error de validación',
    'El rango de fechas excede el límite de 2 años. Reduce el intervalo.'
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  expect(document.querySelector('#map')!.className).toBe('');
  for (const fn of [
    doubles.create,
    doubles.update,
    doubles.remove,
    map.removeLayer,
    map.removeControl,
    map.fitBounds,
  ])
    expect(fn).not.toHaveBeenCalled();
  expect(mapState.getBbox()).toEqual([-92, 17, -91, 18]);
});

it.each(['sentinel1', 'landsat'])(
  'preserves the default valid %s request and accepts the exact span boundary',
  async satellite => {
    document.querySelector<HTMLSelectElement>('#inund-satellite')!.value = satellite;
    mapState.setBbox([0, 0, 4, 4]);
    button.click();
    await vi.waitFor(() => expect(doubles.remove).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `/api/flood-detection?start=2020-01-01&end=2020-12-31&bbox=${encodeURIComponent('[0,0,4,4]')}&satellite=${satellite}&auto=true&threshold=-18`
    );
    expect(doubles.create).toHaveBeenCalledOnce();
    expect(doubles.error).toHaveBeenCalledExactlyOnceWith(
      'Error en detección',
      'fixture'
    );
    expect(button.disabled).toBe(false);
    expect(document.querySelector('#map')!.className).toBe('');
  }
);
