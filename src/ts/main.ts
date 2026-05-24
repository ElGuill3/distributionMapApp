/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */

import type { BBox, VariableKey, Season } from './types.js';
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
  municipalFloodOverlays,
  setOverlayOpacity,
} from './map/overlays.js';
import {
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
  showErrorModal,
} from './ui/progress.js';
import { showFieldError } from './ui/fieldErrors.js';
import { translateBackendError } from './errorMap.js';
import { plotAllSelectedSeries, isDarkModeActive } from './ui/chart.js';
import { seasonToDates } from './utils/seasonDates.js';

import {
  fetchLocalStationLevel,
  exportBundle,
  exportPdfReport,
  downloadBlob,
  buildExportBundleZip,
} from './apiClient.js';
import { plotChartAsPng } from './ui/chart.js';

// ---------------------------------------------------------------------------
// Mapa principal (A)
// ---------------------------------------------------------------------------

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
const stationMarkersMap: L.Marker[] = [];
const stationMarkersMapB: L.Marker[] = [];

function _makeStationMarker(
  id: 'SPTTB' | 'BDCTB',
  targetMap: L.Map,
  markerList: L.Marker[]
): L.Marker {
  const [lat, lon] = STATION_COORDS[id];
  const marker = L.marker(L.latLng(lat, lon))
    .bindPopup(
      `<div class="station-popup-content">` +
        `<b>${STATION_LABELS[id]}</b><br>Estación de nivel local<br>` +
        `<a href="#" class="station-full-data-link" data-station-id="${id}">` +
        `Ver datos 2000–2024</a></div>`
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
    marker: false,
    circle: false,
    polyline: false,
    polygon: false,
    circlemarker: false,
    rectangle: { shapeOptions: { color: '#ff7800', weight: 2 } },
  },
  edit: {
    featureGroup: drawnItems as L.FeatureGroup,
    edit: true,
    remove: true,
  },
});
map.addControl(drawControl);

const rectangleDrawer = new L.Draw.Rectangle(map, {
  shapeOptions: { color: '#ff7800', weight: 2 },
});

const tflowDrawBtn = document.getElementById(
  'tflow-draw-btn'
) as HTMLButtonElement | null;
const tflowClearBtn = document.getElementById(
  'tflow-clear-btn'
) as HTMLButtonElement | null;
const topbarDrawBtn = document.getElementById(
  'topbar-draw-btn'
) as HTMLButtonElement | null;
const topbarClearBtn = document.getElementById(
  'topbar-clear-btn'
) as HTMLButtonElement | null;

tflowDrawBtn?.addEventListener('click', () => {
  rectangleDrawer.enable();
});
topbarDrawBtn?.addEventListener('click', () => {
  rectangleDrawer.enable();
});
topbarClearBtn?.addEventListener('click', () => {
  tflowClearBtn?.click();
});

// Initial topbar buttons state based on mapState
if (mapState.hasBbox()) {
  topbarDrawBtn?.classList.add('hidden');
  topbarClearBtn?.classList.remove('hidden');
} else {
  topbarDrawBtn?.classList.remove('hidden');
  topbarClearBtn?.classList.add('hidden');
}

document.addEventListener('bboxChanged', (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const { hasBbox } = detail || {};
  if (hasBbox) {
    topbarDrawBtn?.classList.add('hidden');
    topbarClearBtn?.classList.remove('hidden');
  } else {
    topbarDrawBtn?.classList.remove('hidden');
    topbarClearBtn?.classList.add('hidden');
  }
});

map.on(L.Draw.Event.DRAWSTART, () => {
  const drawBtn = document.getElementById('tflow-draw-btn') as HTMLButtonElement | null;
  if (drawBtn) {
    drawBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:16px;height:16px;flex-shrink:0;animation: pulse 1.5s infinite;">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      </svg>
      Dibujando en el mapa...
    `;
    drawBtn.disabled = true;
  }
  if (topbarDrawBtn) {
    topbarDrawBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14" style="animation: pulse 1.5s infinite;">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      </svg>
      <span>Dibujando...</span>
    `;
    topbarDrawBtn.disabled = true;
  }
});

map.on(L.Draw.Event.DRAWSTOP, () => {
  const drawBtn = document.getElementById('tflow-draw-btn') as HTMLButtonElement | null;
  if (drawBtn) {
    drawBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:16px;height:16px;flex-shrink:0;">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
      Dibujar área en el mapa
    `;
    drawBtn.disabled = false;
  }
  if (topbarDrawBtn) {
    topbarDrawBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
      <span>Dibujar área</span>
    `;
    topbarDrawBtn.disabled = false;
  }
});

// Phase B: bbox now managed via mapState.getBbox() / mapState.setBbox()

map.on(L.Draw.Event.CREATED, e => {
  const layer = (e as unknown as { layer: L.Rectangle }).layer;
  const bounds = layer.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const widthDeg = Math.abs(ne.lng - sw.lng);
  const heightDeg = Math.abs(ne.lat - sw.lat);

  if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
    showErrorModal(
      'Área demasiado grande',
      'El bounding box es demasiado grande (máx. ~8° por lado). Intentá con un área menor.'
    );
    return;
  }

  const centerLat = (sw.lat + ne.lat) / 2;
  const centerLng = (sw.lng + ne.lng) / 2;
  const halfSide = Math.min(widthDeg, heightDeg) / 2;

  const squareSouth = centerLat - halfSide;
  const squareNorth = centerLat + halfSide;
  const squareWest = centerLng - halfSide;
  const squareEast = centerLng + halfSide;

  const squareBounds = L.latLngBounds(
    L.latLng(squareSouth, squareWest),
    L.latLng(squareNorth, squareEast)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((layer as any).setBounds) (layer as any).setBounds(squareBounds);

  drawnItems.clearLayers();
  drawnItems.addLayer(layer);

  mapState.setBbox([squareWest, squareSouth, squareEast, squareNorth]);
  document.dispatchEvent(new CustomEvent('bboxChanged', { detail: { hasBbox: true } }));

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

const ndviChartContainer = document.getElementById(
  'ndvi-chart-container'
) as HTMLDivElement | null;
const ndviChartDiv = document.getElementById('ndvi-chart') as HTMLDivElement | null;
const chartPlaceholderA = document.getElementById(
  'chartPlaceholderA'
) as HTMLDivElement | null;

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

function showChartPlaceholderA(): void {
  chartPlaceholderA?.classList.remove('chart-placeholder--hidden');
}

function hideChartPlaceholderA(): void {
  chartPlaceholderA?.classList.add('chart-placeholder--hidden');
}

function renderChart(): void {
  if (!ndviChartDiv) return;
  plotAllSelectedSeries(
    ndviChartDiv,
    mapState.getSeriesDataA(),
    showChartContainer,
    hideChartContainer,
    showChartPlaceholderA,
    hideChartPlaceholderA
  );
  syncExportButton();
}

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel B
// ---------------------------------------------------------------------------

const chartBContainer = document.getElementById(
  'chart-b-container'
) as HTMLDivElement | null;
const chartBDiv = document.getElementById('chart-b') as HTMLDivElement | null;

// ResizeObserver to handle auto-resizing of Plotly charts on layout/container size shifts
const chartResizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const target = entry.target;
    const chartDiv = target.querySelector(
      '#ndvi-chart, #chart-b'
    ) as HTMLElement | null;
    if (chartDiv && (chartDiv as unknown as { layout?: unknown }).layout) {
      const width = chartDiv.clientWidth;
      const height = chartDiv.clientHeight;
      if (width > 0 && height > 0) {
        try {
          Plotly.relayout(chartDiv, { width, height });
        } catch {
          // Ignore if not initialized
        }
      }
    }
  }
});

if (ndviChartContainer) {
  chartResizeObserver.observe(ndviChartContainer);
}
if (chartBContainer) {
  chartResizeObserver.observe(chartBContainer);
}

// Phase B: allSeriesDataB now managed via mapState (seriesDataB)

function showChartBContainer(): void {
  chartBContainer?.classList.remove('hidden');
}
function hideChartBContainer(): void {
  if (mapState.getCompareModeActive()) return; // En compare mode siempre permanece visible
  chartBContainer?.classList.add('hidden');
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

const compareControlsA = document.getElementById(
  'compare-controls-a'
) as HTMLDivElement | null;
const compareModeHint = document.querySelector(
  '.compare-mode-hint'
) as HTMLElement | null;

// DOM: modo riesgo de inundación
const toggleFloodRiskModeButton = document.getElementById(
  'toggleFloodRiskMode'
) as HTMLButtonElement | null;
const floodRiskModeHint = document.querySelector(
  '.flood-risk-mode-hint'
) as HTMLElement | null;

// Phase B: floodRiskModeActive now managed via mapState

// DOM: selectores de comparativa — panel A
const compareVarASelect = document.getElementById(
  'compareVarA'
) as HTMLSelectElement | null;
const compareYearASelect = document.getElementById(
  'compareYearA'
) as HTMLSelectElement | null;
const compareSeasonASelect = document.getElementById(
  'compareSeasonA'
) as HTMLSelectElement | null;
const btnGenerateA = document.getElementById(
  'btnGenerateA'
) as HTMLButtonElement | null;

// DOM: selectores de comparativa — panel B
const compareVarBSelect = document.getElementById(
  'compareVarB'
) as HTMLSelectElement | null;
const compareYearBSelect = document.getElementById(
  'compareYearB'
) as HTMLSelectElement | null;
const compareSeasonBSelect = document.getElementById(
  'compareSeasonB'
) as HTMLSelectElement | null;
const btnGenerateB = document.getElementById(
  'btnGenerateB'
) as HTMLButtonElement | null;

// ---------------------------------------------------------------------------
// Checkboxes de estaciones en modo comparativa
// ---------------------------------------------------------------------------

const chkStationSpA = document.getElementById(
  'chkStationSpA'
) as HTMLInputElement | null;
const chkStationBdA = document.getElementById(
  'chkStationBdA'
) as HTMLInputElement | null;
const chkStationSpB = document.getElementById(
  'chkStationSpB'
) as HTMLInputElement | null;
const chkStationBdB = document.getElementById(
  'chkStationBdB'
) as HTMLInputElement | null;

// DOM: player controls
const playerControlsDiv = document.getElementById(
  'player-controls'
) as HTMLDivElement | null;
const playerPlayPauseBtn = document.getElementById(
  'playerPlayPause'
) as HTMLButtonElement | null;
const playerSlider = document.getElementById('playerSlider') as HTMLInputElement | null;
const playerFrameLabel = document.getElementById(
  'playerFrameLabel'
) as HTMLSpanElement | null;
const playerPlayIcon = document.getElementById(
  'playerPlayIcon'
) as HTMLSpanElement | null;
const playerSpeedSelect = document.getElementById(
  'playerSpeed'
) as HTMLSelectElement | null;

// PR1: Topbar DOM references
const topbarPlayPauseBtn = document.getElementById(
  'topbar-play-pause'
) as HTMLButtonElement | null;
const topbarPlayIcon = document.getElementById(
  'topbar-play-icon'
) as HTMLSpanElement | null;
const topbarSlider = document.getElementById(
  'topbar-slider'
) as HTMLInputElement | null;
const topbarFrameLabel = document.getElementById(
  'topbar-frame-label'
) as HTMLSpanElement | null;
const topbarSpeedSelect = document.getElementById(
  'topbar-speed'
) as HTMLSelectElement | null;

// PR1: Topbar layer toggle buttons
const topbarLayerGif = document.getElementById(
  'topbar-layer-gif'
) as HTMLButtonElement | null;
const topbarLayerStations = document.getElementById(
  'topbar-layer-stations'
) as HTMLButtonElement | null;
const topbarLayerFlood = document.getElementById(
  'topbar-layer-flood'
) as HTMLButtonElement | null;

// PR2: Topbar opacity slider
const topbarOpacitySlider = document.getElementById(
  'topbar-opacity-slider'
) as HTMLInputElement | null;
const topbarOpacityValue = document.getElementById(
  'topbar-opacity-value'
) as HTMLSpanElement | null;

/** Devuelve el intervalo de frame seleccionado actualmente (en ms). */
function _selectedInterval(): number {
  return Number(playerSpeedSelect?.value ?? '1000') || 1000;
}

function hidePlayerControls(): void {
  playerControlsDiv?.classList.add('hidden');
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
  topbarSlider,
  topbarFrameLabel,
  topbarPlayIcon,
  onChartRendered: syncExportButton,
  onDateLabelUpdate: updateDateLabel,
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
  compareVarBSelect,
  compareYearBSelect,
  compareSeasonBSelect,
  btnGenerateB,
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
  () => {},
  () => {},
  () => {}
);

document.addEventListener('floodRiskModeActivated', () => {
  floodRiskMode.enterFloodRiskMode(() => {});
  normalMode.clearNormalMode();
  body.classList.remove('sidebar-collapsed');
  syncSidebarState();
  toggleModeBanner('flood-risk', true);
});

document.addEventListener('floodRiskModeDeactivated', () => {
  floodRiskMode.exitFloodRiskMode();
  toggleModeBanner('flood-risk', false);
});

// PR2: Initialize new sidebar task flow modules directly (no bridge)
if (typeof window !== 'undefined') {
  Promise.all([
    // @ts-expect-error - plain JS module, no types
    import('../../static/sidebar/taskFlow.js'),
    // @ts-expect-error - plain JS module, no types
    import('../../static/sidebar/variableSelector.js'),
    // @ts-expect-error - plain JS module, no types
    import('../../static/sidebar/configPanel.js'),
    // @ts-expect-error - plain JS module, no types
    import('../../static/sidebar/modoSection.js'),
  ])
    .then(([taskFlow, variableSelector, configPanel, modoSection]) => {
      taskFlow.init();
      variableSelector.initChipContainer();
      configPanel.init();
      modoSection.init();
    })
    .catch((err: Error) => {
      console.warn('Failed to load sidebar modules:', err);
    });
}

// Phase C: delegated to normalMode
/** Para el SoloPlayer. */
// Phase C: delegated to normalMode

/** Limpia la animación y gráfica en modo normal (panel A). */
// Phase C: delegated to normalMode.clearNormalMode()

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
// Listeners para el modo comparativa coordinados por modoSection
// ---------------------------------------------------------------------------

document.addEventListener('compareModeActivated', () => {
  mapState.setCompareModeActive(true);
  document.body.classList.add('compare-mode-active');

  // Limpiar estado previo
  compareMode.cleanupComparePanels();
  mapState.clearSeriesData();
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);
  if (chartBDiv) Plotly.purge(chartBDiv);
  hidePlayerControls();

  // Mostrar controles de comparativa y pistas
  compareControlsA?.classList.remove('hidden');
  showChartBContainer();
  compareModeHint?.classList.remove('hidden');
  body.classList.add('sidebar-collapsed');
  syncSidebarState();
  toggleModeBanner('compare', true);

  // Poblar selectores de año/temporada según la variable seleccionada en cada panel
  compareMode.initCompareSelects();

  compareMode.initMapB();

  // Activar automáticamente el dibujo de bounding box si no hay ninguno seleccionado
  if (!mapState.getBbox()) {
    rectangleDrawer.enable();
  }

  setTimeout(() => {
    map.invalidateSize();
    mapState.getMapB()?.invalidateSize();
  }, 350);
});

document.addEventListener('compareModeDeactivated', () => {
  mapState.setCompareModeActive(false);
  document.body.classList.remove('compare-mode-active');

  // Limpiar y restaurar modo normal
  compareMode.cleanupComparePanels();
  mapState.clearSeriesData();
  hidePlayerControls();
  hideChartBContainer();
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);
  if (chartBDiv) Plotly.purge(chartBDiv);
  hideChartContainer();

  // Quitar colorbars de ambos mapas al salir de comparativa
  switchColorbar(map, null, mapState.getMapB() ?? undefined);

  // Limpiar bounding box
  drawnItems.clearLayers();
  mapState.clearBbox();
  document.dispatchEvent(
    new CustomEvent('bboxChanged', { detail: { hasBbox: false } })
  );

  compareControlsA?.classList.add('hidden');
  compareModeHint?.classList.add('hidden');
  body.classList.remove('sidebar-collapsed');
  syncSidebarState();
  toggleModeBanner('compare', false);

  setTimeout(() => map.invalidateSize(), 350);
});

// ---------------------------------------------------------------------------
// Listener: limpiar modo normal
// ---------------------------------------------------------------------------

tflowClearBtn?.addEventListener('click', () => {
  if (mapState.getCompareModeActive()) {
    compareMode.cleanupComparePanels();
    compareMode.clearPanelA();
    compareMode.clearPanelB();
  } else {
    normalMode.clearNormalMode();
  }
  drawnItems.clearLayers();
  mapState.clearBbox();
  document.dispatchEvent(
    new CustomEvent('bboxChanged', { detail: { hasBbox: false } })
  );

  // Reset task flow via mapState
  mapState.updateTaskFlowStepStatus('area', 'active');
  mapState.updateTaskFlowStepValidity('area', false);
  mapState.updateTaskFlowStepStatus('variable', 'pending');
  mapState.updateTaskFlowStepValidity('variable', false);
  mapState.updateTaskFlowStepStatus('config', 'pending');
  mapState.updateTaskFlowStepValidity('config', false);
  mapState.updateTaskFlowStepStatus('explore', 'pending');
  mapState.updateTaskFlowStepValidity('explore', false);
});

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
// PR1: Topbar playback controls — parallel wiring to existing player controls
// ---------------------------------------------------------------------------

function syncTopbarPlayPauseIcon(): void {
  if (!topbarPlayIcon) return;
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  topbarPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
}

topbarPlayPauseBtn?.addEventListener('click', () => {
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  if (!active) return;
  if (active.isPlaying) {
    active.pause();
  } else {
    active.play();
  }
  syncPlayPauseIcon();
  syncTopbarPlayPauseIcon();
});

topbarSlider?.addEventListener('input', () => {
  if (!topbarSlider) return;
  const frame = Number(topbarSlider.value);
  mapState.getSyncPlayer()?.goToFrame(frame);
  mapState.getSoloPlayer()?.goToFrame(frame);
});

topbarSpeedSelect?.addEventListener('change', () => {
  const ms = Number(topbarSpeedSelect?.value ?? '1000') || 1000;
  const syncP = mapState.getSyncPlayer();
  const soloP = mapState.getSoloPlayer();
  if (syncP) syncP.frameIntervalMs = ms;
  if (soloP) soloP.frameIntervalMs = ms;
});

// ---------------------------------------------------------------------------
// PR2: Opacity slider
// ---------------------------------------------------------------------------

/**
 * Capitalizes first letter of season name for Spanish display.
 */
function formatFrameLabel(season: string, year: number): string {
  const SEASON_LABELS: Record<string, string> = {
    verano: 'Verano',
    invierno: 'Invierno',
    primavera: 'Primavera',
    otono: 'Otoño',
    anual: 'Anual',
  };
  const label =
    SEASON_LABELS[season] ?? season.charAt(0).toUpperCase() + season.slice(1);
  return `${label} ${year}`;
}

/**
 * Updates the date label DOM element with the formatted season/year for the current frame.
 * Called from onPlayerFrameChange during playback.
 * In compare mode, updates both panel A and panel B date labels (same frame index for both).
 */
function updateDateLabel(frameIdx: number): void {
  const labels = mapState.getFrameDateLabels();
  if (labels.length === 0) return;

  // Update panel A date label
  const dateLabelEl = document.getElementById('animation-date-label');
  if (dateLabelEl) {
    const info = labels[frameIdx];
    if (info) {
      dateLabelEl.textContent = formatFrameLabel(info.season, info.year);
    } else {
      dateLabelEl.textContent = '';
    }
  }

  // Update panel B date label (compare mode - same frame index)
  const dateLabelB = document.getElementById('animation-date-label-b');
  if (dateLabelB) {
    const info = labels[frameIdx];
    if (info) {
      dateLabelB.textContent = formatFrameLabel(info.season, info.year);
    } else {
      dateLabelB.textContent = '';
    }
  }
}

topbarOpacitySlider?.addEventListener('input', () => {
  const opacity = Number(topbarOpacitySlider?.value ?? '100');
  setOverlayOpacity(opacity);
  if (topbarOpacityValue) {
    topbarOpacityValue.textContent = `${opacity}%`;
  }
});

// ---------------------------------------------------------------------------
// PR1: Topbar layer toggles
// ---------------------------------------------------------------------------

/**
 * Tracks visibility state of each layer controlled by topbar toggles.
 * Initial states: GIF (visible=true since animation loaded), stations (true by default), flood (false).
 */
const layerVisibility: Record<'gif' | 'stations' | 'flood', boolean> = {
  gif: true,
  stations: true,
  flood: false,
};

/**
 * Updates the aria-pressed state and CSS class of a layer toggle button.
 */
function syncLayerButtonState(btn: HTMLButtonElement, isActive: boolean): void {
  btn.setAttribute('aria-pressed', String(isActive));
  btn.classList.toggle('topbar-layer-btn--active', isActive);
}

/**
 * Shows or hides the active GIF overlay based on layer toggle state.
 */
function toggleGifLayer(show: boolean): void {
  const overlayA = mapState.getOverlayA();
  if (overlayA) {
    if (show && !map.hasLayer(overlayA)) {
      overlayA.addTo(map);
    } else if (!show && map.hasLayer(overlayA)) {
      map.removeLayer(overlayA);
    }
  }

  // Also apply to Panel B overlay if in compare mode
  const mapB = mapState.getMapB();
  const overlayB = mapState.getOverlayB();
  if (mapB && overlayB) {
    if (show && !mapB.hasLayer(overlayB)) {
      overlayB.addTo(mapB);
    } else if (!show && mapB.hasLayer(overlayB)) {
      mapB.removeLayer(overlayB);
    }
  }

  layerVisibility.gif = show;
  if (topbarLayerGif) syncLayerButtonState(topbarLayerGif, show);
}

/**
 * Shows or hides the station markers based on layer toggle state.
 */
function toggleStationsLayer(show: boolean): void {
  if (show) {
    for (const m of stationMarkersMap) {
      if (!map.hasLayer(m)) m.addTo(map);
    }
  } else {
    for (const m of stationMarkersMap) {
      if (map.hasLayer(m)) map.removeLayer(m);
    }
  }

  // Also apply to Map B if in compare mode
  const mapB = mapState.getMapB();
  if (mapB) {
    if (show) {
      for (const m of stationMarkersMapB) {
        if (!mapB.hasLayer(m)) m.addTo(mapB);
      }
    } else {
      for (const m of stationMarkersMapB) {
        if (mapB.hasLayer(m)) mapB.removeLayer(m);
      }
    }
  }

  layerVisibility.stations = show;
  if (topbarLayerStations) syncLayerButtonState(topbarLayerStations, show);
}

/**
 * Shows or hides the municipal flood overlays based on layer toggle state.
 */
function toggleFloodLayer(show: boolean): void {
  for (const overlay of Object.values(municipalFloodOverlays)) {
    if (show && !map.hasLayer(overlay)) {
      overlay.addTo(map);
    } else if (!show && map.hasLayer(overlay)) {
      map.removeLayer(overlay);
    }
  }
  layerVisibility.flood = show;
  if (topbarLayerFlood) syncLayerButtonState(topbarLayerFlood, show);
}

topbarLayerGif?.addEventListener('click', () => {
  toggleGifLayer(!layerVisibility.gif);
});

topbarLayerStations?.addEventListener('click', () => {
  toggleStationsLayer(!layerVisibility.stations);
});

topbarLayerFlood?.addEventListener('click', () => {
  toggleFloodLayer(!layerVisibility.flood);
});

// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal — modo NORMAL (panel A)
// ---------------------------------------------------------------------------
// Phase C: delegated to normalMode.requestGifAndSeries

/**
 * Wrapper que delega requestGifAndSeries a normalMode.
 * La firma void es requerida por registerVariableListener.
 */
async function requestGifAndSeries(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox
): Promise<void> {
  const result = await normalMode.requestGifAndSeries(variable, start, end, bbox);
  if (!result.success && result.error) {
    const uxError = translateBackendError(result.error);
    showErrorModal(uxError.title, uxError.message);
  }
  // PR1: Notify task flow of generation complete
  document.dispatchEvent(new CustomEvent('generationComplete'));
}

// PR1: New task flow generation handler
document.addEventListener('tflowGenerateAnimation', (e: Event) => {
  const customEvent = e as CustomEvent;
  const { variable, year, season } = customEvent.detail || {};

  if (!variable || !year || !season) {
    console.warn('[PR1] Missing generation parameters');
    return;
  }

  const bbox = mapState.getBbox();
  if (!bbox) {
    showErrorModal(
      'Sin área seleccionada',
      'Dibujá un rectángulo en el mapa antes de generar.'
    );
    document.dispatchEvent(new CustomEvent('generationComplete')); // Reset loading state
    return;
  }

  const { start, end } = seasonToDates(year, season);
  void requestGifAndSeries(variable, start, end, bbox);
});

// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------

// Phase A: usa fetchLocalStationLevel de apiClient.ts.

async function requestLocalStationLevel(
  stationId: 'SPTTB' | 'BDCTB',
  start: string,
  end: string
): Promise<void> {
  try {
    // Phase A: usa fetchLocalStationLevel de apiClient.ts
    const data = await fetchLocalStationLevel({ stationId, start, end });

    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
    mapState.setSeriesDataForVariable('A', key, {
      dates: data.dates,
      values: data.level_m,
    });
    renderChart();
  } catch (err) {
    console.error(err);
    // Surface backend errors honestly; fallback to network error only for actual network issues
    const errMsg = err instanceof Error ? err.message : String(err);
    const uxError = translateBackendError(errMsg);
    showErrorModal(uxError.title, uxError.message);
  }
}

// ---------------------------------------------------------------------------
// Selectores DOM — estaciones locales (nuevos IDs tflow-)
// ---------------------------------------------------------------------------

const spYearSelect = document.getElementById(
  'tflow-spYear'
) as HTMLSelectElement | null;
const spSeasonSelect = document.getElementById(
  'tflow-spSeason'
) as HTMLSelectElement | null;
const btnLocalSpLevel = document.getElementById(
  'tflow-btnLocalSpLevel'
) as HTMLButtonElement | null;

const bdYearSelect = document.getElementById(
  'tflow-bdYear'
) as HTMLSelectElement | null;
const bdSeasonSelect = document.getElementById(
  'tflow-bdSeason'
) as HTMLSelectElement | null;
const btnLocalBdLevel = document.getElementById(
  'tflow-btnLocalBdLevel'
) as HTMLButtonElement | null;

// ---------------------------------------------------------------------------
// Listeners de estaciones locales (año + temporada)
// ---------------------------------------------------------------------------

function _wireLocalStation(
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
  btn: HTMLButtonElement | null,
  stationId: 'SPTTB' | 'BDCTB',
  stationKey: 'local_sp' | 'local_bd'
): void {
  if (!yearSel || !seasonSel || !btn) return;

  // Poblar selectores
  for (const year of VARIABLE_YEARS[stationKey]) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    yearSel.appendChild(opt);
  }
  for (const s of SEASONS) {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    seasonSel.appendChild(opt);
  }

  const syncBtn = (): void => {
    btn.disabled = !yearSel.value || !seasonSel.value;
  };

  yearSel.addEventListener('change', () => {
    const hasYear = Boolean(yearSel.value);
    seasonSel.disabled = !hasYear;
    if (!hasYear) seasonSel.value = '';
    syncBtn();
  });
  seasonSel.addEventListener('change', syncBtn);

  btn.addEventListener('click', () => {
    const year = Number(yearSel.value);
    const season = seasonSel.value as Season;
    if (!year || !season) {
      showFieldError(btn, 'Seleccioná año y temporada antes de continuar.');
      return;
    }
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
// Bbox Status Bar Update
// ---------------------------------------------------------------------------

const modeBannerCompare = document.getElementById(
  'modeBannerCompare'
) as HTMLDivElement | null;
const modeBannerFloodRisk = document.getElementById(
  'modeBannerFloodRisk'
) as HTMLDivElement | null;

// ---------------------------------------------------------------------------
// Mode Banner Visibility Helpers
// ---------------------------------------------------------------------------

/**
 * Toggles the visibility of a mode banner.
 * @param mode - 'compare' for compare mode banner, 'flood-risk' for flood risk mode banner
 * @param visible - true to show, false to hide
 */
export function toggleModeBanner(
  mode: 'compare' | 'flood-risk',
  visible: boolean
): void {
  const banner = mode === 'compare' ? modeBannerCompare : modeBannerFloodRisk;
  if (banner) {
    banner.classList.toggle('hidden', !visible);
  }
}

// ---------------------------------------------------------------------------
// Listener: botón "Ver datos" en popup de estaciones locales
// ---------------------------------------------------------------------------

document.addEventListener('click', e => {
  const link = (e.target as HTMLElement).closest<HTMLElement>(
    '.station-full-data-link'
  );
  if (!link) return;
  e.preventDefault();
  const stationId = link.dataset['stationId'] as 'SPTTB' | 'BDCTB' | undefined;
  if (!stationId) return;
  void requestLocalStationLevel(stationId, '2000-01-01', '2024-12-31');
});

// ---------------------------------------------------------------------------
// Sidebar colapsar/restaurar
// ---------------------------------------------------------------------------

const restoreButton = document.getElementById(
  'sidebarRestore'
) as HTMLButtonElement | null;
const body = document.body;

export function syncSidebarState(): void {
  if (!restoreButton) return;
  const restoreSr = restoreButton.querySelector('.sr-only') as HTMLElement | null;
  const isHidden = body.classList.contains('sidebar-collapsed');
  restoreButton.setAttribute('aria-expanded', String(isHidden));
  const label = isHidden ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
  if (restoreSr) restoreSr.textContent = label;

  setTimeout(() => {
    map.invalidateSize();
    mapState.getMapB()?.invalidateSize();

    // Resize Plotly charts to fit their new container size
    try {
      if (ndviChartDiv && (ndviChartDiv as unknown as { layout?: unknown }).layout) {
        const width = ndviChartDiv.clientWidth;
        const height = ndviChartDiv.clientHeight;
        if (width > 0 && height > 0) {
          Plotly.relayout(ndviChartDiv, { width, height });
        }
      }
    } catch {
      // Ignore errors if the chart isn't initialized yet
    }

    try {
      if (chartBDiv && (chartBDiv as unknown as { layout?: unknown }).layout) {
        const width = chartBDiv.clientWidth;
        const height = chartBDiv.clientHeight;
        if (width > 0 && height > 0) {
          Plotly.relayout(chartBDiv, { width, height });
        }
      }
    } catch {
      // Ignore errors if the chart isn't initialized yet
    }
  }, 350);
}

if (restoreButton) {
  syncSidebarState();
  restoreButton.addEventListener('click', () => {
    body.classList.toggle('sidebar-collapsed');
    syncSidebarState();
  });
}

// ---------------------------------------------------------------------------
// Theme Selector Toggle
// ---------------------------------------------------------------------------

const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isDark = isDarkModeActive();
    const nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    window.dispatchEvent(new Event('theme-change'));
  });
}

// ---------------------------------------------------------------------------
// Export bundle
// ---------------------------------------------------------------------------

const btnExportAnalysis = document.getElementById(
  'btnExportAnalysis'
) as HTMLButtonElement | null;
const btnExportPdfReport = document.getElementById(
  'btnExportPdfReport'
) as HTMLButtonElement | null;

/**
 * Determina si hay datos de serie cargados para exportar.
 */
function canExport(): boolean {
  const seriesA = mapState.getSeriesDataA();
  const seriesB = mapState.getSeriesDataB();
  const hasSeriesA = Object.keys(seriesA).some(
    k => (seriesA[k as VariableKey]?.values?.length ?? 0) > 0
  );
  const hasSeriesB = Object.keys(seriesB).some(
    k => (seriesB[k as VariableKey]?.values?.length ?? 0) > 0
  );
  return hasSeriesA || hasSeriesB;
}

/**
 * Habilita/deshabilita el botón de exportación según el estado.
 */
function syncExportButton(): void {
  if (!btnExportAnalysis) return;

  const hasData = canExport();
  const hasBbox = mapState.hasBbox();
  const exportToolbar = document.getElementById('export-toolbar');

  btnExportAnalysis.disabled = !hasData;
  if (btnExportPdfReport) btnExportPdfReport.disabled = !hasData;

  // Toggle export toolbar visibility
  if (exportToolbar) {
    if (hasData) {
      exportToolbar.classList.add('can-export');
    } else {
      exportToolbar.classList.remove('can-export');
    }
  }

  // Update title attributes
  const baseTitle = 'Cargá al menos una variable para exportar';
  const bboxSuffix = hasBbox ? '' : ' — Selecciona un área primero';

  if (btnExportAnalysis) {
    btnExportAnalysis.title = hasData ? '' : baseTitle + bboxSuffix;
  }
  if (btnExportPdfReport) {
    btnExportPdfReport.title = hasData ? '' : baseTitle + bboxSuffix;
  }
}

// Sincronizar cuando cambia la serie de datos
// (llamada desde los handlers de modo normal y comparativa)

btnExportAnalysis?.addEventListener('click', async () => {
  const bbox = mapState.getBbox();
  if (!bbox) {
    showErrorModal(
      'Sin área seleccionada',
      'Dibujá un rectángulo en el mapa antes de exportar.'
    );
    return;
  }

  if (!canExport()) {
    showErrorModal(
      'Sin datos para exportar',
      'Cargá al menos una variable antes de exportar.'
    );
    return;
  }

  const panel: 'A' | 'B' = mapState.getCompareModeActive() ? 'B' : 'A';
  const seriesDataA = mapState.getSeriesDataA();
  const seriesDataB = mapState.getSeriesDataB();

  // Recopilar rutas de GIFs activos
  const gifPaths: string[] = [];
  const pathA = mapState.getActiveGifPathA();
  if (pathA) gifPaths.push(pathA);
  const pathB = mapState.getActiveGifPathB();
  if (pathB) gifPaths.push(pathB);

  createProgressIndicator();
  updateProgressIndicator(10, 'Generando exportación...');

  try {
    updateProgressIndicator(30, 'Obteniendo ZIP del servidor...');
    const zipBlob = await exportBundle({
      gifPaths,
      seriesDataA,
      seriesDataB,
      bbox,
      panel,
    });

    updateProgressIndicator(60, 'Capturando gráfica como PNG...');
    if (!ndviChartDiv) throw new Error('Chart div no encontrado.');
    const pngBlob = await plotChartAsPng(ndviChartDiv);

    updateProgressIndicator(80, 'Armando ZIP final...');
    await buildExportBundleZip(pngBlob, zipBlob);

    updateProgressIndicator(100, '¡Descarga lista!');
    removeProgressIndicator(1500);
  } catch (err) {
    console.error(err);
    removeProgressIndicator(0);
    const msg = err instanceof Error ? err.message : 'Error generando la exportación.';
    showErrorModal('Error de exportación', msg);
  }
});

// ---------------------------------------------------------------------------
// Export PDF Report
// ---------------------------------------------------------------------------

btnExportPdfReport?.addEventListener('click', async () => {
  const bbox = mapState.getBbox();
  if (!bbox) {
    showErrorModal(
      'Sin área seleccionada',
      'Dibujá un rectángulo en el mapa antes de exportar.'
    );
    return;
  }

  if (!canExport()) {
    showErrorModal(
      'Sin datos para exportar',
      'Cargá al menos una variable antes de exportar.'
    );
    return;
  }

  const seriesDataA = mapState.getSeriesDataA();
  const panel: 'A' | 'B' = mapState.getCompareModeActive() ? 'B' : 'A';

  // Recopilar datos
  const allDates: string[] = [];
  const allVariables: Record<string, (number | null)[]> = {};

  for (const [key, data] of Object.entries(seriesDataA)) {
    if (!data) continue;
    if (allDates.length === 0) allDates.push(...data.dates);
    allVariables[key] = [...data.values];
  }

  const variableKeys = Object.keys(allVariables);
  const gifPath = mapState.getActiveGifPathA() || mapState.getActiveGifPathB() || '';

  createProgressIndicator();

  try {
    updateProgressIndicator(10, 'Capturando gráfica como PNG...');
    if (!ndviChartDiv) throw new Error('Chart div no encontrado.');
    const chartBlob = await plotChartAsPng(ndviChartDiv);

    updateProgressIndicator(30, 'Convirtiendo chart a base64...');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const parts = result.split(',');
        resolve(parts[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(chartBlob);
    });

    updateProgressIndicator(50, 'Enviando solicitud de PDF...');
    const pdfBlob = await exportPdfReport({
      chartBlob: base64,
      gifPath,
      seriesData: { dates: allDates, variables: allVariables },
      bbox,
      metadata: { variableKeys, panel },
    });

    updateProgressIndicator(80, 'Descargando PDF...');
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
    downloadBlob(pdfBlob, `analysis_report_${timestamp}.pdf`);
    updateProgressIndicator(100, '¡PDF listo!');
    removeProgressIndicator(1500);
  } catch (err) {
    console.error(err);
    removeProgressIndicator(0);
    const msg = err instanceof Error ? err.message : 'Error generando el PDF.';
    showErrorModal('Error de exportación PDF', msg);
  }
});
