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
import * as inundacionesMode from './modes/inundacionesMode.js';
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
import { initLucideIcons, setLucideIcon } from './ui/icons.js';
import { seasonToDates } from './utils/seasonDates.js';

import {
  fetchLocalStationLevel,
  fetchLocalStationsList,
  exportBundle,
  downloadBlob,
  buildExportBundleZip,
  createProgressEventSource,
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

/** Marcadores de estaciones en mapa principal y mapa B. */
const stationMarkersMap: L.Marker[] = [];
const stationMarkersMapB: L.Marker[] = [];

// SVGs e Iconos personalizados para estaciones locales
const waveSvg = `
<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.6 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path>
  <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path>
  <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.6 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path>
</svg>
`;

const dropSvg = `
<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22a7 7 0 0 0 7-7c0-4.3-7-11-7-11S5 10.7 5 15a7 7 0 0 0 7 7z"></path>
</svg>
`;

const waveIcon = L.divIcon({
  html: `<div class="station-icon station-icon-hidro">${waveSvg}</div>`,
  className: 'custom-station-icon',
  iconSize: [28, 28],
  iconAnchor: [30, 14], // Desplazado 16px a la izquierda
  popupAnchor: [-16, -14], // Popup alineado con el icono desplazado
});

const dropIcon = L.divIcon({
  html: `<div class="station-icon station-icon-clima">${dropSvg}</div>`,
  className: 'custom-station-icon',
  iconSize: [28, 28],
  iconAnchor: [-2, 14], // Desplazado 16px a la derecha
  popupAnchor: [16, -14], // Popup alineado con el icono desplazado
});

async function initializeLocalStations(): Promise<void> {
  try {
    const list = await fetchLocalStationsList();
    mapState.setLocalStations(list);

    // Limpiar marcadores existentes por si acaso
    stationMarkersMap.forEach(m => map.removeLayer(m));
    stationMarkersMap.length = 0;

    const tflowHidro = document.getElementById(
      'tflow-hidroStation'
    ) as HTMLSelectElement | null;
    const tflowClima = document.getElementById(
      'tflow-climaStation'
    ) as HTMLSelectElement | null;
    const selHidroA = document.getElementById(
      'selStationHidroA'
    ) as HTMLSelectElement | null;
    const selClimaA = document.getElementById(
      'selStationClimaA'
    ) as HTMLSelectElement | null;
    const selHidroB = document.getElementById(
      'selStationHidroB'
    ) as HTMLSelectElement | null;
    const selClimaB = document.getElementById(
      'selStationClimaB'
    ) as HTMLSelectElement | null;

    if (tflowHidro)
      tflowHidro.innerHTML = '<option value="">-- Seleccionar Estación --</option>';
    if (tflowClima)
      tflowClima.innerHTML = '<option value="">-- Seleccionar Estación --</option>';
    if (selHidroA) selHidroA.innerHTML = '<option value="">-- Seleccionar --</option>';
    if (selClimaA) selClimaA.innerHTML = '<option value="">-- Seleccionar --</option>';
    if (selHidroB) selHidroB.innerHTML = '<option value="">-- Seleccionar --</option>';
    if (selClimaB) selClimaB.innerHTML = '<option value="">-- Seleccionar --</option>';

    for (const [id, info] of Object.entries(list)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = info.name;

      const isHidro = info.type === 'hidrometrica' || id.endsWith('_hidro');
      if (isHidro) {
        tflowHidro?.appendChild(opt.cloneNode(true));
        selHidroA?.appendChild(opt.cloneNode(true));
        selHidroB?.appendChild(opt.cloneNode(true));
      } else {
        tflowClima?.appendChild(opt.cloneNode(true));
        selClimaA?.appendChild(opt.cloneNode(true));
        selClimaB?.appendChild(opt.cloneNode(true));
      }

      if (info.coords && info.coords.length === 2) {
        const [lat, lon] = info.coords;
        const icon = isHidro ? waveIcon : dropIcon;
        const badgeClass = isHidro ? 'station-badge-hidro' : 'station-badge-clima';
        const badgeLabel = isHidro ? '🌊 Hidro' : '💧 Clima';
        const metricDesc = isHidro ? 'Nivel del río' : 'Precipitación';
        const marker = L.marker(L.latLng(lat, lon), { icon }).bindPopup(
          `<div class="station-popup-content">` +
            `<div class="station-popup-header">` +
              `<span class="station-badge ${badgeClass}">${badgeLabel}</span>` +
            `</div>` +
            `<h3 class="station-popup-title">${info.station_name || info.name}</h3>` +
            `<div class="station-popup-meta">` +
              `<span class="station-popup-meta-item">📍 ${info.municipio || 'Sin Municipio'}</span>` +
              `<span class="station-popup-meta-item">📊 ${metricDesc}</span>` +
            `</div>` +
            `<a href="#" class="station-popup-btn station-full-data-link" data-station-id="${id}">` +
              `⚡ Ver datos 2000–2024` +
            `</a>` +
          `</div>`
        );
        marker.addTo(map);
        stationMarkersMap.push(marker);
      }
    }
    
    // Sincronizar visibilidad de marcadores y estado del botón al inicializar
    toggleStationsLayer(layerVisibility.stations);
  } catch (err) {
    console.error('Error al inicializar estaciones locales:', err);
  }
}

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
      <span class="tflow-draw-icon" data-lucide="loader-2" aria-hidden="true"></span>
      Dibujando en el mapa...
    `;
    initLucideIcons(drawBtn);
    drawBtn.disabled = true;
  }
  if (topbarDrawBtn) {
    topbarDrawBtn.innerHTML = `
      <span class="topbar-draw-icon" data-lucide="loader-2" aria-hidden="true"></span>
      <span>Dibujando...</span>
    `;
    initLucideIcons(topbarDrawBtn);
    topbarDrawBtn.disabled = true;
  }
});

map.on(L.Draw.Event.DRAWSTOP, () => {
  const drawBtn = document.getElementById('tflow-draw-btn') as HTMLButtonElement | null;
  if (drawBtn) {
    drawBtn.innerHTML = `
      <span class="tflow-draw-icon" data-lucide="square-pen" aria-hidden="true"></span>
      Dibujar área en el mapa
    `;
    initLucideIcons(drawBtn);
    drawBtn.disabled = false;
  }
  if (topbarDrawBtn) {
    topbarDrawBtn.innerHTML = `
      <span class="topbar-draw-icon" data-lucide="square-pen" aria-hidden="true"></span>
      <span>Dibujar área</span>
    `;
    initLucideIcons(topbarDrawBtn);
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
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);
  showChartContainer();
  showChartPlaceholderA();

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
  // En modo normal el panel de gráfica debe permanecer visible.
  // La limpieza solo vacía el contenido y muestra el placeholder.
  ndviChartContainer?.classList.remove('hidden');
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

// DOM: modo inundaciones
const toggleInundacionesModeButton = document.getElementById(
  'toggleInundacionesMode'
) as HTMLButtonElement | null;
const inundacionesModeHint = document.getElementById(
  'modeBannerInundaciones'
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

const selStationHidroA = document.getElementById(
  'selStationHidroA'
) as HTMLSelectElement | null;
const selStationClimaA = document.getElementById(
  'selStationClimaA'
) as HTMLSelectElement | null;
const selStationHidroB = document.getElementById(
  'selStationHidroB'
) as HTMLSelectElement | null;
const selStationClimaB = document.getElementById(
  'selStationClimaB'
) as HTMLSelectElement | null;

// DOM: player controls
const playerControlsDiv = document.getElementById(
  'player-controls'
) as HTMLDivElement | null;
const playerPlayPauseBtn = document.getElementById(
  'playerPlayPause'
) as HTMLButtonElement | null;
const playerStepPrevBtn = document.getElementById(
  'playerStepPrev'
) as HTMLButtonElement | null;
const playerStepNextBtn = document.getElementById(
  'playerStepNext'
) as HTMLButtonElement | null;
const playerSlider = document.getElementById('playerSlider') as HTMLInputElement | null;
const playerFrameLabel = document.getElementById(
  'playerFrameLabel'
) as HTMLSpanElement | null;
let playerPlayIcon = document.getElementById('playerPlayIcon') as Element | null;
const playerSpeedSelect = document.getElementById(
  'playerSpeed'
) as HTMLSelectElement | null;

// PR1: Topbar DOM references
const topbarPlayPauseBtn = document.getElementById(
  'topbar-play-pause'
) as HTMLButtonElement | null;
const topbarStepPrevBtn = document.getElementById(
  'topbar-step-prev'
) as HTMLButtonElement | null;
const topbarStepNextBtn = document.getElementById(
  'topbar-step-next'
) as HTMLButtonElement | null;
let topbarPlayIcon = document.getElementById('topbar-play-icon') as Element | null;
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

// Inicializar iconos Lucide del DOM antes de pasar referencias a los módulos
initLucideIcons(document);

playerPlayIcon = document.getElementById('playerPlayIcon');
topbarPlayIcon = document.getElementById('topbar-play-icon');

/** Devuelve el intervalo de frame seleccionado actualmente (en ms). */
function _selectedInterval(): number {
  return Number(playerSpeedSelect?.value ?? '1000') || 1000;
}

function hidePlayerControls(): void {
  playerControlsDiv?.classList.add('hidden');
}

function getActivePlayer(): {
  isPlaying: boolean;
  pause(): void;
  play(): void;
  goToFrame(n: number): void;
  currentFrameIndex: number;
  frameCount?: number;
  totalFrameCount?: number;
} | null {
  return (mapState.getSyncPlayer() ?? mapState.getSoloPlayer()) as {
    isPlaying: boolean;
    pause(): void;
    play(): void;
    goToFrame(n: number): void;
    currentFrameIndex: number;
    frameCount?: number;
    totalFrameCount?: number;
  } | null;
}

function getActivePlayerTotalFrames(
  player: ReturnType<typeof getActivePlayer>
): number {
  if (!player) return 0;
  return player.totalFrameCount ?? player.frameCount ?? 0;
}

function stepActivePlayer(delta: number): void {
  const active = getActivePlayer();
  if (!active) return;

  const total = getActivePlayerTotalFrames(active);
  if (total <= 0) return;

  const current = active.currentFrameIndex ?? 0;
  const next = Math.max(0, Math.min(current + delta, total - 1));
  active.goToFrame(next);

  syncPlayPauseIcon();
  syncTopbarPlayPauseIcon();
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
  selStationHidroA,
  selStationClimaA,
  selStationHidroB,
  selStationClimaB,
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
  ndviChartContainer?.classList.add('hidden');
  body.classList.remove('sidebar-collapsed');
  syncSidebarState();
  toggleModeBanner('flood-risk', true);
});

document.addEventListener('floodRiskModeDeactivated', () => {
  floodRiskMode.exitFloodRiskMode();
  ndviChartContainer?.classList.remove('hidden');
  showChartPlaceholderA();
  toggleModeBanner('flood-risk', false);
});

// Inicializar inundacionesMode
inundacionesMode.initInundacionesMode({
  map,
  toggleInundacionesModeButton,
  inundacionesModeHint,
});

document.addEventListener('inundacionesModeActivated', () => {
  inundacionesMode.enterInundacionesMode();
  normalMode.clearNormalMode();
  ndviChartContainer?.classList.add('hidden');
  body.classList.remove('sidebar-collapsed');
  syncSidebarState();
  toggleModeBanner('inundaciones', true);
});

document.addEventListener('inundacionesModeDeactivated', () => {
  inundacionesMode.exitInundacionesMode();
  ndviChartContainer?.classList.remove('hidden');
  showChartPlaceholderA();
  toggleModeBanner('inundaciones', false);
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
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  const icon = document.getElementById('playerPlayIcon');
  setLucideIcon(icon, active?.isPlaying ? 'pause' : 'play');
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

  syncExportButton();
});

// ---------------------------------------------------------------------------
// Listener: play/pause
// ---------------------------------------------------------------------------

playerPlayPauseBtn?.addEventListener('click', () => {
  const active = getActivePlayer();
  if (!active) return;
  if (active.isPlaying) {
    active.pause();
  } else {
    active.play();
  }
  syncPlayPauseIcon();
});

playerStepPrevBtn?.addEventListener('click', () => {
  stepActivePlayer(-1);
});

playerStepNextBtn?.addEventListener('click', () => {
  stepActivePlayer(1);
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
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  const icon = document.getElementById('topbar-play-icon');
  setLucideIcon(icon, active?.isPlaying ? 'pause' : 'play');
}

topbarPlayPauseBtn?.addEventListener('click', () => {
  const active = getActivePlayer();
  if (!active) return;
  if (active.isPlaying) {
    active.pause();
  } else {
    active.play();
  }
  syncPlayPauseIcon();
  syncTopbarPlayPauseIcon();
});

topbarStepPrevBtn?.addEventListener('click', () => {
  stepActivePlayer(-1);
});

topbarStepNextBtn?.addEventListener('click', () => {
  stepActivePlayer(1);
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
  stationId: string,
  start: string,
  end: string
): Promise<void> {
  try {
    const data = await fetchLocalStationLevel({ stationId, start, end });
    const values =
      data.value || (data.type === 'climatolica' ? data.precip_mm : data.level_m);

    mapState.setSeriesDataForVariable('A', stationId, {
      dates: data.dates,
      values: values,
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

const tflowHidroStation = document.getElementById(
  'tflow-hidroStation'
) as HTMLSelectElement | null;
const tflowHidroYear = document.getElementById(
  'tflow-hidroYear'
) as HTMLSelectElement | null;
const tflowHidroSeason = document.getElementById(
  'tflow-hidroSeason'
) as HTMLSelectElement | null;
const tflowBtnLocalHidro = document.getElementById(
  'tflow-btnLocalHidro'
) as HTMLButtonElement | null;

const tflowClimaStation = document.getElementById(
  'tflow-climaStation'
) as HTMLSelectElement | null;
const tflowClimaYear = document.getElementById(
  'tflow-climaYear'
) as HTMLSelectElement | null;
const tflowClimaSeason = document.getElementById(
  'tflow-climaSeason'
) as HTMLSelectElement | null;
const tflowBtnLocalClima = document.getElementById(
  'tflow-btnLocalClima'
) as HTMLButtonElement | null;

// ---------------------------------------------------------------------------
// Listeners de estaciones locales (año + temporada)
// ---------------------------------------------------------------------------

function wireTflowStationGroup(
  stationSel: HTMLSelectElement | null,
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
  btn: HTMLButtonElement | null
): void {
  if (!stationSel || !yearSel || !seasonSel || !btn) return;

  // Clear and disable year/season by default
  yearSel.disabled = true;
  seasonSel.disabled = true;
  btn.disabled = true;

  // Populate seasons once
  while (seasonSel.options.length > 1) seasonSel.remove(1);
  for (const s of SEASONS) {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    seasonSel.appendChild(opt);
  }

  // Populate years once
  const years = VARIABLE_YEARS.local_sp; // All local stations use 2000-2024 range
  while (yearSel.options.length > 1) yearSel.remove(1);
  for (const year of years) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    yearSel.appendChild(opt);
  }

  stationSel.addEventListener('change', () => {
    const hasStation = Boolean(stationSel.value);
    yearSel.disabled = !hasStation;
    if (!hasStation) {
      yearSel.value = '';
      seasonSel.value = '';
      seasonSel.disabled = true;
    }
    btn.disabled = !stationSel.value || !yearSel.value || !seasonSel.value;
  });

  yearSel.addEventListener('change', () => {
    const hasYear = Boolean(yearSel.value);
    seasonSel.disabled = !hasYear;
    if (!hasYear) {
      seasonSel.value = '';
    }
    btn.disabled = !stationSel.value || !yearSel.value || !seasonSel.value;
  });

  seasonSel.addEventListener('change', () => {
    btn.disabled = !stationSel.value || !yearSel.value || !seasonSel.value;
  });

  btn.addEventListener('click', () => {
    const stationId = stationSel.value;
    const year = Number(yearSel.value);
    const season = seasonSel.value as Season;
    if (!stationId || !year || !season) {
      showFieldError(btn, 'Seleccioná estación, año y temporada antes de continuar.');
      return;
    }
    const { start, end } = seasonToDates(year, season);
    void requestLocalStationLevel(stationId, start, end);
  });
}

wireTflowStationGroup(
  tflowHidroStation,
  tflowHidroYear,
  tflowHidroSeason,
  tflowBtnLocalHidro
);
wireTflowStationGroup(
  tflowClimaStation,
  tflowClimaYear,
  tflowClimaSeason,
  tflowBtnLocalClima
);

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
const modeBannerInundaciones = document.getElementById(
  'modeBannerInundaciones'
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
  mode: 'compare' | 'flood-risk' | 'inundaciones',
  visible: boolean
): void {
  let banner = null;
  if (mode === 'compare') {
    banner = modeBannerCompare;
  } else if (mode === 'flood-risk') {
    banner = modeBannerFloodRisk;
  } else if (mode === 'inundaciones') {
    banner = modeBannerInundaciones;
  }
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
let themeTransitionTimer: number | null = null;
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isDark = isDarkModeActive();
    const nextTheme = isDark ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', nextTheme);

    if (themeTransitionTimer !== null) {
      window.clearTimeout(themeTransitionTimer);
    }

    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('theme-change'));
    });

    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
      themeTransitionTimer = null;
    }, 320);
  });
}

// ---------------------------------------------------------------------------
// Export bundle
// ---------------------------------------------------------------------------

const btnExportAnalysis = document.getElementById(
  'btnExportAnalysis'
) as HTMLButtonElement | null;

/**
 * Determina si hay datos de serie cargados para exportar.
 */
function canExport(): boolean {
  const seriesA = mapState.getSeriesDataA();
  const hasSeriesA = Object.keys(seriesA).some(
    k => (seriesA[k as VariableKey]?.values?.length ?? 0) > 0
  );
  return hasSeriesA;
}

function collectGifPathsForNormalMode(): string[] {
  const series = mapState.getSeriesDataA();
  const gifPathsByVariable = mapState.getGifPathsA();

  const gifPaths: string[] = [];
  for (const key of Object.keys(series) as VariableKey[]) {
    if (!series[key] || series[key]!.values.length === 0) continue;
    const gifPath = gifPathsByVariable[key];
    if (gifPath) gifPaths.push(gifPath);
  }
  return gifPaths;
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

  const seriesData = mapState.getSeriesDataA();

  // Recopilar rutas de GIFs activos del panel normal
  const gifPaths = collectGifPathsForNormalMode();

  createProgressIndicator();
  updateProgressIndicator(10, 'Generando exportación...');

  try {
    updateProgressIndicator(30, 'Obteniendo ZIP del servidor...');
    const zipBlob = await exportBundle({
      gifPaths,
      seriesData,
      bbox,
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

// Inicializar catálogo y cargadores dinámicos de estaciones locales
void initializeLocalStations();
