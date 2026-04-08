/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */

import type {
  BBox,
  VariableKey,
  Season,
  SeriesData,
} from './types.js';
import * as mapState from './state/mapState.js';
import * as normalMode from './modes/normalMode.js';
import * as compareMode from './modes/compareMode.js';
import * as floodRiskMode from './modes/floodRiskMode.js';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAX_SPAN_DEG,
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
import {
  fetchLocalStationLevel,
} from './apiClient.js';

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
// Marcadores de estaciones locales
// ---------------------------------------------------------------------------

const STATION_COORDS: Record<'SPTTB' | 'BDCTB', [number, number]> = {
  SPTTB: [17.791667, -91.158333],
  BDCTB: [17.433333, -91.483333],
};

const STATION_LABELS: Record<'SPTTB' | 'BDCTB', string> = {
  SPTTB: 'San Pedro (SPTTB)',
  BDCTB: 'Boca del Cerro (BDCTB)',
};

/** Marcadores de estaciones en mapa principal y mapa B. */
const stationMarkersMap:  L.Marker[] = [];
const stationMarkersMapB: L.Marker[] = [];

function _makeStationMarker(id: 'SPTTB' | 'BDCTB', targetMap: L.Map, markerList: L.Marker[]): L.Marker {
  const [lat, lon] = STATION_COORDS[id];
  const marker = L.marker(L.latLng(lat, lon))
    .bindPopup(
      `<div class="station-popup-content">` +
      `<b>${STATION_LABELS[id]}</b><br>Estación de nivel local<br>` +
      `<a href="#" class="station-full-data-link" data-station-id="${id}">` +
      `Ver datos 2000–2024</a></div>`,
    )
    .addTo(targetMap);
  markerList.push(marker);
  return marker;
}

_makeStationMarker('SPTTB', map, stationMarkersMap);
_makeStationMarker('BDCTB', map, stationMarkersMap);

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

// Phase B: bbox now managed via mapState.getBbox() / mapState.setBbox()

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

  mapState.setBbox([squareWest, squareSouth, squareEast, squareNorth]);

  removeActiveOverlay(map);
  switchColorbar(map, null);
  hideChartContainer();
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);

  mapState.clearSeriesData();
  compareMode.cleanupComparePanels();
  hidePlayerControls();
  hideChartBContainer();
  if (chartBDiv) Plotly.purge(chartBDiv);
});

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel A
// ---------------------------------------------------------------------------

const ndviChartContainer = document.getElementById('ndvi-chart-container') as HTMLDivElement | null;
const ndviChartDiv       = document.getElementById('ndvi-chart')           as HTMLDivElement | null;

// Phase B: allSeriesData now managed via mapState (seriesDataA)

function showChartContainer(): void {
  // En modo comparativa la visibilidad se controla via CSS; no ocultar
  if (!mapState.getCompareModeActive()) {
    ndviChartContainer?.classList.remove('hidden');
  }
}
function hideChartContainer(): void {
  if (!mapState.getCompareModeActive()) {
    ndviChartContainer?.classList.add('hidden');
  }
}

function renderChart(): void {
  if (!ndviChartDiv) return;
  plotAllSelectedSeries(ndviChartDiv, mapState.getSeriesDataA(), showChartContainer, hideChartContainer);
}

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel B
// ---------------------------------------------------------------------------

const chartBContainer = document.getElementById('chart-b-container') as HTMLDivElement | null;
const chartBDiv       = document.getElementById('chart-b')           as HTMLDivElement | null;

// Phase B: allSeriesDataB now managed via mapState (seriesDataB)

function showChartBContainer(): void {
  chartBContainer?.classList.remove('hidden');
}
function hideChartBContainer(): void {
  if (mapState.getCompareModeActive()) return;  // En compare mode siempre permanece visible
  chartBContainer?.classList.add('hidden');
}

function renderChartB(): void {
  if (!chartBDiv) return;
  plotAllSelectedSeries(chartBDiv, mapState.getSeriesDataB(), showChartBContainer, hideChartBContainer);
}

// ---------------------------------------------------------------------------
// Estado de variable activa
// ---------------------------------------------------------------------------

// Phase B: currentVariable now managed via mapState

// ---------------------------------------------------------------------------
// Modo comparativa
// ---------------------------------------------------------------------------

// Phase B: compareModeActive, mapB, mapBSyncLock now managed via mapState

// Phase B: activeBOverlay now managed via mapState.getOverlayB() / mapState.setOverlayB()

// Phase B: gifPlayerA, gifPlayerB, syncPlayer, soloPlayer now managed via mapState

// DOM: modo comparativa
const toggleCompareModeButton  = document.getElementById('toggleCompareMode')    as HTMLButtonElement | null;
const compareControlsA         = document.getElementById('compare-controls-a')   as HTMLDivElement | null;
const compareModeHint          = document.querySelector('.compare-mode-hint')     as HTMLElement | null;

// DOM: modo riesgo de inundación
const toggleFloodRiskModeButton = document.getElementById('toggleFloodRiskMode') as HTMLButtonElement | null;
const floodRiskModeHint         = document.querySelector('.flood-risk-mode-hint') as HTMLElement | null;
const btnClearNormal            = document.getElementById('btnClearNormal')       as HTMLButtonElement | null;

// Phase B: floodRiskModeActive now managed via mapState

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

// ---------------------------------------------------------------------------
// Checkboxes de estaciones en modo comparativa
// ---------------------------------------------------------------------------

const chkStationSpA = document.getElementById('chkStationSpA') as HTMLInputElement | null;
const chkStationBdA = document.getElementById('chkStationBdA') as HTMLInputElement | null;
const chkStationSpB = document.getElementById('chkStationSpB') as HTMLInputElement | null;
const chkStationBdB = document.getElementById('chkStationBdB') as HTMLInputElement | null;

// DOM: player controls
const playerControlsDiv  = document.getElementById('player-controls')  as HTMLDivElement | null;
const playerPlayPauseBtn = document.getElementById('playerPlayPause')   as HTMLButtonElement | null;
const playerSlider       = document.getElementById('playerSlider')      as HTMLInputElement | null;
const playerFrameLabel   = document.getElementById('playerFrameLabel')  as HTMLSpanElement | null;
const playerPlayIcon     = document.getElementById('playerPlayIcon')    as HTMLSpanElement | null;
const playerSpeedSelect  = document.getElementById('playerSpeed')       as HTMLSelectElement | null;

/** Devuelve el intervalo de frame seleccionado actualmente (en ms). */
function _selectedInterval(): number {
  return Number(playerSpeedSelect?.value ?? '1000') || 1000;
}

// Phase C: inicializar normalMode con referencias al DOM y mapa
normalMode.initNormalMode({
  map,
  chartDiv: ndviChartDiv,
  playerControlsDiv,
  playerSlider,
  playerFrameLabel,
  playerPlayIcon,
  playerSpeedSelect,
});

// Phase D: inicializar compareMode con referencias al DOM y mapa
compareMode.initCompareMode({
  map,
  stationMarkersMap,
  stationMarkersMapB,
  playerControlsDiv,
  playerSlider,
  playerFrameLabel,
  playerPlayIcon,
  playerSpeedSelect,
  ndviChartDiv,
  chartBDiv,
  compareControlsA,
  compareModeHint,
  chartBContainer,
  compareVarASelect,
  compareYearASelect,
  compareSeasonASelect,
  btnGenerateA,
  btnClearA,
  compareVarBSelect,
  compareYearBSelect,
  compareSeasonBSelect,
  btnGenerateB,
  btnClearB,
  chkStationSpA,
  chkStationBdA,
  chkStationSpB,
  chkStationBdB,
});

// Phase D: registrar todos los listeners de comparativa en compareMode
compareMode.registerCompareModeListeners();

// Phase E: inicializar floodRiskMode con referencias al DOM y mapa
floodRiskMode.initFloodRiskMode({
  map,
  toggleFloodRiskModeButton,
  floodRiskModeHint,
});

// Phase E: registrar listeners de modo riesgo
floodRiskMode.registerFloodRiskModeListeners(
  () => {
    // Entrar al modo riesgo — delegar completamente a enterFloodRiskMode
    // que maneja la coordinación de desactivación de compare mode internamente
    floodRiskMode.enterFloodRiskMode(() => {
      if (mapState.getCompareModeActive()) {
        mapState.setCompareModeActive(false);
        document.body.classList.remove('compare-mode-active');
        toggleCompareModeButton?.setAttribute('aria-pressed', 'false');
        compareMode.cleanupComparePanels();
        mapState.clearSeriesData();
        hidePlayerControls();
        hideChartBContainer();
        if (ndviChartDiv) Plotly.purge(ndviChartDiv);
        if (chartBDiv) Plotly.purge(chartBDiv);
        switchColorbar(map, null, mapState.getMapB() ?? undefined);
        drawnItems.clearLayers();
        mapState.clearBbox();
        compareControlsA?.classList.add('hidden');
        compareModeHint?.classList.add('hidden');
        setTimeout(() => map.invalidateSize(), 350);
      }
      normalMode.clearNormalMode();
    });
  },
  () => {
    // Salir del modo riesgo
    floodRiskMode.exitFloodRiskMode();
  },
  () => { normalMode.clearNormalMode(); },
);

// Phase C: delegated to normalMode
/** Para el SoloPlayer. */
// Phase C: delegated to normalMode

/** Limpia la animación y gráfica en modo normal (panel A). */
// Phase C: delegated to normalMode.clearNormalMode()

// ---------------------------------------------------------------------------
// Visibilidad de marcadores de estaciones
// ---------------------------------------------------------------------------

function _setMarkersVisible(markers: L.Marker[], targetMap: L.Map, visible: boolean): void {
  for (const m of markers) {
    if (visible && !targetMap.hasLayer(m)) {
      m.addTo(targetMap);
    } else if (!visible && targetMap.hasLayer(m)) {
      targetMap.removeLayer(m);
    }
  }
}

/**
 * Muestra u oculta los marcadores de estaciones según el estado actual:
 * - Mapa A: visibles cuando no hay animación activa ni capas flood.
 * - Mapa B: visibles cuando no hay animación activa en panel B.
 */
function _updateStationMarkersVisibility(): void {
  const showOnMap = !mapState.getOverlayA() && Object.keys(municipalFloodOverlays).length === 0;
  _setMarkersVisible(stationMarkersMap, map, showOnMap);
  if (mapState.getMapB()) {
    _setMarkersVisible(stationMarkersMapB, mapState.getMapB()!, !mapState.getOverlayB());
  }
}

function showPlayerControls(): void {
  playerControlsDiv?.classList.remove('hidden');
}
function hidePlayerControls(): void {
  playerControlsDiv?.classList.add('hidden');
}

// Phase C: player controls delegate to normalMode
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
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  playerPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
}

// Phase D: trySyncBothPanels ahora vive en compareMode.ts

// Phase B: _currentOverlayA now managed via mapState.getOverlayA() / mapState.setOverlayA()

// ---------------------------------------------------------------------------
// Población de selectores de comparativa
// ---------------------------------------------------------------------------
// Phase D: toda la lógica de selectores y listeners de comparativa ahora
// vive en compareMode.ts y se registra vía compareMode.registerCompareModeListeners()

// ---------------------------------------------------------------------------
// Listener: toggle modo comparativa
// ---------------------------------------------------------------------------

toggleCompareModeButton?.addEventListener('click', () => {
  const newState = !mapState.getCompareModeActive();
  mapState.setCompareModeActive(newState);
  document.body.classList.toggle('compare-mode-active', newState);
  toggleCompareModeButton.setAttribute('aria-pressed', String(newState));

  if (newState) {
    // Desactivar flood risk mode si estaba activo
    floodRiskMode.exitFloodRiskMode();

    // Limpiar estado previo
    compareMode.cleanupComparePanels();
    mapState.clearSeriesData();
    if (ndviChartDiv) Plotly.purge(ndviChartDiv);
    if (chartBDiv)    Plotly.purge(chartBDiv);
    hidePlayerControls();

    // Mostrar controles de comparativa y pistas
    compareControlsA?.classList.remove('hidden');
    showChartBContainer();
    compareModeHint?.classList.remove('hidden');

    // Poblar selectores de año/temporada según la variable seleccionada en cada panel
    compareMode.initCompareSelects();

    compareMode.initMapB();
    setTimeout(() => {
      map.invalidateSize();
      mapState.getMapB()?.invalidateSize();
    }, 350);
  } else {
    // Limpiar y restaurar modo normal
    compareMode.cleanupComparePanels();
    mapState.clearSeriesData();
    hidePlayerControls();
    hideChartBContainer();
    if (ndviChartDiv) Plotly.purge(ndviChartDiv);
    if (chartBDiv)    Plotly.purge(chartBDiv);
    hideChartContainer();

    // Quitar colorbars de ambos mapas al salir de comparativa
    switchColorbar(map, null, mapState.getMapB() ?? undefined);

    // Limpiar bounding box
    drawnItems.clearLayers();
    mapState.clearBbox();

    compareControlsA?.classList.add('hidden');
    compareModeHint?.classList.add('hidden');

    setTimeout(() => map.invalidateSize(), 350);
  }
});

// ---------------------------------------------------------------------------
// Listener: limpiar modo normal
// ---------------------------------------------------------------------------

btnClearNormal?.addEventListener('click', () => { normalMode.clearNormalMode(); });

// ---------------------------------------------------------------------------
// Listener: play/pause
// ---------------------------------------------------------------------------

playerPlayPauseBtn?.addEventListener('click', () => {
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
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
  mapState.getSyncPlayer()?.goToFrame(frame);
  mapState.getSoloPlayer()?.goToFrame(frame);
});

playerSpeedSelect?.addEventListener('change', () => {
  const ms = _selectedInterval();
  const syncP = mapState.getSyncPlayer();
  const soloP = mapState.getSoloPlayer();
  if (syncP) syncP.frameIntervalMs = ms;
  if (soloP) soloP.frameIntervalMs = ms;
});

// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal — modo NORMAL (panel A)
// ---------------------------------------------------------------------------
// Phase C: delegated to normalMode.requestGifAndSeries

/**
 * Wrapper que delega requestGifAndSeries a normalMode.
 * La firma void es requerida por registerVariableListener.
 */
function requestGifAndSeries(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox,
): void {
  void normalMode.requestGifAndSeries(variable, start, end, bbox);
}

// ---------------------------------------------------------------------------
// Petición GIF + serie temporal — modo COMPARATIVA (panel A o B)
// ---------------------------------------------------------------------------
// Phase D: delegated to compareMode.requestGifAndSeriesForPanel

/**
 * Wrapper que delega requestGifAndSeriesForPanel a compareMode.
 */
async function requestGifAndSeriesForPanel(
  panel: 'A' | 'B',
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox,
): Promise<void> {
  await compareMode.requestGifAndSeriesForPanel(panel, variable, start, end, bbox);
}

// ---------------------------------------------------------------------------
// Riesgo de inundación por municipio
// ---------------------------------------------------------------------------
// Phase E: delegated to floodRiskMode.toggleMunicipalFloodRisk

function toggleMunicipalFloodRisk(muni: string, checked: boolean): Promise<void> {
  return floodRiskMode.toggleMunicipalFloodRisk(muni, checked);
}

// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------

// Phase A: usa fetchLocalStationLevel de apiClient.ts.

async function requestLocalStationLevel(
  stationId: 'SPTTB' | 'BDCTB',
  start: string,
  end: string,
): Promise<void> {
  try {
    // Phase A: usa fetchLocalStationLevel de apiClient.ts
    const data = await fetchLocalStationLevel({ stationId, start, end });

    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
    mapState.setSeriesDataForVariable('A', key, { dates: data.dates, values: data.level_m });
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

const getBbox = () => mapState.getBbox();

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
// Phase E: delegated to floodRiskMode.registerFloodRiskModeListeners()

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
    if (!details.open || mapState.getCompareModeActive()) return;
    const v = variableDetailsMap[details.id];
    if (!v) return;
    mapState.setCurrentVariable(v);
  });
});

// ---------------------------------------------------------------------------
// Listener: botón "Ver datos" en popup de estaciones locales
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>('.station-full-data-link');
  if (!link) return;
  e.preventDefault();
  const stationId = link.dataset['stationId'] as 'SPTTB' | 'BDCTB' | undefined;
  if (!stationId) return;
  void requestLocalStationLevel(stationId, '2000-01-01', '2024-12-31');
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
      mapState.getMapB()?.invalidateSize();
    }, 350);
  };

  syncState();
  collapseButton.addEventListener('click', () => { body.classList.add('sidebar-collapsed');    syncState(); });
  restoreButton.addEventListener('click',  () => { body.classList.remove('sidebar-collapsed'); syncState(); });
}
