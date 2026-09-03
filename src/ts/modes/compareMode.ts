/**
 * Módulo de modo comparativa — distributionMapApp.
 *
 * Encapsula toda la lógica de negocio del modo comparativa (paneles A y B):
 * - Entrada/salida del modo comparativa
 * - Generación de GIF + serie temporal por panel
 * - Sincronización de players
 * - Limpieza de paneles
 *
 * Phase D: extraído de main.ts. No contiene lógica de flood risk mode.
 * Cualquier lógica compartida con normal mode se resuelve vía import de normalMode.
 */

import type { BBox, VariableKey, Season } from '../types.js';
import * as mapState from '../state/mapState.js';
import {
  fetchGifAndSeriesForPanel,
  createProgressEventSource,
  extractTimeseriesValues,
} from '../apiClient.js';
import {
  switchColorbar,
  removeActiveOverlay,
  setActiveOverlay,
  municipalFloodOverlays,
} from '../map/overlays.js';
import {
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
  showErrorModal,
  showWarningModal,
  closeWarningModal,
} from '../ui/progress.js';
import { showFieldError } from '../ui/fieldErrors.js';
import { initLucideIcons } from '../ui/icons.js';
import { translateBackendError } from '../errorMap.js';
import { plotAllSelectedSeries } from '../ui/chart.js';
import { GifPlayer, SyncPlayer, SoloPlayer } from '../ui/gifPlayer.js';
import { setLucideIcon } from '../ui/icons.js';
import * as normalMode from './normalMode.js';
import { VARIABLE_YEARS, SEASONS } from '../config.js';
import { bdctbForecastAction } from '../ui/bdctbForecast.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
declare const L: typeof import('leaflet');

// ---------------------------------------------------------------------------
// Referencias DOM inyectadas desde main.ts
// ---------------------------------------------------------------------------

/** Referencia al mapa principal (inyectada desde main.ts). */
let _mapRef: L.Map | null = null;

/** Marcadores de estaciones en mapa principal y mapa B. */
let _stationMarkersMap: L.Marker[] = [];
let _stationMarkersMapB: L.Marker[] = [];

/** Controles del player (compartidos con normalMode). */
let _playerControlsDiv: HTMLElement | null = null;
let _playerSlider: HTMLInputElement | null = null;
let _playerFrameLabel: HTMLSpanElement | null = null;
let _playerPlayIcon: Element | null = null;
let _playerSpeedSelect: HTMLSelectElement | null = null;

/** Divs de gráficas (panel A normal y panel B comparativa). */
let _ndviChartDiv: HTMLElement | null = null;
let _chartBDiv: HTMLElement | null = null;

/** UI de modo comparativa. */
let _chartBContainer: HTMLElement | null = null;

/** Selectores de comparativa — panel A. */
let _compareVarASelect: HTMLSelectElement | null = null;
let _compareYearASelect: HTMLSelectElement | null = null;
let _compareSeasonASelect: HTMLSelectElement | null = null;
let _btnGenerateA: HTMLButtonElement | null = null;

/** Selectores de comparativa — panel B. */
let _compareVarBSelect: HTMLSelectElement | null = null;
let _compareYearBSelect: HTMLSelectElement | null = null;
let _compareSeasonBSelect: HTMLSelectElement | null = null;
let _btnGenerateB: HTMLButtonElement | null = null;

/** Selectores de estaciones en modo comparativa. */
let _selStationHidroA: HTMLSelectElement | null = null;
let _selStationClimaA: HTMLSelectElement | null = null;
let _selStationHidroB: HTMLSelectElement | null = null;
let _selStationClimaB: HTMLSelectElement | null = null;

/** PR2: Callback para actualizar la etiqueta de fecha en el overlay del mapa. */
let _onDateLabelUpdate: ((frameIdx: number) => void) | undefined = undefined;

// ---------------------------------------------------------------------------
// Interfaz pública del módulo
// ---------------------------------------------------------------------------

export interface CompareModeDomRefs {
  map: L.Map;
  stationMarkersMap: L.Marker[];
  stationMarkersMapB: L.Marker[];
  playerControlsDiv: HTMLElement | null;
  playerSlider: HTMLInputElement | null;
  playerFrameLabel: HTMLSpanElement | null;
  playerPlayIcon: Element | null;
  playerSpeedSelect: HTMLSelectElement | null;
  ndviChartDiv: HTMLElement | null;
  chartBDiv: HTMLElement | null;
  compareControlsA: HTMLElement | null;
  compareModeHint: HTMLElement | null;
  chartBContainer: HTMLElement | null;
  compareVarASelect: HTMLSelectElement | null;
  compareYearASelect: HTMLSelectElement | null;
  compareSeasonASelect: HTMLSelectElement | null;
  btnGenerateA: HTMLButtonElement | null;
  compareVarBSelect: HTMLSelectElement | null;
  compareYearBSelect: HTMLSelectElement | null;
  compareSeasonBSelect: HTMLSelectElement | null;
  btnGenerateB: HTMLButtonElement | null;
  selStationHidroA: HTMLSelectElement | null;
  selStationClimaA: HTMLSelectElement | null;
  selStationHidroB: HTMLSelectElement | null;
  selStationClimaB: HTMLSelectElement | null;
  onDateLabelUpdate?: (frameIdx: number) => void;
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

/**
 * Inicializa las referencias del módulo al DOM y al mapa.
 * Debe llamarse desde main.ts al arrancar, antes de cualquier interacción.
 */
export function initCompareMode(domRefs: CompareModeDomRefs): void {
  _mapRef = domRefs.map;
  _stationMarkersMap = domRefs.stationMarkersMap;
  _stationMarkersMapB = domRefs.stationMarkersMapB;
  _playerControlsDiv = domRefs.playerControlsDiv;
  _playerSlider = domRefs.playerSlider;
  _playerFrameLabel = domRefs.playerFrameLabel;
  _playerPlayIcon = domRefs.playerPlayIcon;
  _playerSpeedSelect = domRefs.playerSpeedSelect;
  _ndviChartDiv = domRefs.ndviChartDiv;
  _chartBDiv = domRefs.chartBDiv;
  _chartBContainer = domRefs.chartBContainer;
  _compareVarASelect = domRefs.compareVarASelect;
  _compareYearASelect = domRefs.compareYearASelect;
  _compareSeasonASelect = domRefs.compareSeasonASelect;
  _btnGenerateA = domRefs.btnGenerateA;
  _compareVarBSelect = domRefs.compareVarBSelect;
  _compareYearBSelect = domRefs.compareYearBSelect;
  _compareSeasonBSelect = domRefs.compareSeasonBSelect;
  _btnGenerateB = domRefs.btnGenerateB;
  _selStationHidroA = domRefs.selStationHidroA;
  _selStationClimaA = domRefs.selStationClimaA;
  _selStationHidroB = domRefs.selStationHidroB;
  _selStationClimaB = domRefs.selStationClimaB;
  _onDateLabelUpdate = domRefs.onDateLabelUpdate ?? undefined;
}

// ---------------------------------------------------------------------------
// Helpers internos — player controls
// ---------------------------------------------------------------------------

function showPlayerControls(): void {
  _playerControlsDiv?.classList.remove('hidden');
}

function hidePlayerControls(): void {
  _playerControlsDiv?.classList.add('hidden');
}

function onPlayerFrameChange(current: number, total: number): void {
  if (_playerSlider) {
    _playerSlider.max = String(total - 1);
    _playerSlider.value = String(current);
  }
  if (_playerFrameLabel) {
    _playerFrameLabel.textContent = `${current + 1} / ${total}`;
  }
  // PR2: Update date label with current frame's season/year
  _onDateLabelUpdate?.(current);
}

function syncPlayPauseIcon(): void {
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  const playerIcon = _playerPlayIcon?.id
    ? document.getElementById(_playerPlayIcon.id)
    : _playerPlayIcon;
  setLucideIcon(playerIcon, active?.isPlaying ? 'pause' : 'play');
}

function _selectedInterval(): number {
  return Number(_playerSpeedSelect?.value ?? '1000') || 1000;
}

// ---------------------------------------------------------------------------
// Helpers internos — station markers
// ---------------------------------------------------------------------------

function _setMarkersVisible(
  markers: L.Marker[],
  targetMap: L.Map,
  visible: boolean
): void {
  for (const m of markers) {
    if (visible && !targetMap.hasLayer(m)) {
      m.addTo(targetMap);
    } else if (!visible && targetMap.hasLayer(m)) {
      targetMap.removeLayer(m);
    }
  }
}

function _updateStationMarkersVisibility(): void {
  const showOnMap =
    !mapState.getOverlayA() && Object.keys(municipalFloodOverlays).length === 0;
  _setMarkersVisible(_stationMarkersMap, _mapRef!, showOnMap);
  if (mapState.getMapB()) {
    _setMarkersVisible(
      _stationMarkersMapB,
      mapState.getMapB()!,
      !mapState.getOverlayB()
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers internos — mapB
// ---------------------------------------------------------------------------

/**
 * Inicializa mapB la primera vez que se activa el modo comparativa.
 */
export function initMapB(): void {
  if (mapState.getMapB()) return;

  const newMapB = L.map('map-b', { zoomControl: false }).setView(
    _mapRef!.getCenter(),
    _mapRef!.getZoom()
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(newMapB);

  newMapB.on('popupopen', (e) => {
    const container = e.popup.getElement();
    if (container) {
      initLucideIcons(container);
    }
  });

  newMapB.on('moveend', () => {
    if (mapState.getMapBSyncLock() || !mapState.getMapB()) return;
    mapState.setMapBSyncLock(true);
    _mapRef!.setView(mapState.getMapB()!.getCenter(), mapState.getMapB()!.getZoom(), {
      animate: false,
    });
    mapState.setMapBSyncLock(false);
  });

  // Copia el sync de map A → map B (solo uno es necesario ya que el segundo
  // ya synchronized el primero al segundo; evitamos loop infinito)
  _mapRef!.on('moveend', () => {
    if (mapState.getMapBSyncLock() || !mapState.getMapB()) return;
    mapState.setMapBSyncLock(true);
    mapState
      .getMapB()!
      .setView(_mapRef!.getCenter(), _mapRef!.getZoom(), { animate: false });
    mapState.setMapBSyncLock(false);
  });

  // Iconos personalizados con SVG para el mapa B
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

  const waveIconB = L.divIcon({
    html: `<div class="station-icon station-icon-hidro">${waveSvg}</div>`,
    className: 'custom-station-icon',
    iconSize: [28, 28],
    iconAnchor: [30, 14], // Desplazado 16px a la izquierda
    popupAnchor: [-16, -14], // Popup alineado con el icono desplazado
  });

  const dropIconB = L.divIcon({
    html: `<div class="station-icon station-icon-clima">${dropSvg}</div>`,
    className: 'custom-station-icon',
    iconSize: [28, 28],
    iconAnchor: [-2, 14], // Desplazado 16px a la derecha
    popupAnchor: [16, -14], // Popup alineado con el icono desplazado
  });

  // Añadir marcadores de estaciones al mapa B
  const localStations = mapState.getLocalStations() || {};
  for (const [id, info] of Object.entries(localStations)) {
    if (info.coords && info.coords.length === 2) {
      const [lat, lon] = info.coords;
      const isHidro = info.type === 'hidrometrica' || id.endsWith('_hidro');
      const icon = isHidro ? waveIconB : dropIconB;
      const badgeClass = isHidro ? 'station-badge-hidro' : 'station-badge-clima';
      const badgeLabel = isHidro
        ? '<span data-lucide="waves" style="width: 12px; height: 12px;"></span> Hidro'
        : '<span data-lucide="droplet" style="width: 12px; height: 12px;"></span> Clima';
      const metricDesc = isHidro ? 'Nivel del río' : 'Precipitación';
      const marker = L.marker(L.latLng(lat, lon), { icon })
        .bindPopup(
          `<div class="station-popup-content">` +
            `<div class="station-popup-header">` +
              `<span class="station-badge ${badgeClass}">${badgeLabel}</span>` +
            `</div>` +
            `<h3 class="station-popup-title">${info.station_name || info.name}</h3>` +
            `<div class="station-popup-meta">` +
              `<span class="station-popup-meta-item"><span data-lucide="map-pin" style="width: 12px; height: 12px;"></span> ${info.municipio || 'Sin Municipio'}</span>` +
              `<span class="station-popup-meta-item"><span data-lucide="line-chart" style="width: 12px; height: 12px;"></span> ${metricDesc}</span>` +
            `</div>` +
            `<a href="#" class="station-popup-btn station-full-data-link" data-station-id="${id}">` +
              `Ver datos 2000–2024` +
            `</a>` +
            bdctbForecastAction(id, isHidro) +
          `</div>`
        )
        .addTo(newMapB);
      _stationMarkersMapB.push(marker);
    }
  }

  mapState.setMapB(newMapB);
}

export function clearMapBOverlay(): void {
  const overlayB = mapState.getOverlayB();
  const mapB = mapState.getMapB();
  if (overlayB && mapB) {
    mapB.removeLayer(overlayB);
    mapState.setOverlayB(null);
  }
}

// ---------------------------------------------------------------------------
// Cleanup de paneles
// ---------------------------------------------------------------------------

/**
 * Limpia todos los players y overlays activos del modo comparativa.
 */
export function cleanupComparePanels(): void {
  normalMode.stopSoloPlayer();
  normalMode.stopSyncPlayer();
  mapState.getGifPlayerA()?.dispose();
  mapState.setGifPlayerA(null);
  mapState.getGifPlayerB()?.dispose();
  mapState.setGifPlayerB(null);
  mapState.setOverlayA(null);
  mapState.setActiveGifPathA(null);
  mapState.setActiveGifPathB(null);
  mapState.clearGifPathsA();
  mapState.clearGifPathsB();
  removeActiveOverlay(_mapRef!);
  clearMapBOverlay();
  _updateStationMarkersVisibility();
}

/**
 * Limpia solo el panel A (animación + gráfica) sin tocar el panel B.
 */
export function clearPanelA(): void {
  normalMode.stopSyncPlayer();
  mapState.getGifPlayerA()?.dispose();
  mapState.setGifPlayerA(null);
  mapState.setOverlayA(null);
  mapState.setActiveGifPathA(null);
  removeActiveOverlay(_mapRef!);
  switchColorbar(_mapRef!, null, mapState.getMapB() ?? undefined);
  mapState.clearSeriesDataA();
  mapState.clearGifPathsA();
  if (_ndviChartDiv) Plotly.purge(_ndviChartDiv as HTMLDivElement);
  hidePlayerControls();
  if (_compareYearASelect) _compareYearASelect.value = '';
  if (_compareSeasonASelect) {
    _compareSeasonASelect.value = '';
    _compareSeasonASelect.disabled = true;
  }
  if (_btnGenerateA) _btnGenerateA.disabled = true;
  if (_selStationHidroA) _selStationHidroA.value = '';
  if (_selStationClimaA) _selStationClimaA.value = '';
  _updateStationMarkersVisibility();
}

/**
 * Limpia solo el panel B (animación + gráfica) sin tocar el panel A.
 */
export function clearPanelB(): void {
  normalMode.stopSyncPlayer();
  normalMode.stopSoloPlayer();
  mapState.getGifPlayerB()?.dispose();
  mapState.setGifPlayerB(null);
  mapState.setActiveGifPathB(null);
  clearMapBOverlay();
  switchColorbar(_mapRef!, null, mapState.getMapB() ?? undefined);
  mapState.clearSeriesDataB();
  mapState.clearGifPathsB();
  if (_chartBDiv) Plotly.purge(_chartBDiv as HTMLDivElement);
  hidePlayerControls();
  if (_compareYearBSelect) _compareYearBSelect.value = '';
  if (_compareSeasonBSelect) {
    _compareSeasonBSelect.value = '';
    _compareSeasonBSelect.disabled = true;
  }
  if (_btnGenerateB) _btnGenerateB.disabled = true;
  if (_selStationHidroB) _selStationHidroB.value = '';
  if (_selStationClimaB) _selStationClimaB.value = '';
  _updateStationMarkersVisibility();
}

// ---------------------------------------------------------------------------
// Helpers internos — selectores
// ---------------------------------------------------------------------------

function _populateYearSelect(sel: HTMLSelectElement | null, years: number[]): void {
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  for (const year of years) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    sel.appendChild(opt);
  }
}

function _ensureSeasonOptions(sel: HTMLSelectElement | null): void {
  if (!sel || sel.options.length > 1) return;
  for (const s of SEASONS) {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
}

export function initCompareSelects(): void {
  const varA = (_compareVarASelect?.value ?? 'ndvi') as Exclude<
    VariableKey,
    'local_sp' | 'local_bd'
  >;
  const varB = (_compareVarBSelect?.value ?? 'ndvi') as Exclude<
    VariableKey,
    'local_sp' | 'local_bd'
  >;

  const yearsA = VARIABLE_YEARS[varA] || [];
  _populateYearSelect(_compareYearASelect, yearsA);

  const yearsB = VARIABLE_YEARS[varB] || [];
  _populateYearSelect(_compareYearBSelect, yearsB);

  _ensureSeasonOptions(_compareSeasonASelect);
  _ensureSeasonOptions(_compareSeasonBSelect);
}

function _wireCompareSelectPair(
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
  btn: HTMLButtonElement | null,
  panel: 'A' | 'B'
): void {
  if (!yearSel || !seasonSel || !btn) return;

  const sync = (): void => {
    btn.disabled = !yearSel.value || !seasonSel.value;
  };

  yearSel.addEventListener('change', () => {
    const hasYear = Boolean(yearSel.value);
    seasonSel.disabled = !hasYear;
    if (!hasYear) seasonSel.value = '';

    const hidroSel = panel === 'A' ? _selStationHidroA : _selStationHidroB;
    const climaSel = panel === 'A' ? _selStationClimaA : _selStationClimaB;
    if (hidroSel) {
      hidroSel.value = '';
      hidroSel.dispatchEvent(new Event('change'));
    }
    if (climaSel) {
      climaSel.value = '';
      climaSel.dispatchEvent(new Event('change'));
    }

    sync();
  });

  seasonSel.addEventListener('change', () => {
    const hidroSel = panel === 'A' ? _selStationHidroA : _selStationHidroB;
    const climaSel = panel === 'A' ? _selStationClimaA : _selStationClimaB;
    if (hidroSel) {
      hidroSel.value = '';
      hidroSel.dispatchEvent(new Event('change'));
    }
    if (climaSel) {
      climaSel.value = '';
      climaSel.dispatchEvent(new Event('change'));
    }

    sync();
  });
}

// ---------------------------------------------------------------------------
// Registro de listeners de comparativa
// ---------------------------------------------------------------------------

/**
 * Registra todos los listeners de UI del modo comparativa.
 * Debe llamarse desde main.ts durante la inicialización, después de initCompareMode.
 */
export function registerCompareModeListeners(): void {
  // Wire year/season selects
  _wireCompareSelectPair(
    _compareYearASelect,
    _compareSeasonASelect,
    _btnGenerateA,
    'A'
  );
  _wireCompareSelectPair(
    _compareYearBSelect,
    _compareSeasonBSelect,
    _btnGenerateB,
    'B'
  );

  // Cuando cambia la variable en un panel, repoblar su selector de años
  _compareVarASelect?.addEventListener('change', () => {
    const sel = _compareVarASelect as HTMLSelectElement;
    const v = (sel.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;

    const years = VARIABLE_YEARS[v] || [];

    _populateYearSelect(_compareYearASelect, years);
    if (_compareYearASelect) _compareYearASelect.value = '';
    if (_compareSeasonASelect) {
      _compareSeasonASelect.value = '';
      _compareSeasonASelect.disabled = true;
    }
    if (_btnGenerateA) _btnGenerateA.disabled = true;
  });

  _compareVarBSelect?.addEventListener('change', () => {
    const sel = _compareVarBSelect as HTMLSelectElement;
    const v = (sel.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;

    const years = VARIABLE_YEARS[v] || [];

    _populateYearSelect(_compareYearBSelect, years);
    if (_compareYearBSelect) _compareYearBSelect.value = '';
    if (_compareSeasonBSelect) {
      _compareSeasonBSelect.value = '';
      _compareSeasonBSelect.disabled = true;
    }
    if (_btnGenerateB) _btnGenerateB.disabled = true;
  });

  // Panel A — botón generar
  _btnGenerateA?.addEventListener('click', () => {
    const variable = (_compareVarASelect?.value ?? 'ndvi') as Exclude<
      VariableKey,
      'local_sp' | 'local_bd'
    >;
    const year = Number(_compareYearASelect?.value);
    const season = _compareSeasonASelect?.value as Season | undefined;
    const bbox = mapState.getBbox();

    if (!year || !season) {
      showFieldError(_btnGenerateA!, 'Seleccioná año y temporada para el panel A.');
      return;
    }
    if (!bbox) {
      showFieldError(_btnGenerateA!, 'Dibujá primero un rectángulo en el mapa.');
      return;
    }

    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('A', variable, start, end, bbox);
  });

  // Panel B — botón generar
  _btnGenerateB?.addEventListener('click', () => {
    const variable = (_compareVarBSelect?.value ?? 'ndvi') as Exclude<
      VariableKey,
      'local_sp' | 'local_bd'
    >;
    const year = Number(_compareYearBSelect?.value);
    const season = _compareSeasonBSelect?.value as Season | undefined;
    const bbox = mapState.getBbox();

    if (!year || !season) {
      showFieldError(_btnGenerateB!, 'Seleccioná año y temporada para el panel B.');
      return;
    }
    if (!bbox) {
      showFieldError(_btnGenerateB!, 'Dibujá primero un rectángulo en el mapa.');
      return;
    }

    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('B', variable, start, end, bbox);
  });

  // Botones limpiar

  // Station selects
  _wireCompareStationSelect(
    _selStationHidroA,
    'hidro',
    'A',
    _compareYearASelect,
    _compareSeasonASelect
  );
  _wireCompareStationSelect(
    _selStationClimaA,
    'clima',
    'A',
    _compareYearASelect,
    _compareSeasonASelect
  );
  _wireCompareStationSelect(
    _selStationHidroB,
    'hidro',
    'B',
    _compareYearBSelect,
    _compareSeasonBSelect
  );
  _wireCompareStationSelect(
    _selStationClimaB,
    'clima',
    'B',
    _compareYearBSelect,
    _compareSeasonBSelect
  );

  // Poblar selects de comparativa al iniciar
  initCompareSelects();
}

// ---------------------------------------------------------------------------
// Helpers internos — sync de players
// ---------------------------------------------------------------------------

/**
 * Crea un SyncPlayer cuando ambos paneles tienen GIF cargado.
 * Se llama al terminar de generar cualquiera de los dos paneles.
 */
export function trySyncBothPanels(): void {
  const gifPlayerA = mapState.getGifPlayerA();
  const gifPlayerB = mapState.getGifPlayerB();
  const overlayB = mapState.getOverlayB();
  if (!gifPlayerA || !gifPlayerB || !overlayB) return;

  const overlayA = mapState.getOverlayA();
  if (!overlayA) return;

  // Detener el SoloPlayer que animaba cada panel por separado
  normalMode.stopSoloPlayer();
  normalMode.stopSyncPlayer();

  const syncPlayer = new SyncPlayer();
  syncPlayer.frameIntervalMs = _selectedInterval();
  syncPlayer.onFrameChange = (current, total) => {
    onPlayerFrameChange(current, total);
    syncPlayPauseIcon();
  };
  syncPlayer.start(gifPlayerA, overlayA, gifPlayerB, overlayB);
  mapState.setSyncPlayer(syncPlayer);

  if (_playerSlider) {
    _playerSlider.max = String(
      Math.max(gifPlayerA.frameCount, gifPlayerB.frameCount) - 1
    );
    _playerSlider.value = '0';
  }
  showPlayerControls();
  syncPlayPauseIcon();
}

// ---------------------------------------------------------------------------
// Station checkboxes en modo comparativa
// ---------------------------------------------------------------------------

// Importación lazy para evitar dependencia circular con listeners/variableListeners
import { seasonToDates } from '../utils/seasonDates.js';

async function _loadCompareStation(
  stationId: string,
  panel: 'A' | 'B',
  year: string,
  season: string
): Promise<void> {
  const { start, end } = seasonToDates(Number(year), season as Season);
  const { fetchLocalStationLevel } = await import('../apiClient.js');
  try {
    const data = await fetchLocalStationLevel({ stationId, start, end });
    const values =
      data.value || (data.type === 'climatolica' ? data.precip_mm : data.level_m);

    if (panel === 'A') {
      mapState.setSeriesDataForVariable('A', stationId, {
        dates: data.dates,
        values: values,
      });
      if (_ndviChartDiv)
        plotAllSelectedSeries(
          _ndviChartDiv as HTMLDivElement,
          mapState.getSeriesDataA(),
          showChartBContainer,
          hideChartBContainer,
          showChartPlaceholderA,
          hideChartPlaceholderA
        );
    } else {
      mapState.setSeriesDataForVariable('B', stationId, {
        dates: data.dates,
        values: values,
      });
      if (_chartBDiv)
        plotAllSelectedSeries(
          _chartBDiv as HTMLDivElement,
          mapState.getSeriesDataB(),
          showChartBContainer,
          hideChartBContainer,
          showChartPlaceholderB,
          hideChartPlaceholderB
        );
    }
  } catch (err) {
    console.error(err);
    showErrorModal(
      'Error de red',
      'No se pudo cargar la serie de la estación. Verificá tu conexión.'
    );
  }
}

function _wireCompareStationSelect(
  sel: HTMLSelectElement | null,
  type: 'hidro' | 'clima',
  panel: 'A' | 'B',
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null
): void {
  if (!sel) return;

  sel.addEventListener('change', () => {
    // 1. Clean up any existing station of this type from the state
    const suffix = `_${type}`;
    const activeSeries =
      panel === 'A' ? mapState.getSeriesDataA() : mapState.getSeriesDataB();
    for (const key of Object.keys(activeSeries)) {
      if (key.endsWith(suffix)) {
        mapState.deleteSeriesDataForVariable(panel, key);
      }
    }

    const stationId = sel.value;
    if (stationId) {
      const year = yearSel?.value ?? '';
      const season = seasonSel?.value ?? '';
      if (!year || !season) {
        showFieldError(
          sel,
          'Seleccioná año y temporada del panel antes de cargar la estación.'
        );
        sel.value = '';
        return;
      }
      void _loadCompareStation(stationId, panel, year, season);
    } else {
      // Re-render chart to reflect deletion
      if (panel === 'A') {
        if (_ndviChartDiv)
          plotAllSelectedSeries(
            _ndviChartDiv as HTMLDivElement,
            mapState.getSeriesDataA(),
            showChartBContainer,
            hideChartBContainer,
            showChartPlaceholderA,
            hideChartPlaceholderA
          );
      } else {
        if (_chartBDiv)
          plotAllSelectedSeries(
            _chartBDiv as HTMLDivElement,
            mapState.getSeriesDataB(),
            showChartBContainer,
            hideChartBContainer,
            showChartPlaceholderB,
            hideChartPlaceholderB
          );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Chart helpers (compare mode)
// ---------------------------------------------------------------------------

function showChartBContainer(): void {
  _chartBContainer?.classList.remove('hidden');
}

function hideChartBContainer(): void {
  // En compare mode el chart B siempre permanece visible
  return;
}

function renderChart(): void {
  if (!_ndviChartDiv) return;
  plotAllSelectedSeries(
    _ndviChartDiv as HTMLDivElement,
    mapState.getSeriesDataA(),
    showChartBContainer,
    hideChartBContainer,
    showChartPlaceholderA,
    hideChartPlaceholderA
  );
}

function showChartPlaceholderA(): void {
  const placeholder = document.getElementById('chartPlaceholderA');
  placeholder?.classList.remove('chart-placeholder--hidden');
}

function hideChartPlaceholderA(): void {
  const placeholder = document.getElementById('chartPlaceholderA');
  placeholder?.classList.add('chart-placeholder--hidden');
}

function renderChartB(): void {
  if (!_chartBDiv) return;
  plotAllSelectedSeries(
    _chartBDiv as HTMLDivElement,
    mapState.getSeriesDataB(),
    showChartBContainer,
    hideChartBContainer,
    showChartPlaceholderB,
    hideChartPlaceholderB
  );
}

function showChartPlaceholderB(): void {
  const placeholder = document.getElementById('chartPlaceholderB');
  placeholder?.classList.remove('chart-placeholder--hidden');
}

function hideChartPlaceholderB(): void {
  const placeholder = document.getElementById('chartPlaceholderB');
  placeholder?.classList.add('chart-placeholder--hidden');
}

// ---------------------------------------------------------------------------
// Generación de GIF + serie temporal — modo comparativa
// ---------------------------------------------------------------------------

/**
 * Genera animación GIF y serie temporal para un panel específico (A o B)
 * en modo comparativa.
 *
 * Maneja el flujo completo: progress SSE, loading, creación de players,
 * renderizado de overlay y gráfica.
 *
 * @param panel     'A' o 'B'
 * @param variable  Variable hidrometeorológica
 * @param start     Fecha inicio ISO
 * @param end       Fecha fin ISO
 * @param bbox      Bounding box [minLon, minLat, maxLon, maxLat]
 */
export async function requestGifAndSeriesForPanel(
  panel: 'A' | 'B',
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox
): Promise<void> {
  mapState.setCurrentVariable(variable);

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  createProgressIndicator();

  let sseMessagesReceived = 0;

  const eventSource = createProgressEventSource(
    taskId,
    (progress, message) => {
      sseMessagesReceived++;
      if (progress > 0) {
        closeWarningModal();
      }
      // Mapear el progreso del servidor (0-100) a 0-90% para reservar el último 10%
      const mappedProgress =
        progress >= 0 ? Math.min(90, Math.round(progress * 0.9)) : -1;
      updateProgressIndicator(mappedProgress, message);
      if (progress === 100 || progress === -1) {
        eventSource.close();
        if (progress === -1) {
          removeProgressIndicator(3000);
        }
      }
    },
    () => {
      closeWarningModal();
      eventSource.close();
    }
  );

  // Watchdog timer para detectar conexión lenta o procesamiento largo
  const connectionWatchdog = setTimeout(() => {
    if (!navigator.onLine) {
      showWarningModal(
        'Sin conexión',
        'La conexión a internet parece estar inactiva. Verificá tu red.'
      );
    } else if (eventSource.readyState === 0) {
      showWarningModal(
        'Conexión lenta',
        'La conexión con el servidor está tardando más de lo normal. Esperando respuesta...'
      );
    } else if (eventSource.readyState === 1 && sseMessagesReceived <= 1) {
      showWarningModal(
        'Procesando en GEE',
        'El servidor está procesando la solicitud en Google Earth Engine (esto puede demorar en variables complejas).'
      );
    }
  }, 15000);

  try {
    const { gifData, tsData } = await fetchGifAndSeriesForPanel({
      variable,
      start,
      end,
      bbox,
      taskId,
    });

    clearTimeout(connectionWatchdog);
    closeWarningModal();

    if (gifData.error) {
      removeProgressIndicator(0);
      const uxError = translateBackendError(gifData.error);
      showErrorModal(uxError.title, uxError.message);
      return;
    }

    updateProgressIndicator(
      93,
      `Descargando y decodificando animación (panel ${panel})...`
    );

    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(
      L.latLng(minLat, minLon),
      L.latLng(maxLat, maxLon)
    );

    // Parar toda reproducción antes de modificar cualquier panel
    normalMode.stopSoloPlayer();
    normalMode.stopSyncPlayer();
    hidePlayerControls();

    if (panel === 'A') {
      // Liberar recursos anteriores del panel A
      mapState.getGifPlayerA()?.dispose();
      mapState.setGifPlayerA(null);
      mapState.setOverlayA(null);
      removeActiveOverlay(_mapRef!);

      const player = new GifPlayer();
      await player.load(gifData.gifUrl);

      updateProgressIndicator(97, 'Renderizando panel A...');

      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, {
        opacity: 0.8,
      }).addTo(_mapRef!);
      setActiveOverlay(overlay);
      const mapB = mapState.getMapB();
      if (mapB) switchColorbar(mapB, variable, _mapRef!);
      _mapRef!.fitBounds(overlayBounds);

      mapState.setGifPlayerA(player);
      mapState.setOverlayA(overlay);
      mapState.setActiveGifPathA(gifData.gifUrl);
      mapState.setGifPathForVariable('A', variable, gifData.gifUrl);
      _updateStationMarkersVisibility();

      // Animar panel A de forma independiente hasta que llegue el panel B
      const soloPlayer = new SoloPlayer();
      soloPlayer.frameIntervalMs = _selectedInterval();
      soloPlayer.onFrameChange = (current, total) => {
        onPlayerFrameChange(current, total);
        syncPlayPauseIcon();
      };
      soloPlayer.start(player, overlay);
      mapState.setSoloPlayer(soloPlayer);

      if (_playerSlider) {
        _playerSlider.max = String(player.frameCount - 1);
        _playerSlider.value = '0';
      }
      showPlayerControls();
      syncPlayPauseIcon();

      if (tsData) {
        const extracted = extractTimeseriesValues(tsData, variable);
        if (extracted) {
          mapState.setSeriesDataForVariable('A', variable, extracted);
          renderChart();
        }
      } else {
        console.warn('Error en serie temporal panel A.');
      }
    } else {
      // Panel B
      mapState.getGifPlayerB()?.dispose();
      mapState.setGifPlayerB(null);
      clearMapBOverlay();

      const player = new GifPlayer();
      await player.load(gifData.gifUrl);

      updateProgressIndicator(97, 'Renderizando panel B...');

      const mapB = mapState.getMapB()!;
      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, {
        opacity: 0.8,
      }).addTo(mapB);
      mapState.setOverlayB(overlay);
      _updateStationMarkersVisibility();
      switchColorbar(mapB, variable, _mapRef!);
      mapB.fitBounds(overlayBounds);
      setTimeout(
        () =>
          mapB.setView(_mapRef!.getCenter(), _mapRef!.getZoom(), { animate: false }),
        100
      );

      mapState.setGifPlayerB(player);
      mapState.setActiveGifPathB(gifData.gifUrl);
      mapState.setGifPathForVariable('B', variable, gifData.gifUrl);

      if (tsData) {
        const extractedB = extractTimeseriesValues(tsData, variable);
        if (extractedB) {
          mapState.setSeriesDataForVariable('B', variable, {
            dates: extractedB.dates,
            values: extractedB.values,
          });
          renderChartB();
        }
      } else {
        console.warn('Error en serie temporal panel B.');
      }
    }

    // Si ambos paneles tienen GIF → sincronizar
    trySyncBothPanels();

    updateProgressIndicator(100, '¡Listo!');
    removeProgressIndicator(500);
  } catch (err) {
    console.error(err);
    removeProgressIndicator(0);
    showErrorModal(
      'Error de red',
      `No se pudo generar la animación / serie temporal (panel ${panel}). Verificá tu conexión.`
    );
  } finally {
    clearTimeout(connectionWatchdog);
    closeWarningModal();
    eventSource.close();
  }
}
