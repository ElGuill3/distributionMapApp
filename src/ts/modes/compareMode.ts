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
  buildColorbars,
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
} from '../ui/progress.js';
import { showFieldError } from '../ui/fieldErrors.js';
import { translateBackendError } from '../errorMap.js';
import { plotAllSelectedSeries } from '../ui/chart.js';
import { GifPlayer, SyncPlayer, SoloPlayer } from '../ui/gifPlayer.js';
import * as normalMode from './normalMode.js';
import { VARIABLE_YEARS, SEASONS } from '../config.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
// eslint-disable-next-line @typescript-eslint/no-shadow
declare var L: typeof import('leaflet');

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
let _playerPlayIcon: HTMLSpanElement | null = null;
let _playerSpeedSelect: HTMLSelectElement | null = null;

/** Divs de gráficas (panel A normal y panel B comparativa). */
let _ndviChartDiv: HTMLElement | null = null;
let _chartBDiv: HTMLElement | null = null;

/** UI de modo comparativa. */
let _compareControlsA: HTMLElement | null = null;
let _compareModeHint: HTMLElement | null = null;
let _chartBContainer: HTMLElement | null = null;

/** Selectores de comparativa — panel A. */
let _compareVarASelect: HTMLSelectElement | null = null;
let _compareYearASelect: HTMLSelectElement | null = null;
let _compareSeasonASelect: HTMLSelectElement | null = null;
let _btnGenerateA: HTMLButtonElement | null = null;
let _btnClearA: HTMLButtonElement | null = null;

/** Selectores de comparativa — panel B. */
let _compareVarBSelect: HTMLSelectElement | null = null;
let _compareYearBSelect: HTMLSelectElement | null = null;
let _compareSeasonBSelect: HTMLSelectElement | null = null;
let _btnGenerateB: HTMLButtonElement | null = null;
let _btnClearB: HTMLButtonElement | null = null;

/** Checkboxes de estaciones en modo comparativa. */
let _chkStationSpA: HTMLInputElement | null = null;
let _chkStationBdA: HTMLInputElement | null = null;
let _chkStationSpB: HTMLInputElement | null = null;
let _chkStationBdB: HTMLInputElement | null = null;

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
  playerPlayIcon: HTMLSpanElement | null;
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
  btnClearA: HTMLButtonElement | null;
  compareVarBSelect: HTMLSelectElement | null;
  compareYearBSelect: HTMLSelectElement | null;
  compareSeasonBSelect: HTMLSelectElement | null;
  btnGenerateB: HTMLButtonElement | null;
  btnClearB: HTMLButtonElement | null;
  chkStationSpA: HTMLInputElement | null;
  chkStationBdA: HTMLInputElement | null;
  chkStationSpB: HTMLInputElement | null;
  chkStationBdB: HTMLInputElement | null;
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
  _compareControlsA = domRefs.compareControlsA;
  _compareModeHint = domRefs.compareModeHint;
  _chartBContainer = domRefs.chartBContainer;
  _compareVarASelect = domRefs.compareVarASelect;
  _compareYearASelect = domRefs.compareYearASelect;
  _compareSeasonASelect = domRefs.compareSeasonASelect;
  _btnGenerateA = domRefs.btnGenerateA;
  _btnClearA = domRefs.btnClearA;
  _compareVarBSelect = domRefs.compareVarBSelect;
  _compareYearBSelect = domRefs.compareYearBSelect;
  _compareSeasonBSelect = domRefs.compareSeasonBSelect;
  _btnGenerateB = domRefs.btnGenerateB;
  _btnClearB = domRefs.btnClearB;
  _chkStationSpA = domRefs.chkStationSpA;
  _chkStationBdA = domRefs.chkStationBdA;
  _chkStationSpB = domRefs.chkStationSpB;
  _chkStationBdB = domRefs.chkStationBdB;
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
    _playerSlider.max   = String(total - 1);
    _playerSlider.value = String(current);
  }
  if (_playerFrameLabel) {
    _playerFrameLabel.textContent = `${current + 1} / ${total}`;
  }
}

function syncPlayPauseIcon(): void {
  if (!_playerPlayIcon) return;
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  _playerPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
}

function _selectedInterval(): number {
  return Number(_playerSpeedSelect?.value ?? '1000') || 1000;
}

// ---------------------------------------------------------------------------
// Helpers internos — station markers
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

function _updateStationMarkersVisibility(): void {
  const showOnMap = !mapState.getOverlayA() && Object.keys(municipalFloodOverlays).length === 0;
  _setMarkersVisible(_stationMarkersMap, _mapRef!, showOnMap);
  if (mapState.getMapB()) {
    _setMarkersVisible(_stationMarkersMapB, mapState.getMapB()!, !mapState.getOverlayB());
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

  const newMapB = L.map('map-b', { zoomControl: false }).setView(_mapRef!.getCenter(), _mapRef!.getZoom());

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:     19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(newMapB);

  newMapB.on('moveend', () => {
    if (mapState.getMapBSyncLock() || !mapState.getMapB()) return;
    mapState.setMapBSyncLock(true);
    _mapRef!.setView(mapState.getMapB()!.getCenter(), mapState.getMapB()!.getZoom(), { animate: false });
    mapState.setMapBSyncLock(false);
  });

  // Copia el sync de map A → map B (solo uno es necesario ya que el segundo
  // ya synchronized el primero al segundo; evitamos loop infinito)
  _mapRef!.on('moveend', () => {
    if (mapState.getMapBSyncLock() || !mapState.getMapB()) return;
    mapState.setMapBSyncLock(true);
    mapState.getMapB()!.setView(_mapRef!.getCenter(), _mapRef!.getZoom(), { animate: false });
    mapState.setMapBSyncLock(false);
  });

  // Añadir marcadores de estaciones al mapa B
  const STATION_COORDS: Record<'SPTTB' | 'BDCTB', [number, number]> = {
    SPTTB: [17.791667, -91.158333],
    BDCTB: [17.433333, -91.483333],
  };
  const STATION_LABELS: Record<'SPTTB' | 'BDCTB', string> = {
    SPTTB: 'San Pedro (SPTTB)',
    BDCTB: 'Boca del Cerro (BDCTB)',
  };
  for (const id of (['SPTTB', 'BDCTB'] as const)) {
    const [lat, lon] = STATION_COORDS[id];
    const marker = L.marker(L.latLng(lat, lon))
      .bindPopup(
        `<div class="station-popup-content">` +
        `<b>${STATION_LABELS[id]}</b><br>Estación de nivel local<br>` +
        `<a href="#" class="station-full-data-link" data-station-id="${id}">` +
        `Ver datos 2000–2024</a></div>`,
      )
      .addTo(newMapB);
    _stationMarkersMapB.push(marker);
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
  if (_ndviChartDiv) Plotly.purge(_ndviChartDiv as HTMLDivElement);
  hidePlayerControls();
  if (_compareYearASelect)   _compareYearASelect.value   = '';
  if (_compareSeasonASelect) { _compareSeasonASelect.value = ''; _compareSeasonASelect.disabled = true; }
  if (_btnGenerateA)         _btnGenerateA.disabled = true;
  if (_chkStationSpA) _chkStationSpA.checked = false;
  if (_chkStationBdA) _chkStationBdA.checked = false;
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
  if (_chartBDiv) Plotly.purge(_chartBDiv as HTMLDivElement);
  hidePlayerControls();
  if (_compareYearBSelect)   _compareYearBSelect.value   = '';
  if (_compareSeasonBSelect) { _compareSeasonBSelect.value = ''; _compareSeasonBSelect.disabled = true; }
  if (_btnGenerateB)         _btnGenerateB.disabled = true;
  if (_chkStationSpB) _chkStationSpB.checked = false;
  if (_chkStationBdB) _chkStationBdB.checked = false;
  _updateStationMarkersVisibility();
}

// ---------------------------------------------------------------------------
// Helpers internos — selectores
// ---------------------------------------------------------------------------

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

function _ensureSeasonOptions(sel: HTMLSelectElement | null): void {
  if (!sel || sel.options.length > 1) return;
  for (const s of SEASONS) {
    const opt       = document.createElement('option');
    opt.value       = s.value;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
}

export function initCompareSelects(): void {
  const varA = (_compareVarASelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  const varB = (_compareVarBSelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
  _populateYearSelect(_compareYearASelect, VARIABLE_YEARS[varA]);
  _populateYearSelect(_compareYearBSelect, VARIABLE_YEARS[varB]);
  _ensureSeasonOptions(_compareSeasonASelect);
  _ensureSeasonOptions(_compareSeasonBSelect);
}

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

// ---------------------------------------------------------------------------
// Registro de listeners de comparativa
// ---------------------------------------------------------------------------

/**
 * Registra todos los listeners de UI del modo comparativa.
 * Debe llamarse desde main.ts durante la inicialización, después de initCompareMode.
 */
export function registerCompareModeListeners(): void {
  // Wire year/season selects
  _wireCompareSelectPair(_compareYearASelect, _compareSeasonASelect, _btnGenerateA);
  _wireCompareSelectPair(_compareYearBSelect, _compareSeasonBSelect, _btnGenerateB);

  // Cuando cambia la variable en un panel, repoblar su selector de años
  _compareVarASelect?.addEventListener('change', () => {
    const sel = _compareVarASelect as HTMLSelectElement;
    const v = (sel.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    _populateYearSelect(_compareYearASelect, VARIABLE_YEARS[v]);
    if (_compareYearASelect)   _compareYearASelect.value   = '';
    if (_compareSeasonASelect) { _compareSeasonASelect.value = ''; _compareSeasonASelect.disabled = true; }
    if (_btnGenerateA)         _btnGenerateA.disabled = true;
  });

  _compareVarBSelect?.addEventListener('change', () => {
    const sel = _compareVarBSelect as HTMLSelectElement;
    const v = (sel.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    _populateYearSelect(_compareYearBSelect, VARIABLE_YEARS[v]);
    if (_compareYearBSelect)   _compareYearBSelect.value   = '';
    if (_compareSeasonBSelect) { _compareSeasonBSelect.value = ''; _compareSeasonBSelect.disabled = true; }
    if (_btnGenerateB)         _btnGenerateB.disabled = true;
  });

  // Panel A — botón generar
  _btnGenerateA?.addEventListener('click', () => {
    const variable = (_compareVarASelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    const year     = Number(_compareYearASelect?.value);
    const season   = _compareSeasonASelect?.value as Season | undefined;
    const bbox     = mapState.getBbox();

    if (!year || !season) { showFieldError(_btnGenerateA!, 'Seleccioná año y temporada para el panel A.'); return; }
    if (!bbox)            { showFieldError(_btnGenerateA!, 'Dibujá primero un rectángulo en el mapa.');      return; }

    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('A', variable, start, end, bbox);
  });

  // Panel B — botón generar
  _btnGenerateB?.addEventListener('click', () => {
    const variable = (_compareVarBSelect?.value ?? 'ndvi') as Exclude<VariableKey, 'local_sp' | 'local_bd'>;
    const year     = Number(_compareYearBSelect?.value);
    const season   = _compareSeasonBSelect?.value as Season | undefined;
    const bbox     = mapState.getBbox();

    if (!year || !season) { showFieldError(_btnGenerateB!, 'Seleccioná año y temporada para el panel B.'); return; }
    if (!bbox)            { showFieldError(_btnGenerateB!, 'Dibujá primero un rectángulo en el mapa.');      return; }

    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('B', variable, start, end, bbox);
  });

  // Botones limpiar
  _btnClearA?.addEventListener('click', () => { clearPanelA(); });
  _btnClearB?.addEventListener('click', () => { clearPanelB(); });

  // Station checkboxes
  _wireCompareStationCheck(_chkStationSpA, 'SPTTB', 'A', _compareYearASelect, _compareSeasonASelect);
  _wireCompareStationCheck(_chkStationBdA, 'BDCTB', 'A', _compareYearASelect, _compareSeasonASelect);
  _wireCompareStationCheck(_chkStationSpB, 'SPTTB', 'B', _compareYearBSelect, _compareSeasonBSelect);
  _wireCompareStationCheck(_chkStationBdB, 'BDCTB', 'B', _compareYearBSelect, _compareSeasonBSelect);

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
    _playerSlider.max   = String(Math.max(gifPlayerA.frameCount, gifPlayerB.frameCount) - 1);
    _playerSlider.value = '0';
  }
  showPlayerControls();
  syncPlayPauseIcon();
}

// ---------------------------------------------------------------------------
// Station checkboxes en modo comparativa
// ---------------------------------------------------------------------------

// Importación lazy para evitar dependencia circular con listeners/variableListeners
import { seasonToDates } from '../listeners/variableListeners.js';

async function _loadCompareStation(
  stationId: 'SPTTB' | 'BDCTB',
  panel: 'A' | 'B',
  year: string,
  season: string,
): Promise<void> {
  const { start, end } = seasonToDates(Number(year), season as Season);
  const { fetchLocalStationLevel } = await import('../apiClient.js');
  try {
    const data = await fetchLocalStationLevel({ stationId, start, end });

    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
    if (panel === 'A') {
      mapState.setSeriesDataForVariable('A', key, { dates: data.dates, values: data.level_m });
      if (_ndviChartDiv) plotAllSelectedSeries(_ndviChartDiv as HTMLDivElement, mapState.getSeriesDataA(), showChartBContainer, hideChartBContainer);
    } else {
      mapState.setSeriesDataForVariable('B', key, { dates: data.dates, values: data.level_m });
      if (_chartBDiv) plotAllSelectedSeries(_chartBDiv as HTMLDivElement, mapState.getSeriesDataB(), showChartBContainer, hideChartBContainer);
    }
  } catch (err) {
    console.error(err);
    showErrorModal('Error de red', 'No se pudo cargar la serie de la estación. Verificá tu conexión.');
  }
}

function _wireCompareStationCheck(
  chk: HTMLInputElement | null,
  stationId: 'SPTTB' | 'BDCTB',
  panel: 'A' | 'B',
  yearSel: HTMLSelectElement | null,
  seasonSel: HTMLSelectElement | null,
): void {
  if (!chk) return;

  chk.addEventListener('change', () => {
    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';

    if (chk.checked) {
      const year   = yearSel?.value   ?? '';
      const season = seasonSel?.value ?? '';
      if (!year || !season) {
        showFieldError(chk, 'Seleccioná año y temporada del panel antes de cargar la estación.');
        chk.checked = false;
        return;
      }
      void _loadCompareStation(stationId, panel, year, season);
    } else {
      mapState.deleteSeriesDataForVariable(panel, key);
      if (panel === 'A') {
        if (_ndviChartDiv) plotAllSelectedSeries(_ndviChartDiv as HTMLDivElement, mapState.getSeriesDataA(), showChartBContainer, hideChartBContainer);
      } else {
        if (_chartBDiv) plotAllSelectedSeries(_chartBDiv as HTMLDivElement, mapState.getSeriesDataB(), showChartBContainer, hideChartBContainer);
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
  plotAllSelectedSeries(_ndviChartDiv as HTMLDivElement, mapState.getSeriesDataA(), showChartBContainer, hideChartBContainer);
}

function renderChartB(): void {
  if (!_chartBDiv) return;
  plotAllSelectedSeries(_chartBDiv as HTMLDivElement, mapState.getSeriesDataB(), showChartBContainer, hideChartBContainer);
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
  bbox: BBox,
): Promise<void> {
  mapState.setCurrentVariable(variable);

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  createProgressIndicator();

  const eventSource = createProgressEventSource(
    taskId,
    (progress, message) => {
      updateProgressIndicator(progress, message);
      if (progress === 100 || progress === -1) {
        eventSource.close();
        if (progress === 100) removeProgressIndicator(1000);
        else removeProgressIndicator(3000);
      }
    },
    () => { eventSource.close(); },
  );

  try {
    const { gifData, tsData } = await fetchGifAndSeriesForPanel({ variable, start, end, bbox, taskId });

    if (gifData.error) {
      const uxError = translateBackendError(gifData.error);
      showErrorModal(uxError.title, uxError.message);
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));

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

      const player  = new GifPlayer();
      await player.load(gifData.gifUrl);

      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(_mapRef!);
      setActiveOverlay(overlay);
      const mapB = mapState.getMapB();
      if (mapB) switchColorbar(mapB, variable, _mapRef!);
      _mapRef!.fitBounds(overlayBounds);

      mapState.setGifPlayerA(player);
      mapState.setOverlayA(overlay);
      mapState.setActiveGifPathA(gifData.gifUrl);
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
        _playerSlider.max   = String(player.frameCount - 1);
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

      const player  = new GifPlayer();
      await player.load(gifData.gifUrl);

      const mapB = mapState.getMapB()!;
      const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(mapB);
      mapState.setOverlayB(overlay);
      _updateStationMarkersVisibility();
      switchColorbar(mapB, variable, _mapRef!);
      mapB.fitBounds(overlayBounds);
      setTimeout(() => mapB.setView(_mapRef!.getCenter(), _mapRef!.getZoom(), { animate: false }), 100);

      mapState.setGifPlayerB(player);
      mapState.setActiveGifPathB(gifData.gifUrl);

      if (tsData) {
        const extractedB = extractTimeseriesValues(tsData, variable);
        if (extractedB) {
          mapState.setSeriesDataForVariable('B', variable, { dates: extractedB.dates, values: extractedB.values });
          renderChartB();
        }
      } else {
        console.warn('Error en serie temporal panel B.');
      }
    }

    // Si ambos paneles tienen GIF → sincronizar
    trySyncBothPanels();

  } catch (err) {
    console.error(err);
    showErrorModal('Error de red', `No se pudo generar la animación / serie temporal (panel ${panel}). Verificá tu conexión.`);
    updateProgressIndicator(-1, 'Error de red');
    removeProgressIndicator(3000);
  } finally {
    eventSource.close();
  }
}
