/**
 * Estado global centralizado para distributionMapApp.
 *
 * Phase B: Este módulo encapsula todo el estado que antes vivía como
 * variables `let` dispersas en main.ts. Se accede y muta a través
 * de las funciones exportadas.
 *
 * Patrón: objeto de estado central + funciones de lectura/mutación.
 * Mantiene tipado completo con TypeScript.
 */

import type { BBox, VariableKey, SeriesData } from '../types.js';
import type { GifPlayer, SyncPlayer, SoloPlayer } from '../ui/gifPlayer.js';
import type L from 'leaflet';

// ---------------------------------------------------------------------------
// Tipos del estado
// ---------------------------------------------------------------------------

/** Estado completo de la aplicación. */
export interface AppState {
  // bbox
  bbox: BBox | null;

  // mode flags
  compareModeActive: boolean;
  floodRiskModeActive: boolean;
  mapBSyncLock: boolean;

  // variable activa
  currentVariable: VariableKey;

  // series data — panel A y B
  seriesDataA: Partial<Record<VariableKey, SeriesData | undefined>>;
  seriesDataB: Partial<Record<VariableKey, SeriesData | undefined>>;

  // players — modo comparativa
  gifPlayerA: GifPlayer | null;
  gifPlayerB: GifPlayer | null;
  syncPlayer: SyncPlayer | null;
  soloPlayer: SoloPlayer | null;

  // overlays — modo comparativa
  overlayA: L.ImageOverlay | null;
  overlayB: L.ImageOverlay | null;

  // segundo mapa (modo comparativa)
  mapB: L.Map | null;
}

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

export const initialState: AppState = {
  bbox: null,
  compareModeActive: false,
  floodRiskModeActive: false,
  mapBSyncLock: false,
  currentVariable: 'ndvi',
  seriesDataA: {},
  seriesDataB: {},
  gifPlayerA: null,
  gifPlayerB: null,
  syncPlayer: null,
  soloPlayer: null,
  overlayA: null,
  overlayB: null,
  mapB: null,
};

// ---------------------------------------------------------------------------
// Estado interno (única `let` del módulo — todas las demás funciones son const)
// ---------------------------------------------------------------------------

let state: AppState = { ...initialState };

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getState(): AppState {
  return state;
}

export function getBbox(): BBox | null {
  return state.bbox;
}

export function getCompareModeActive(): boolean {
  return state.compareModeActive;
}

export function getFloodRiskModeActive(): boolean {
  return state.floodRiskModeActive;
}

export function getMapBSyncLock(): boolean {
  return state.mapBSyncLock;
}

export function getCurrentVariable(): VariableKey {
  return state.currentVariable;
}

export function getSeriesDataA(): Partial<Record<VariableKey, SeriesData | undefined>> {
  return state.seriesDataA;
}

export function getSeriesDataB(): Partial<Record<VariableKey, SeriesData | undefined>> {
  return state.seriesDataB;
}

export function getGifPlayerA(): GifPlayer | null {
  return state.gifPlayerA;
}

export function getGifPlayerB(): GifPlayer | null {
  return state.gifPlayerB;
}

export function getSyncPlayer(): SyncPlayer | null {
  return state.syncPlayer;
}

export function getSoloPlayer(): SoloPlayer | null {
  return state.soloPlayer;
}

export function getOverlayA(): L.ImageOverlay | null {
  return state.overlayA;
}

export function getOverlayB(): L.ImageOverlay | null {
  return state.overlayB;
}

export function getMapB(): L.Map | null {
  return state.mapB;
}

// ---------------------------------------------------------------------------
// Setters — bbox
// ---------------------------------------------------------------------------

export function setBbox(bbox: BBox | null): void {
  state = { ...state, bbox };
}

export function clearBbox(): void {
  state = { ...state, bbox: null };
}

// ---------------------------------------------------------------------------
// Setters — mode
// ---------------------------------------------------------------------------

export function setCompareModeActive(active: boolean): void {
  state = { ...state, compareModeActive: active };
}

export function setFloodRiskModeActive(active: boolean): void {
  state = { ...state, floodRiskModeActive: active };
}

export function setMapBSyncLock(locked: boolean): void {
  state = { ...state, mapBSyncLock: locked };
}

// ---------------------------------------------------------------------------
// Setters — variable
// ---------------------------------------------------------------------------

export function setCurrentVariable(variable: VariableKey): void {
  state = { ...state, currentVariable: variable };
}

// ---------------------------------------------------------------------------
// Setters — series data
// ---------------------------------------------------------------------------

export function setSeriesDataA(
  data: Partial<Record<VariableKey, SeriesData | undefined>>,
): void {
  state = { ...state, seriesDataA: data };
}

export function setSeriesDataB(
  data: Partial<Record<VariableKey, SeriesData | undefined>>,
): void {
  state = { ...state, seriesDataB: data };
}

export function setSeriesDataForVariable(
  panel: 'A' | 'B',
  variable: VariableKey,
  data: SeriesData,
): void {
  if (panel === 'A') {
    state = {
      ...state,
      seriesDataA: { ...state.seriesDataA, [variable]: data },
    };
  } else {
    state = {
      ...state,
      seriesDataB: { ...state.seriesDataB, [variable]: data },
    };
  }
}

export function clearSeriesDataA(): void {
  state = { ...state, seriesDataA: {} };
}

export function clearSeriesDataB(): void {
  state = { ...state, seriesDataB: {} };
}

export function clearSeriesData(): void {
  state = { ...state, seriesDataA: {}, seriesDataB: {} };
}

export function deleteSeriesDataForVariable(
  panel: 'A' | 'B',
  variable: VariableKey,
): void {
  if (panel === 'A') {
    const { [variable]: _removed, ...restA } = state.seriesDataA;
    state = { ...state, seriesDataA: restA };
  } else {
    const { [variable]: _removed, ...restB } = state.seriesDataB;
    state = { ...state, seriesDataB: restB };
  }
}

// ---------------------------------------------------------------------------
// Setters — players
// ---------------------------------------------------------------------------

export function setGifPlayerA(player: GifPlayer | null): void {
  state = { ...state, gifPlayerA: player };
}

export function setGifPlayerB(player: GifPlayer | null): void {
  state = { ...state, gifPlayerB: player };
}

export function setSyncPlayer(player: SyncPlayer | null): void {
  state = { ...state, syncPlayer: player };
}

export function setSoloPlayer(player: SoloPlayer | null): void {
  state = { ...state, soloPlayer: player };
}

export function setOverlayA(overlay: L.ImageOverlay | null): void {
  state = { ...state, overlayA: overlay };
}

export function setOverlayB(overlay: L.ImageOverlay | null): void {
  state = { ...state, overlayB: overlay };
}

// ---------------------------------------------------------------------------
// Setters — mapB
// ---------------------------------------------------------------------------

export function setMapB(map: L.Map | null): void {
  state = { ...state, mapB: map };
}

// ---------------------------------------------------------------------------
// Setters compuestos — Panel A
// ---------------------------------------------------------------------------

export function clearPanelA(): void {
  state = {
    ...state,
    gifPlayerA: null,
    soloPlayer: null,
    syncPlayer: null,
    overlayA: null,
    seriesDataA: {},
  };
}

// ---------------------------------------------------------------------------
// Setters compuestos — Panel B
// ---------------------------------------------------------------------------

export function clearPanelB(): void {
  state = {
    ...state,
    gifPlayerB: null,
    syncPlayer: null,
    soloPlayer: null,
    overlayB: null,
    seriesDataB: {},
  };
}

// ---------------------------------------------------------------------------
// Cleanup total — modo comparativa
// ---------------------------------------------------------------------------

export function cleanupComparePanels(): void {
  state = {
    ...state,
    gifPlayerA: null,
    gifPlayerB: null,
    syncPlayer: null,
    soloPlayer: null,
    overlayA: null,
    overlayB: null,
    seriesDataA: {},
    seriesDataB: {},
  };
}

// ---------------------------------------------------------------------------
// Reset completo (para uso futuro si se necesita)
// ---------------------------------------------------------------------------

export function resetState(): void {
  state = { ...initialState };
}
