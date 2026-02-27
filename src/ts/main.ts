/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */

import type {
  BBox,
  VariableKey,
  Season,
  GifResponse,
  TimeseriesResponse,
  StationResponse,
  FloodRiskResponse,
  SeriesData,
} from './types.js';
import { VARIABLE_DATA_KEY } from './types.js';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAX_SPAN_DEG,
  GIF_ENDPOINT,
  TS_ENDPOINT,
  VARIABLE_YEARS,
  SEASONS,
} from './config.js';
import {
  buildColorbars,
  switchColorbar,
  removeActiveOverlay,
  setActiveOverlay,
  municipalFloodOverlays,
} from './map/overlays.js';
import {
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
} from './ui/progress.js';
import { plotAllSelectedSeries } from './ui/chart.js';
import { registerVariableListener, seasonToDates } from './listeners/variableListeners.js';
import { GifPlayer, SyncPlayer, SoloPlayer } from './ui/gifPlayer.js';

// ---------------------------------------------------------------------------
// Mapa principal (A)
// ---------------------------------------------------------------------------

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:     19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

buildColorbars();

// ---------------------------------------------------------------------------
// Herramienta de dibujo (Leaflet.draw)
// ---------------------------------------------------------------------------

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: {
    marker:       false,
    circle:       false,
    polyline:     false,
    polygon:      false,
    circlemarker: false,
    rectangle:    { shapeOptions: { color: '#ff7800', weight: 2 } },
  },
  edit: {
    featureGroup: drawnItems as L.FeatureGroup,
    edit:         true,
    remove:       true,
  },
});
map.addControl(drawControl);

let currentBbox: BBox | null = null;

map.on(L.Draw.Event.CREATED, (e) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = ((e as unknown) as { layer: L.Rectangle }).layer;
  const bounds = layer.getBounds();
  const sw     = bounds.getSouthWest();
  const ne     = bounds.getNorthEast();

  const widthDeg  = Math.abs(ne.lng - sw.lng);
  const heightDeg = Math.abs(ne.lat - sw.lat);

  if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
    alert('El bounding box es demasiado grande (máx. ~8° por lado). Dibuja una región más pequeña.');
    return;
  }

  const centerLat = (sw.lat + ne.lat) / 2;
  const centerLng = (sw.lng + ne.lng) / 2;
  const halfSide  = Math.min(widthDeg, heightDeg) / 2;

  const squareSouth = centerLat - halfSide;
  const squareNorth = centerLat + halfSide;
  const squareWest  = centerLng - halfSide;
  const squareEast  = centerLng + halfSide;

  const squareBounds = L.latLngBounds(
    L.latLng(squareSouth, squareWest),
    L.latLng(squareNorth, squareEast),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((layer as any).setBounds) (layer as any).setBounds(squareBounds);

  drawnItems.clearLayers();
  drawnItems.addLayer(layer);

  currentBbox = [squareWest, squareSouth, squareEast, squareNorth];

  removeActiveOverlay(map);
  switchColorbar(map, null);
  hideChartContainer();
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);

  (Object.keys(allSeriesData)  as VariableKey[]).forEach(k => delete allSeriesData[k]);
  (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
  _cleanupComparePanels();
  hidePlayerControls();
  hideChartBContainer();
  if (chartBDiv) Plotly.purge(chartBDiv);
  clearMapBOverlay();
});

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel A
// ---------------------------------------------------------------------------

const ndviChartContainer = document.getElementById('ndvi-chart-container') as HTMLDivElement | null;
const ndviChartDiv       = document.getElementById('ndvi-chart')           as HTMLDivElement | null;

const allSeriesData: Partial<Record<VariableKey, SeriesData | undefined>> = {};

function showChartContainer(): void {
  // En modo comparativa la visibilidad se controla via CSS; no ocultar
  if (!compareModeActive) {
    ndviChartContainer?.classList.remove('hidden');
  }
}
function hideChartContainer(): void {
  if (!compareModeActive) {
    ndviChartContainer?.classList.add('hidden');
  }
}

function renderChart(): void {
  if (!ndviChartDiv) return;
  plotAllSelectedSeries(ndviChartDiv, allSeriesData, showChartContainer, hideChartContainer);
}

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel B
// ---------------------------------------------------------------------------

const chartBContainer = document.getElementById('chart-b-container') as HTMLDivElement | null;
const chartBDiv       = document.getElementById('chart-b')           as HTMLDivElement | null;

const allSeriesDataB: Partial<Record<VariableKey, SeriesData | undefined>> = {};

function showChartBContainer(): void {
  chartBContainer?.classList.remove('hidden');
}
function hideChartBContainer(): void {
  if (compareModeActive) return;  // En compare mode siempre permanece visible
  chartBContainer?.classList.add('hidden');
}

function renderChartB(): void {
  if (!chartBDiv) return;
  plotAllSelectedSeries(chartBDiv, allSeriesDataB, showChartBContainer, hideChartBContainer);
}

// ---------------------------------------------------------------------------
// Estado de variable activa
// ---------------------------------------------------------------------------

let currentVariable: VariableKey = 'ndvi';

// ---------------------------------------------------------------------------
// Modo comparativa
// ---------------------------------------------------------------------------

let compareModeActive = false;
let mapB: L.Map | null = null;
let mapBSyncLock = false;

/** Overlay activo en panel B. */
let activeBOverlay: L.ImageOverlay | null = null;

/** GifPlayers independientes por panel (solo en modo comparativa). */
let gifPlayerA: GifPlayer | null = null;
let gifPlayerB: GifPlayer | null = null;

/** Instancia del SyncPlayer activo (ambos paneles sincronizados). */
let syncPlayer: SyncPlayer | null = null;

/** Instancia del SoloPlayer activo (un solo panel animándose). */
let soloPlayer: SoloPlayer | null = null;

// DOM: modo comparativa
const toggleCompareModeButton = document.getElementById('toggleCompareMode') as HTMLButtonElement | null;
const compareControlsA        = document.getElementById('compare-controls-a') as HTMLDivElement | null;
const compareModeHint         = document.querySelector('.compare-mode-hint')   as HTMLElement | null;

// DOM: selectores de comparativa — panel A
const compareVarASelect    = document.getElementById('compareVarA')    as HTMLSelectElement | null;
const compareYearASelect   = document.getElementById('compareYearA')   as HTMLSelectElement | null;
const compareSeasonASelect = document.getElementById('compareSeasonA') as HTMLSelectElement | null;
const btnGenerateA         = document.getElementById('btnGenerateA')   as HTMLButtonElement | null;
const btnClearA            = document.getElementById('btnClearA')      as HTMLButtonElement | null;

// DOM: selectores de comparativa — panel B
const compareVarBSelect    = document.getElementById('compareVarB')    as HTMLSelectElement | null;
const compareYearBSelect   = document.getElementById('compareYearB')   as HTMLSelectElement | null;
const compareSeasonBSelect = document.getElementById('compareSeasonB') as HTMLSelectElement | null;
const btnGenerateB         = document.getElementById('btnGenerateB')   as HTMLButtonElement | null;
const btnClearB            = document.getElementById('btnClearB')      as HTMLButtonElement | null;

// DOM: player controls
const playerControlsDiv  = document.getElementById('player-controls')  as HTMLDivElement | null;
const playerPlayPauseBtn = document.getElementById('playerPlayPause')   as HTMLButtonElement | null;
const playerSlider       = document.getElementById('playerSlider')      as HTMLInputElement | null;
const playerFrameLabel   = document.getElementById('playerFrameLabel')  as HTMLSpanElement | null;
const playerPlayIcon     = document.getElementById('playerPlayIcon')    as HTMLSpanElement | null;

/** Inicializa mapB la primera vez que se activa el modo comparativa. */
function initMapB(): void {
  if (mapB) return;

  mapB = L.map('map-b', { zoomControl: false }).setView(map.getCenter(), map.getZoom());

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:     19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapB);

  map.on('moveend', () => {
    if (mapBSyncLock || !mapB) return;
    mapBSyncLock = true;
    mapB.setView(map.getCenter(), map.getZoom(), { animate: false });
    mapBSyncLock = false;
  });

  mapB.on('moveend', () => {
    if (mapBSyncLock) return;
    mapBSyncLock = true;
    map.setView(mapB!.getCenter(), mapB!.getZoom(), { animate: false });
    mapBSyncLock = false;
  });
}

function clearMapBOverlay(): void {
  if (activeBOverlay && mapB) {
    mapB.removeLayer(activeBOverlay);
    activeBOverlay = null;
  }
}

/** Para el SyncPlayer sin liberar los GifPlayers. */
function stopSyncPlayer(): void {
  if (syncPlayer) {
    syncPlayer.stop();
    syncPlayer = null;
  }
}

/** Para el SoloPlayer. */
function stopSoloPlayer(): void {
  if (soloPlayer) {
    soloPlayer.stop();
    soloPlayer = null;
  }
}

/** Limpia todos los players y overlays activos. */
function _cleanupComparePanels(): void {
  stopSoloPlayer();
  stopSyncPlayer();
  gifPlayerA?.dispose();
  gifPlayerA = null;
  gifPlayerB?.dispose();
  gifPlayerB = null;
  _currentOverlayA = null;
  removeActiveOverlay(map);
  clearMapBOverlay();
}

/** Limpia solo el panel A (animación + gráfica) sin tocar el panel B. */
function _clearPanelA(): void {
  stopSyncPlayer();
  stopSoloPlayer();
  gifPlayerA?.dispose();
  gifPlayerA       = null;
  _currentOverlayA = null;
  removeActiveOverlay(map);
  switchColorbar(map, null, mapB ?? undefined);
  (Object.keys(allSeriesData) as VariableKey[]).forEach(k => delete allSeriesData[k]);
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);
  hidePlayerControls();
  if (compareYearASelect)   compareYearASelect.value   = '';
  if (compareSeasonASelect) { compareSeasonASelect.value = ''; compareSeasonASelect.disabled = true; }
  if (btnGenerateA)         btnGenerateA.disabled = true;
}

/** Limpia solo el panel B (animación + gráfica) sin tocar el panel A. */
function _clearPanelB(): void {
  stopSyncPlayer();
  stopSoloPlayer();
  gifPlayerB?.dispose();
  gifPlayerB = null;
  clearMapBOverlay();
  switchColorbar(map, null, mapB ?? undefined);
  (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
  if (chartBDiv) Plotly.purge(chartBDiv);
  hidePlayerControls();
  if (compareYearBSelect)   compareYearBSelect.value   = '';
  if (compareSeasonBSelect) { compareSeasonBSelect.value = ''; compareSeasonBSelect.disabled = true; }
  if (btnGenerateB)         btnGenerateB.disabled = true;
}

function showPlayerControls(): void {
  playerControlsDiv?.classList.remove('hidden');
}
function hidePlayerControls(): void {
  playerControlsDiv?.classList.add('hidden');
}

function onPlayerFrameChange(current: number, total: number): void {
  if (playerSlider) {
    playerSlider.max   = String(total - 1);
    playerSlider.value = String(current);
  }
  if (playerFrameLabel) {
    playerFrameLabel.textContent = `${current + 1} / ${total}`;
  }
}

function syncPlayPauseIcon(): void {
  if (!playerPlayIcon) return;
  const active = syncPlayer ?? soloPlayer;
  playerPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
}

/**
 * Crea un SyncPlayer cuando ambos paneles tienen GIF cargado.
 * Se llama al terminar de generar cualquiera de los dos paneles.
 */
function trySyncBothPanels(): void {
  if (!gifPlayerA || !gifPlayerB || !activeBOverlay) return;

  const overlayA = _currentOverlayA;
  if (!overlayA) return;

  // Detener el SoloPlayer que animaba cada panel por separado
  stopSoloPlayer();
  stopSyncPlayer();

  syncPlayer = new SyncPlayer();
  syncPlayer.onFrameChange = (current, total) => {
    onPlayerFrameChange(current, total);
    syncPlayPauseIcon();
  };
  syncPlayer.start(gifPlayerA, overlayA, gifPlayerB, activeBOverlay);

  if (playerSlider) {
    playerSlider.max   = String(Math.max(gifPlayerA.frameCount, gifPlayerB.frameCount) - 1);
    playerSlider.value = '0';
  }
  showPlayerControls();
  syncPlayPauseIcon();
}

/** Referencia al overlay GifPlayer activo en map A (solo modo comparativa). */
let _currentOverlayA: L.ImageOverlay | null = null;

// ---------------------------------------------------------------------------
// Población de selectores de comparativa
// ---------------------------------------------------------------------------

/** Rellena un selector de años (mantiene solo el placeholder en pos 0). */
function _populateYearSelect(sel: HTMLSelectElement | null, years: number[]): void {
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  for (const year of years) {
    const opt       = document.createElement('option');
    opt.value       = String(year);
    opt.textContent = String(year);
    sel.appendChild(opt);
  }
}

/** Rellena las temporadas si todavía solo tiene el placeholder. */
function _ensureSeasonOptions(sel: HTMLSelectElement | null): void {
  if (!sel || sel.options.length > 1) return;
  for (const s of SEASONS) {
    const opt       = document.createElement('option');
    opt.value       = s.value;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
}

/** Inicializa los selectores de año/temporada de ambos paneles. */
function _initCompareSelects(): void {
  const varA = (compareVarASelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  const varB = (compareVarBSelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  _populateYearSelect(compareYearASelect, VARIABLE_YEARS[varA]);
  _populateYearSelect(compareYearBSelect, VARIABLE_YEARS[varB]);
  _ensureSeasonOptions(compareSeasonASelect);
  _ensureSeasonOptions(compareSeasonBSelect);
}

/** Registra la lógica reactiva de los selectores de comparativa de un panel. */
function _wireCompareSelectPair(
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
  btn: HTMLButtonElement | null,
): void {
  if (!yearSel || !seasonSel || !btn) return;

  const sync = (): void => { btn.disabled = !yearSel.value || !seasonSel.value; };

  yearSel.addEventListener('change', () => {
    const hasYear       = Boolean(yearSel.value);
    seasonSel.disabled  = !hasYear;
    if (!hasYear) seasonSel.value = '';
    sync();
  });
  seasonSel.addEventListener('change', sync);
}

_wireCompareSelectPair(compareYearASelect, compareSeasonASelect, btnGenerateA);
_wireCompareSelectPair(compareYearBSelect, compareSeasonBSelect, btnGenerateB);

// Cuando cambia la variable en un panel, repoblar su selector de años
compareVarASelect?.addEventListener('change', () => {
  const v = (compareVarASelect.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  _populateYearSelect(compareYearASelect, VARIABLE_YEARS[v]);
  if (compareYearASelect)   compareYearASelect.value   = '';
  if (compareSeasonASelect) { compareSeasonASelect.value = ''; compareSeasonASelect.disabled = true; }
  if (btnGenerateA)         btnGenerateA.disabled = true;
});

compareVarBSelect?.addEventListener('change', () => {
  const v = (compareVarBSelect.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  _populateYearSelect(compareYearBSelect, VARIABLE_YEARS[v]);
  if (compareYearBSelect)   compareYearBSelect.value   = '';
  if (compareSeasonBSelect) { compareSeasonBSelect.value = ''; compareSeasonBSelect.disabled = true; }
  if (btnGenerateB)         btnGenerateB.disabled = true;
});

// ---------------------------------------------------------------------------
// Listener: toggle modo comparativa
// ---------------------------------------------------------------------------

toggleCompareModeButton?.addEventListener('click', () => {
  compareModeActive = !compareModeActive;
  document.body.classList.toggle('compare-mode-active', compareModeActive);
  toggleCompareModeButton.setAttribute('aria-pressed', String(compareModeActive));

  if (compareModeActive) {
    // Limpiar estado previo
    _cleanupComparePanels();
    (Object.keys(allSeriesData)  as VariableKey[]).forEach(k => delete allSeriesData[k]);
    (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
    if (ndviChartDiv) Plotly.purge(ndviChartDiv);
    if (chartBDiv)    Plotly.purge(chartBDiv);
    hidePlayerControls();

    // Mostrar controles de comparativa y pistas
    compareControlsA?.classList.remove('hidden');
    showChartBContainer();
    compareModeHint?.classList.remove('hidden');

    // Poblar selectores de año/temporada según la variable seleccionada en cada panel
    _initCompareSelects();

    initMapB();
    setTimeout(() => {
      map.invalidateSize();
      mapB?.invalidateSize();
    }, 350);
  } else {
    // Limpiar y restaurar modo normal
    _cleanupComparePanels();
    (Object.keys(allSeriesData)  as VariableKey[]).forEach(k => delete allSeriesData[k]);
    (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
    hidePlayerControls();
    hideChartBContainer();
    if (ndviChartDiv) Plotly.purge(ndviChartDiv);
    if (chartBDiv)    Plotly.purge(chartBDiv);
    hideChartContainer();

    // Quitar colorbars de ambos mapas al salir de comparativa
    switchColorbar(map, null, mapB ?? undefined);

    // Limpiar bounding box
    drawnItems.clearLayers();
    currentBbox = null;

    compareControlsA?.classList.add('hidden');
    compareModeHint?.classList.add('hidden');

    setTimeout(() => map.invalidateSize(), 350);
  }
});

// ---------------------------------------------------------------------------
// Listener: play/pause
// ---------------------------------------------------------------------------

playerPlayPauseBtn?.addEventListener('click', () => {
  const active = syncPlayer ?? soloPlayer;
  if (!active) return;
  if (active.isPlaying) {
    active.pause();
  } else {
    active.play();
  }
  syncPlayPauseIcon();
});

playerSlider?.addEventListener('input', () => {
  if (!playerSlider) return;
  const frame = Number(playerSlider.value);
  syncPlayer?.goToFrame(frame);
  soloPlayer?.goToFrame(frame);
});

// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal — modo NORMAL (panel A)
// ---------------------------------------------------------------------------

async function requestGifAndSeries(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox,
): Promise<void> {
  currentVariable = variable;

  const bboxJson = JSON.stringify(bbox);
  const taskId   = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`
    + `&task_id=${encodeURIComponent(taskId)}`;

  const tsUrl = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`;

  createProgressIndicator();

  const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { progress: number; message: string };
      updateProgressIndicator(data.progress, data.message);
      if (data.progress === 100 || data.progress === -1) {
        eventSource.close();
        if (data.progress === 100) removeProgressIndicator(1000);
      }
    } catch { /* ignore */ }
  };
  eventSource.onerror = () => eventSource.close();

  try {
    const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);

    const gifData = await gifResp.json() as GifResponse & { error?: string };
    const tsData  = await tsResp.json()  as TimeseriesResponse & { error?: string };

    if (!gifResp.ok) {
      alert(gifData.error ?? 'Error generando animación.');
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));

    // Limpiar player anterior antes de crear el nuevo
    stopSoloPlayer();
    gifPlayerA?.dispose();
    gifPlayerA = null;
    _currentOverlayA = null;
    removeActiveOverlay(map);

    const player  = new GifPlayer();
    await player.load(gifData.gifUrl);

    const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
    setActiveOverlay(overlay);
    switchColorbar(map, variable);
    map.fitBounds(overlayBounds);

    gifPlayerA       = player;
    _currentOverlayA = overlay;

    soloPlayer = new SoloPlayer();
    soloPlayer.onFrameChange = (current, total) => {
      onPlayerFrameChange(current, total);
      syncPlayPauseIcon();
    };
    soloPlayer.start(player, overlay);

    if (playerSlider) {
      playerSlider.max   = String(player.frameCount - 1);
      playerSlider.value = '0';
    }
    showPlayerControls();
    syncPlayPauseIcon();

    if (tsResp.ok) {
      const dataKey = VARIABLE_DATA_KEY[variable] as keyof TimeseriesResponse;
      const values  = tsData[dataKey] as number[] | undefined;
      if (tsData.dates && values) {
        allSeriesData[variable] = { dates: tsData.dates, values };
        renderChart();
      }
    } else {
      console.warn('Error en serie temporal:', tsData.error);
    }

  } catch (err) {
    console.error(err);
    alert('Error de red al generar animación / serie temporal.');
    updateProgressIndicator(-1, 'Error de red');
    removeProgressIndicator(3000);
  } finally {
    eventSource.close();
  }
}

// ---------------------------------------------------------------------------
// Petición GIF + serie temporal — modo COMPARATIVA (panel A o B)
// ---------------------------------------------------------------------------

async function requestGifAndSeriesForPanel(
  panel: 'A' | 'B',
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox,
): Promise<void> {
  currentVariable = variable;

  const bboxJson = JSON.stringify(bbox);
  const taskId   = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`
    + `&task_id=${encodeURIComponent(taskId)}`;

  const tsUrl = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`;

  createProgressIndicator();

  const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { progress: number; message: string };
      updateProgressIndicator(data.progress, data.message);
      if (data.progress === 100 || data.progress === -1) {
        eventSource.close();
        if (data.progress === 100) removeProgressIndicator(1000);
      }
    } catch { /* ignore */ }
  };
  eventSource.onerror = () => eventSource.close();

  try {
    const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);

    const gifData = await gifResp.json() as GifResponse & { error?: string };
    const tsData  = await tsResp.json()  as TimeseriesResponse & { error?: string };

    if (!gifResp.ok) {
      alert(gifData.error ?? `Error generando animación (panel ${panel}).`);
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));

    // Parar toda reproducción antes de modificar cualquier panel
    stopSoloPlayer();
    stopSyncPlayer();
    hidePlayerControls();

    if (panel === 'A') {
      // Liberar recursos anteriores del panel A
      gifPlayerA?.dispose();
      gifPlayerA = null;
      _currentOverlayA = null;
      removeActiveOverlay(map);

      const player  = new GifPlayer();
      await player.load(gifData.gifUrl);

      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
      setActiveOverlay(overlay);
      // En compare mode la colorbar va al panel derecho (mapB)
      if (mapB) switchColorbar(mapB, variable, map);
      map.fitBounds(overlayBounds);

      gifPlayerA       = player;
      _currentOverlayA = overlay;

      // Animar panel A de forma independiente hasta que llegue el panel B
      soloPlayer = new SoloPlayer();
      soloPlayer.onFrameChange = (current, total) => {
        onPlayerFrameChange(current, total);
        syncPlayPauseIcon();
      };
      soloPlayer.start(player, overlay);

      if (playerSlider) {
        playerSlider.max   = String(player.frameCount - 1);
        playerSlider.value = '0';
      }
      showPlayerControls();
      syncPlayPauseIcon();

      if (tsResp.ok) {
        const dataKey = VARIABLE_DATA_KEY[variable] as keyof TimeseriesResponse;
        const values  = tsData[dataKey] as number[] | undefined;
        if (tsData.dates && values) {
          allSeriesData[variable] = { dates: tsData.dates, values };
          renderChart();
        }
      } else {
        console.warn('Error en serie temporal panel A:', tsData.error);
      }

    } else {
      // Panel B
      gifPlayerB?.dispose();
      gifPlayerB = null;
      clearMapBOverlay();

      const player  = new GifPlayer();
      await player.load(gifData.gifUrl);

      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(mapB!);
      activeBOverlay = overlay;
      // La colorbar siempre en el panel derecho (mapB) en compare mode
      switchColorbar(mapB!, variable, map);
      mapB?.fitBounds(overlayBounds);
      setTimeout(() => mapB?.setView(map.getCenter(), map.getZoom(), { animate: false }), 100);

      gifPlayerB = player;

      if (tsResp.ok) {
        const dataKeyB = VARIABLE_DATA_KEY[variable] as keyof TimeseriesResponse;
        const valuesB  = tsData[dataKeyB] as number[] | undefined;
        if (tsData.dates && valuesB) {
          allSeriesDataB[variable] = { dates: tsData.dates, values: valuesB };
          renderChartB();
        }
      } else {
        console.warn('Error en serie temporal panel B:', tsData.error);
      }
    }

    // Si ambos paneles tienen GIF → sincronizar
    trySyncBothPanels();

  } catch (err) {
    console.error(err);
    alert(`Error de red al generar animación / serie temporal (panel ${panel}).`);
    updateProgressIndicator(-1, 'Error de red');
    removeProgressIndicator(3000);
  } finally {
    eventSource.close();
  }
}

// ---------------------------------------------------------------------------
// Listeners: "Generar panel A" y "Generar panel B" (modo comparativa)
// ---------------------------------------------------------------------------

btnGenerateA?.addEventListener('click', () => {
  const variable = (compareVarASelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  const year     = Number(compareYearASelect?.value);
  const season   = compareSeasonASelect?.value as Season | undefined;
  const bbox     = currentBbox;

  if (!year || !season) { alert('Selecciona año y temporada para el panel A.'); return; }
  if (!bbox)            { alert('Dibuja primero un rectángulo en el mapa.');      return; }

  const { start, end } = seasonToDates(year, season);
  void requestGifAndSeriesForPanel('A', variable, start, end, bbox);
});

btnGenerateB?.addEventListener('click', () => {
  const variable = (compareVarBSelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  const year     = Number(compareYearBSelect?.value);
  const season   = compareSeasonBSelect?.value as Season | undefined;
  const bbox     = currentBbox;

  if (!year || !season) { alert('Selecciona año y temporada para el panel B.'); return; }
  if (!bbox)            { alert('Dibuja primero un rectángulo en el mapa.');      return; }

  const { start, end } = seasonToDates(year, season);
  void requestGifAndSeriesForPanel('B', variable, start, end, bbox);
});

btnClearA?.addEventListener('click', () => { _clearPanelA(); });
btnClearB?.addEventListener('click', () => { _clearPanelB(); });

// ---------------------------------------------------------------------------
// Riesgo de inundación por municipio
// ---------------------------------------------------------------------------

async function toggleMunicipalFloodRisk(muni: string, checked: boolean): Promise<void> {
  if (!checked) {
    const existing = municipalFloodOverlays[muni];
    if (existing) {
      map.removeLayer(existing);
      delete municipalFloodOverlays[muni];
    }
    return;
  }

  if (municipalFloodOverlays[muni]) {
    municipalFloodOverlays[muni]?.addTo(map);
    return;
  }

  try {
    const resp = await fetch(`/api/flood-risk-municipio?muni=${encodeURIComponent(muni)}`);
    const data = await resp.json() as FloodRiskResponse & { error?: string };

    if (!resp.ok) {
      alert(data.error ?? 'Error generando mapa de riesgo por municipio.');
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = data.bbox;
    const bounds  = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
    const overlay = L.imageOverlay(data.mapUrl, bounds, { opacity: 0.8 }).addTo(map);
    municipalFloodOverlays[muni] = overlay;
    switchColorbar(map, 'flood');
  } catch (err) {
    console.error(err);
    alert('Error de red al generar mapa de riesgo por municipio.');
  }
}

// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------

async function requestLocalStationLevel(
  stationId: 'SPTTB' | 'BDCTB',
  start: string,
  end: string,
): Promise<void> {
  const url = `/api/local-station-level-range?station=${encodeURIComponent(stationId)}`
    + `&start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json() as StationResponse & { error?: string };

    if (!resp.ok) {
      alert(data.error ?? 'Error cargando serie de nivel de estación local.');
      return;
    }

    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
    allSeriesData[key] = { dates: data.dates, values: data.level_m };
    renderChart();
  } catch (err) {
    console.error(err);
    alert('Error de red al cargar serie de estación local.');
  }
}

// ---------------------------------------------------------------------------
// Selectores DOM — variables principales
// ---------------------------------------------------------------------------

const ndviYearSelect   = document.getElementById('ndviYear')   as HTMLSelectElement | null;
const ndviSeasonSelect = document.getElementById('ndviSeason') as HTMLSelectElement | null;
const generateGifButton = document.getElementById('generateNdviGifBBox') as HTMLButtonElement | null;

const tempYearSelect   = document.getElementById('tempYear')   as HTMLSelectElement | null;
const tempSeasonSelect = document.getElementById('tempSeason') as HTMLSelectElement | null;
const generateTempGifButton = document.getElementById('generateTempGifBBox') as HTMLButtonElement | null;

const soilYearSelect   = document.getElementById('soilYear')   as HTMLSelectElement | null;
const soilSeasonSelect = document.getElementById('soilSeason') as HTMLSelectElement | null;
const generateSoilGifButton = document.getElementById('generateSoilGifBBox') as HTMLButtonElement | null;

const precipYearSelect   = document.getElementById('precipYear')   as HTMLSelectElement | null;
const precipSeasonSelect = document.getElementById('precipSeason') as HTMLSelectElement | null;
const generatePrecipGifButton = document.getElementById('generatePrecipGifBBox') as HTMLButtonElement | null;

const waterYearSelect   = document.getElementById('waterYear')   as HTMLSelectElement | null;
const waterSeasonSelect = document.getElementById('waterSeason') as HTMLSelectElement | null;
const generateWaterGifButton = document.getElementById('generateWaterGifBBox') as HTMLButtonElement | null;

// Selectores DOM — estaciones locales
const spYearSelect   = document.getElementById('spYear')       as HTMLSelectElement | null;
const spSeasonSelect = document.getElementById('spSeason')     as HTMLSelectElement | null;
const btnLocalSpLevel = document.getElementById('btnLocalSpLevel') as HTMLButtonElement | null;

const bdYearSelect   = document.getElementById('bdYear')       as HTMLSelectElement | null;
const bdSeasonSelect = document.getElementById('bdSeason')     as HTMLSelectElement | null;
const btnLocalBdLevel = document.getElementById('btnLocalBdLevel') as HTMLButtonElement | null;

// ---------------------------------------------------------------------------
// Registro de listeners usando la factory
// ---------------------------------------------------------------------------

const getBbox = () => currentBbox;

const variableConfigs: Parameters<typeof registerVariableListener>[0][] = [
  { variable: 'ndvi',   yearSelect: ndviYearSelect,   seasonSelect: ndviSeasonSelect,   button: generateGifButton,        getBbox, onRequest: requestGifAndSeries },
  { variable: 'temp',   yearSelect: tempYearSelect,   seasonSelect: tempSeasonSelect,   button: generateTempGifButton,    getBbox, onRequest: requestGifAndSeries },
  { variable: 'soil',   yearSelect: soilYearSelect,   seasonSelect: soilSeasonSelect,   button: generateSoilGifButton,    getBbox, onRequest: requestGifAndSeries },
  { variable: 'precip', yearSelect: precipYearSelect, seasonSelect: precipSeasonSelect, button: generatePrecipGifButton,  getBbox, onRequest: requestGifAndSeries },
  { variable: 'water',  yearSelect: waterYearSelect,  seasonSelect: waterSeasonSelect,  button: generateWaterGifButton,   getBbox, onRequest: requestGifAndSeries },
];

variableConfigs.forEach(cfg => registerVariableListener(cfg));

// ---------------------------------------------------------------------------
// Listeners de estaciones locales (año + temporada)
// ---------------------------------------------------------------------------

function _wireLocalStation(
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
  btn: HTMLButtonElement | null,
  stationId: 'SPTTB' | 'BDCTB',
  stationKey: 'local_sp' | 'local_bd',
): void {
  if (!yearSel || !seasonSel || !btn) return;

  // Poblar selectores
  for (const year of VARIABLE_YEARS[stationKey]) {
    const opt       = document.createElement('option');
    opt.value       = String(year);
    opt.textContent = String(year);
    yearSel.appendChild(opt);
  }
  for (const s of SEASONS) {
    const opt       = document.createElement('option');
    opt.value       = s.value;
    opt.textContent = s.label;
    seasonSel.appendChild(opt);
  }

  const syncBtn = (): void => { btn.disabled = !yearSel.value || !seasonSel.value; };

  yearSel.addEventListener('change', () => {
    const hasYear      = Boolean(yearSel.value);
    seasonSel.disabled = !hasYear;
    if (!hasYear) seasonSel.value = '';
    syncBtn();
  });
  seasonSel.addEventListener('change', syncBtn);

  btn.addEventListener('click', () => {
    const year   = Number(yearSel.value);
    const season = seasonSel.value as Season;
    if (!year || !season) { alert('Selecciona año y temporada.'); return; }
    const { start, end } = seasonToDates(year, season);
    void requestLocalStationLevel(stationId, start, end);
  });
}

_wireLocalStation(spYearSelect, spSeasonSelect, btnLocalSpLevel, 'SPTTB', 'local_sp');
_wireLocalStation(bdYearSelect, bdSeasonSelect, btnLocalBdLevel, 'BDCTB', 'local_bd');

// ---------------------------------------------------------------------------
// Listeners de municipios (riesgo de inundación)
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLInputElement>('input.chk-flood-muni').forEach(chk => {
  chk.addEventListener('change', () => {
    const muni = chk.dataset['muni'];
    if (!muni) return;
    void toggleMunicipalFloodRisk(muni, chk.checked);
  });
});

// ---------------------------------------------------------------------------
// Actualizar currentVariable al abrir un details de variable
// ---------------------------------------------------------------------------

const variableDetailsMap: Record<string, Exclude<VariableKey, 'local_sp' | 'local_bd'>> = {
  'ndvi-controls':   'ndvi',
  'temp-controls':   'temp',
  'soil-controls':   'soil',
  'precip-controls': 'precip',
  'water-controls':  'water',
};

document.querySelectorAll<HTMLDetailsElement>('details[id]').forEach(details => {
  details.addEventListener('toggle', () => {
    if (!details.open || compareModeActive) return;
    const v = variableDetailsMap[details.id];
    if (!v) return;
    currentVariable = v;
  });
});

// ---------------------------------------------------------------------------
// Sidebar colapsar/restaurar
// ---------------------------------------------------------------------------

const collapseButton = document.getElementById('sidebarToggle')  as HTMLButtonElement | null;
const restoreButton  = document.getElementById('sidebarRestore') as HTMLButtonElement | null;
const body           = document.body;

if (collapseButton && restoreButton) {
  const collapseSr = collapseButton.querySelector('.sr-only') as HTMLElement | null;
  const restoreSr  = restoreButton.querySelector('.sr-only')  as HTMLElement | null;

  const syncState = () => {
    const isHidden = body.classList.contains('sidebar-collapsed');
    collapseButton.setAttribute('aria-expanded', String(!isHidden));
    restoreButton.setAttribute('aria-expanded',  String(isHidden));
    const label = isHidden ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
    if (collapseSr) collapseSr.textContent = label;
    if (restoreSr)  restoreSr.textContent  = label;
    setTimeout(() => {
      map.invalidateSize();
      mapB?.invalidateSize();
    }, 350);
  };

  syncState();
  collapseButton.addEventListener('click', () => { body.classList.add('sidebar-collapsed');    syncState(); });
  restoreButton.addEventListener('click',  () => { body.classList.remove('sidebar-collapsed'); syncState(); });
}
