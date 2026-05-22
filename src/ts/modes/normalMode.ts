/**
 * Módulo de modo normal — distributionMapApp.
 *
 * Encapsula toda la lógica de negocio del modo normal (panel A único):
 * - Entrada/salida del modo normal
 * - Generación de GIF + serie temporal
 * - Limpieza del panel A
 *
 * Phase C: extraído de main.ts. No contiene lógica de compare mode ni flood risk mode.
 * Cualquier lógica compartida con otros modos se documenta con un comentario
 * indicando que se resolverá en Phase D.
 */

import type { BBox, VariableKey } from '../types.js';
import * as mapState from '../state/mapState.js';
import {
  fetchGifAndSeries,
  createProgressEventSource,
  extractTimeseriesValues,
} from '../apiClient.js';
import {
  switchColorbar,
  removeActiveOverlay,
  setActiveOverlay,
} from '../map/overlays.js';
import {
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
} from '../ui/progress.js';
import { plotAllSelectedSeries } from '../ui/chart.js';
import { GifPlayer, SoloPlayer } from '../ui/gifPlayer.js';
import type { AnimationFrameInfo } from '../state/mapState.js';
import type { Season } from '../types.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
declare const L: typeof import('leaflet');

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

/** Resultado de iniciar la generación de GIF + serie temporal. */
export interface NormalModeResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Referencia al mapa principal (inyectada desde main.ts al inicializar). */
let _mapRef: L.Map | null = null;

/** Referencia al div del chart (inyectada desde main.ts al inicializar). */
let _chartDiv: HTMLElement | null = null;

/** Controles del player (inyectados desde main.ts al inicializar). */
let _playerControlsDiv: HTMLElement | null = null;
let _playerSlider: HTMLInputElement | null = null;
let _playerFrameLabel: HTMLSpanElement | null = null;
let _playerPlayIcon: HTMLSpanElement | null = null;
let _playerSpeedSelect: HTMLSelectElement | null = null;

/** PR1: Topbar controles del player (inyectados desde main.ts al inicializar). */
let _topbarSlider: HTMLInputElement | null = null;
let _topbarFrameLabel: HTMLSpanElement | null = null;
let _topbarPlayIcon: HTMLSpanElement | null = null;

/** Callback invocado cuando la gráfica se renderiza con datos (para sync de UI). */
let _onChartRendered: (() => void) | undefined = undefined;

/** PR2: Callback para actualizar la etiqueta de fecha en el overlay del mapa. */
let _onDateLabelUpdate: ((frameIdx: number) => void) | undefined = undefined;

/**
 * Inicializa las referencias del módulo al DOM y al mapa.
 * Debe llamarse desde main.ts antes de usar cualquier otra función.
 */
export function initNormalMode(domRefs: {
  map: L.Map;
  chartDiv: HTMLElement | null;
  playerControlsDiv: HTMLElement | null;
  playerSlider: HTMLInputElement | null;
  playerFrameLabel: HTMLSpanElement | null;
  playerPlayIcon: HTMLSpanElement | null;
  playerSpeedSelect: HTMLSelectElement | null;
  topbarSlider?: HTMLInputElement | null;
  topbarFrameLabel?: HTMLSpanElement | null;
  topbarPlayIcon?: HTMLSpanElement | null;
  onChartRendered?: () => void;
  onDateLabelUpdate?: (frameIdx: number) => void;
}): void {
  _mapRef = domRefs.map;
  _chartDiv = domRefs.chartDiv;
  _playerControlsDiv = domRefs.playerControlsDiv;
  _playerSlider = domRefs.playerSlider;
  _playerFrameLabel = domRefs.playerFrameLabel;
  _playerPlayIcon = domRefs.playerPlayIcon;
  _playerSpeedSelect = domRefs.playerSpeedSelect;
  _topbarSlider = domRefs.topbarSlider ?? null;
  _topbarFrameLabel = domRefs.topbarFrameLabel ?? null;
  _topbarPlayIcon = domRefs.topbarPlayIcon ?? null;
  _onChartRendered = domRefs.onChartRendered;
  _onDateLabelUpdate = domRefs.onDateLabelUpdate ?? undefined;
}

/** Intervalo de frame seleccionado (en ms). */
function _selectedInterval(): number {
  return Number(_playerSpeedSelect?.value ?? '1000') || 1000;
}

// ---------------------------------------------------------------------------
// Player controls helpers
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
  // PR1: Also sync topbar controls
  if (_topbarSlider) {
    _topbarSlider.max = String(total - 1);
    _topbarSlider.value = String(current);
  }
  if (_topbarFrameLabel) {
    _topbarFrameLabel.textContent = `${current + 1} / ${total}`;
  }
  // PR2: Update date label with current frame's season/year
  _onDateLabelUpdate?.(current);
}

function syncPlayPauseIcon(): void {
  if (!_playerPlayIcon) return;
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  _playerPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
  // PR1: Also sync topbar icon
  if (_topbarPlayIcon) {
    _topbarPlayIcon.textContent = active?.isPlaying ? '⏸' : '▶';
  }
}

/** Detiene el SoloPlayer sin liberar los GifPlayers. */
// NOTE: stopSoloPlayer es compartido con compareMode — se unificará en Phase D
export function stopSoloPlayer(): void {
  const soloPlayer = mapState.getSoloPlayer();
  if (soloPlayer) {
    soloPlayer.stop();
    mapState.setSoloPlayer(null);
  }
}

/** Detiene el SyncPlayer sin liberar los GifPlayers. */
// NOTE: stopSyncPlayer es compartido con compareMode — se unificará en Phase D
export function stopSyncPlayer(): void {
  const syncPlayer = mapState.getSyncPlayer();
  if (syncPlayer) {
    syncPlayer.stop();
    mapState.setSyncPlayer(null);
  }
}

// ---------------------------------------------------------------------------
// Limpieza del modo normal (panel A)
// ---------------------------------------------------------------------------

/**
 * Limpia la animación y gráfica en modo normal (panel A).
 * No toca panel B ni ningún estado de compare mode.
 */
export function clearNormalMode(): void {
  stopSoloPlayer();
  mapState.getGifPlayerA()?.dispose();
  mapState.setGifPlayerA(null);
  mapState.setOverlayA(null);
  mapState.setActiveGifPathA(null);
  mapState.setFrameDateLabels([]);
  removeActiveOverlay(_mapRef!);
  switchColorbar(_mapRef!, null);
  mapState.clearSeriesDataA();
  if (_chartDiv) Plotly.purge(_chartDiv as HTMLDivElement);
  hidePlayerControls();
  // PR1: Hide topbar and date label when animation is cleared
  document.body.classList.remove('animation-loaded');
  const dateLabel = document.getElementById('animation-date-label');
  if (dateLabel) dateLabel.textContent = '';
  const dateLabelB = document.getElementById('animation-date-label-b');
  if (dateLabelB) dateLabelB.textContent = '';
  // Ocultar chart container en modo normal
  const chartContainer = document.getElementById('ndvi-chart-container');
  chartContainer?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Entrada al modo normal
// ---------------------------------------------------------------------------

/**
 * Activa el modo normal.
 * - Desactiva compare mode si estaba activo (delegado a main.ts)
 * - Limpia cualquier estado residual de otros modos
 * - Inicializa el mapa para modo normal
 *
 * NOTE: La decisión de desactivar compare mode se mantiene en main.ts porque
 * involucra lógica de UI de ambos modos. Cuando se extraiga compareMode.ts
 * se moverá esa coordinación ahí.
 */
export function enterNormalMode(): void {
  // Limpiar estado residual de otros modos
  stopSoloPlayer();
  stopSyncPlayer();

  if (mapState.getGifPlayerA()) {
    mapState.getGifPlayerA()?.dispose();
    mapState.setGifPlayerA(null);
  }
  mapState.setOverlayA(null);
  mapState.setActiveGifPathA(null);
  mapState.setActiveGifPathB(null);
  removeActiveOverlay(_mapRef!);
  switchColorbar(_mapRef!, null);

  mapState.clearSeriesDataA();
  hidePlayerControls();

  // Ocultar containers de compare mode
  const chartBDiv = document.getElementById('chart-b');
  if (chartBDiv) Plotly.purge(chartBDiv);
  const chartBContainer = document.getElementById('chart-b-container');
  chartBContainer?.classList.add('hidden');

  // Limpiar bbox y drawn items se maneja desde main.ts (acceso a drawnItems)
}

// ---------------------------------------------------------------------------
// chart helpers (para modo normal)
// ---------------------------------------------------------------------------

function showChartContainer(): void {
  // En modo comparativa la visibilidad se controla via CSS; no ocultar
  if (!mapState.getCompareModeActive()) {
    const container = document.getElementById('ndvi-chart-container');
    container?.classList.remove('hidden');
  }
}

function hideChartContainer(): void {
  if (!mapState.getCompareModeActive()) {
    const container = document.getElementById('ndvi-chart-container');
    container?.classList.add('hidden');
  }
}

function showChartPlaceholderA(): void {
  const placeholder = document.getElementById('chartPlaceholderA');
  placeholder?.classList.remove('chart-placeholder--hidden');
}

function hideChartPlaceholderA(): void {
  const placeholder = document.getElementById('chartPlaceholderA');
  placeholder?.classList.add('chart-placeholder--hidden');
}

function renderChart(): void {
  if (!_chartDiv) return;
  plotAllSelectedSeries(
    _chartDiv as HTMLDivElement,
    mapState.getSeriesDataA(),
    showChartContainer,
    hideChartContainer,
    showChartPlaceholderA,
    hideChartPlaceholderA
  );
  _onChartRendered?.();
}

// ---------------------------------------------------------------------------
// Generación de GIF + serie temporal — modo normal
// ---------------------------------------------------------------------------

/**
 * Genera animación GIF y serie temporal para el modo normal.
 * Maneja el flujo completo: progress SSE, loading, creación de players,
 * renderizado de overlay y gráfica.
 *
 * @param variable  Variable hidrometeorológica (no local_sp ni local_bd)
 * @param start     Fecha inicio ISO
 * @param end       Fecha fin ISO
 * @param bbox      Bounding box [minLon, minLat, maxLon, maxLat]
 */
export async function requestGifAndSeries(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox
): Promise<NormalModeResult> {
  mapState.setCurrentVariable(variable);

  // Generar taskId para mantener SSE sincronizado con la petición GIF
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  createProgressIndicator();

  // SSE para seguimiento de progreso
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
    () => {
      eventSource.close();
    }
  );

  try {
    const { gifData, tsData } = await fetchGifAndSeries({
      variable,
      start,
      end,
      bbox,
      taskId,
    });

    if (gifData.error) {
      return { success: false, error: gifData.error ?? 'Error generando animación.' };
    }

    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(
      L.latLng(minLat, minLon),
      L.latLng(maxLat, maxLon)
    );

    // Limpiar player anterior antes de crear el nuevo
    stopSoloPlayer();
    mapState.getGifPlayerA()?.dispose();
    mapState.setGifPlayerA(null);
    mapState.setOverlayA(null);
    removeActiveOverlay(_mapRef!);

    // Crear GIF player y overlay
    const player = new GifPlayer();
    await player.load(gifData.gifUrl);

    const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, {
      opacity: 0.8,
    }).addTo(_mapRef!);
    setActiveOverlay(overlay);
    switchColorbar(_mapRef!, variable);
    _mapRef!.fitBounds(overlayBounds);

    mapState.setGifPlayerA(player);
    mapState.setOverlayA(overlay);
    mapState.setActiveGifPathA(gifData.gifUrl);

    // PR2: Build frame date labels array and store in mapState
    const frameDateLabels = _buildFrameDateLabels(gifData.dates, variable);
    mapState.setFrameDateLabels(frameDateLabels);

    // Iniciar reproducción
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
    // PR1: Also initialize topbar slider
    if (_topbarSlider) {
      _topbarSlider.max = String(player.frameCount - 1);
      _topbarSlider.value = '0';
    }
    showPlayerControls();
    // PR1: Show topbar via body class
    document.body.classList.add('animation-loaded');
    syncPlayPauseIcon();

    // Renderizar gráfica si hay datos de serie temporal
    if (tsData) {
      const extracted = extractTimeseriesValues(tsData, variable);
      if (extracted) {
        mapState.setSeriesDataForVariable('A', variable, extracted);
        renderChart();
      }
    } else {
      console.warn('Error en serie temporal.');
    }

    return { success: true };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      error: 'Error de red al generar animación / serie temporal.',
    };
  } finally {
    eventSource.close();
  }
}

// ---------------------------------------------------------------------------
// Play/Pause controls (delegados al player activo)
// ---------------------------------------------------------------------------

/**
 * Alterna play/pause del player activo (SyncPlayer o SoloPlayer).
 */
export function togglePlayPause(): void {
  const active = mapState.getSyncPlayer() ?? mapState.getSoloPlayer();
  if (!active) return;
  if (active.isPlaying) {
    active.pause();
  } else {
    active.play();
  }
  syncPlayPauseIcon();
}

/**
 * Mueve el player activo a un frame específico.
 */
export function seekToFrame(frame: number): void {
  mapState.getSyncPlayer()?.goToFrame(frame);
  mapState.getSoloPlayer()?.goToFrame(frame);
}

/**
 * Actualiza la velocidad de reproducción del player activo.
 */
export function updatePlaySpeed(): void {
  const ms = _selectedInterval();
  const syncP = mapState.getSyncPlayer();
  const soloP = mapState.getSoloPlayer();
  if (syncP) syncP.frameIntervalMs = ms;
  if (soloP) soloP.frameIntervalMs = ms;
}

// ---------------------------------------------------------------------------
// Station markers visibility (helper compartido)
// ---------------------------------------------------------------------------

// Importación lazy para evitar dependencia circular
import { municipalFloodOverlays } from '../map/overlays.js';

/**
 * Actualiza la visibilidad de los marcadores de estaciones.
 * Muestra en mapa A cuando no hay overlay activo ni capas flood.
 *
 * NOTE: Esta función es usada tanto por normalMode como por compareMode.
 * Se evaluará en Phase D si vive en un módulo compartido (ej. mapUtils.ts).
 *
 * @param stationMarkersMap  Marcadores del mapa principal
 * @param mapB              Mapa B (puede ser null en modo normal)
 */
export function updateStationMarkersVisibility(
  stationMarkersMap: L.Marker[],
  _mapB: L.Map | null
): void {
  // _mapB is kept for API compatibility but not used in this implementation
  void _mapB;
  const showOnMap =
    !mapState.getOverlayA() && Object.keys(municipalFloodOverlays).length === 0;
  for (const m of stationMarkersMap) {
    if (showOnMap && !_mapRef!.hasLayer(m)) {
      m.addTo(_mapRef!);
    } else if (!showOnMap && _mapRef!.hasLayer(m)) {
      _mapRef!.removeLayer(m);
    }
  }
  // stationMarkersMapB would be handled separately when mapB is present
}

// PR2: Build frame date labels from GIF dates
function _buildFrameDateLabels(
  dates: string[],
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>
): AnimationFrameInfo[] {
  const SEASON_LABELS: Record<string, string> = {
    verano: 'Verano',
    invierno: 'Invierno',
    primavera: 'Primavera',
    otono: 'Otoño',
    anual: 'Anual',
  };

  const result: AnimationFrameInfo[] = [];
  for (const dateStr of dates) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    // Determine season from date
    const month = date.getMonth() + 1; // 1-indexed
    let season: Season;
    if (month >= 6 && month <= 8) {
      season = 'verano';
    } else if (month >= 9 && month <= 11) {
      season = 'otono';
    } else if (month >= 3 && month <= 5) {
      season = 'primavera';
    } else {
      // Dec, Jan, Feb -> invierno
      season = 'invierno';
    }
    const label = `${SEASON_LABELS[season]} ${year}`;
    result.push({ year, season, label });
  }
  return result;
}
