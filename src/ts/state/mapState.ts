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

import type { BBox, VariableKey, SeriesData, LocalStationsResponse } from '../types.js';
import type { GifPlayer, SyncPlayer, SoloPlayer } from '../ui/gifPlayer.js';
import type { Season } from '../types.js';
import type L from 'leaflet';

// ---------------------------------------------------------------------------
// Animation frame metadata for date label overlay
// ---------------------------------------------------------------------------

export interface AnimationFrameInfo {
  year: number;
  season: Season;
  label: string;
}

// ---------------------------------------------------------------------------
// Tipos del estado
// ---------------------------------------------------------------------------

/** Estados posibles de un paso del flujo */
export type StepStatus = 'pending' | 'active' | 'complete' | 'generating';

/** Paso del flujo de tareas */
export interface StepState {
  status: StepStatus;
  isValid: boolean;
}

/** Estado del flujo de tareas (PR1) */
export interface TaskFlowState {
  currentStep: 'area' | 'variable' | 'config' | 'explore';
  currentVariable: VariableKey;
  hasBbox: boolean;
  steps: Record<string, StepState>;
}

/** Estado completo de la aplicación. */
export interface AppState {
  // bbox
  bbox: BBox | null;

  // mode flags
  compareModeActive: boolean;
  floodRiskModeActive: boolean;
  inundacionesModeActive: boolean;
  mapBSyncLock: boolean;

  // variable activa
  currentVariable: VariableKey;

  // PR1: Task flow state
  taskFlow: TaskFlowState;

  // series data — panel A y B
  seriesDataA: Record<string, SeriesData | undefined>;
  seriesDataB: Record<string, SeriesData | undefined>;

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

  // GIF paths — para exportar (originales, no blob URLs)
  activeGifPathA: string | null;
  activeGifPathB: string | null;
  gifPathsA: Partial<Record<VariableKey, string | undefined>>;
  gifPathsB: Partial<Record<VariableKey, string | undefined>>;

  // PR2: Animation frame date labels for date label overlay
  frameDateLabels: AnimationFrameInfo[];

  // Local stations response/list
  localStations: LocalStationsResponse | null;
}

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

export const initialState: AppState = {
  bbox: null,
  compareModeActive: false,
  floodRiskModeActive: false,
  inundacionesModeActive: false,
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
  activeGifPathA: null,
  activeGifPathB: null,
  gifPathsA: {},
  gifPathsB: {},
  // PR2: Animation frame date labels for date label overlay
  frameDateLabels: [],
  // Local stations list
  localStations: null,
  // PR1: Task flow initial state
  taskFlow: {
    currentStep: 'area',
    currentVariable: 'ndvi',
    hasBbox: false,
    steps: {
      area: { status: 'active', isValid: false },
      variable: { status: 'pending', isValid: false },
      config: { status: 'pending', isValid: false },
      explore: { status: 'pending', isValid: false },
    },
  },
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

export function hasBbox(): boolean {
  return state.bbox !== null;
}

export function getCompareModeActive(): boolean {
  return state.compareModeActive;
}

export function getFloodRiskModeActive(): boolean {
  return state.floodRiskModeActive;
}

export function getInundacionesModeActive(): boolean {
  return state.inundacionesModeActive;
}

export function getMapBSyncLock(): boolean {
  return state.mapBSyncLock;
}

export function getCurrentVariable(): VariableKey {
  return state.currentVariable;
}

// PR1: Task flow getters
export function getTaskFlowState(): TaskFlowState {
  return state.taskFlow;
}

export function getTaskFlowStep(): TaskFlowState['currentStep'] {
  return state.taskFlow.currentStep;
}

export function getTaskFlowStepValidity(step: string): boolean {
  return state.taskFlow.steps[step]?.isValid || false;
}

export function getSeriesDataA(): Record<string, SeriesData | undefined> {
  return state.seriesDataA;
}

export function getSeriesDataB(): Record<string, SeriesData | undefined> {
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

export function getActiveGifPathA(): string | null {
  return state.activeGifPathA;
}

export function getActiveGifPathB(): string | null {
  return state.activeGifPathB;
}

export function setActiveGifPathA(path: string | null): void {
  state = { ...state, activeGifPathA: path };
}

export function setActiveGifPathB(path: string | null): void {
  state = { ...state, activeGifPathB: path };
}

export function getGifPathsA(): Partial<Record<VariableKey, string | undefined>> {
  return state.gifPathsA;
}

export function getGifPathsB(): Partial<Record<VariableKey, string | undefined>> {
  return state.gifPathsB;
}

export function getGifPathForVariable(
  panel: 'A' | 'B',
  variable: VariableKey
): string | undefined {
  return panel === 'A' ? state.gifPathsA[variable] : state.gifPathsB[variable];
}

export function setGifPathForVariable(
  panel: 'A' | 'B',
  variable: VariableKey,
  path: string | null
): void {
  if (panel === 'A') {
    state = {
      ...state,
      gifPathsA: {
        ...state.gifPathsA,
        [variable]: path ?? undefined,
      },
    };
  } else {
    state = {
      ...state,
      gifPathsB: {
        ...state.gifPathsB,
        [variable]: path ?? undefined,
      },
    };
  }
}

export function deleteGifPathForVariable(
  panel: 'A' | 'B',
  variable: VariableKey
): void {
  if (panel === 'A') {
    const { [variable]: _removed, ...restA } = state.gifPathsA;
    void _removed;
    state = { ...state, gifPathsA: restA };
  } else {
    const { [variable]: _removed, ...restB } = state.gifPathsB;
    void _removed;
    state = { ...state, gifPathsB: restB };
  }
}

export function clearGifPathsA(): void {
  state = { ...state, gifPathsA: {} };
}

export function clearGifPathsB(): void {
  state = { ...state, gifPathsB: {} };
}

// PR2: Frame date labels for date label overlay
export function getFrameDateLabels(): AnimationFrameInfo[] {
  return state.frameDateLabels;
}

export function setFrameDateLabels(labels: AnimationFrameInfo[]): void {
  state = { ...state, frameDateLabels: labels };
}

// ---------------------------------------------------------------------------
// Setters — bbox
// ---------------------------------------------------------------------------

export function setBbox(bbox: BBox | null): void {
  state = {
    ...state,
    bbox,
    taskFlow: {
      ...state.taskFlow,
      hasBbox: bbox !== null,
    },
  };
}

export function clearBbox(): void {
  state = {
    ...state,
    bbox: null,
    taskFlow: {
      ...state.taskFlow,
      hasBbox: false,
    },
  };
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

export function setInundacionesModeActive(active: boolean): void {
  state = { ...state, inundacionesModeActive: active };
}

export function setMapBSyncLock(locked: boolean): void {
  state = { ...state, mapBSyncLock: locked };
}

// ---------------------------------------------------------------------------
// Setters — variable
// ---------------------------------------------------------------------------

export function setCurrentVariable(variable: VariableKey): void {
  state = {
    ...state,
    currentVariable: variable,
    taskFlow: {
      ...state.taskFlow,
      currentVariable: variable,
    },
  };
}

// PR1: Task flow setters
export function setTaskFlowStep(step: TaskFlowState['currentStep']): void {
  state = {
    ...state,
    taskFlow: {
      ...state.taskFlow,
      currentStep: step,
    },
  };
}

export function updateTaskFlowStepValidity(step: string, isValid: boolean): void {
  const currentStep = state.taskFlow.steps[step] || {
    status: 'pending',
    isValid: false,
  };
  state = {
    ...state,
    taskFlow: {
      ...state.taskFlow,
      steps: {
        ...state.taskFlow.steps,
        [step]: {
          status: currentStep.status,
          isValid,
        },
      },
    },
  };
}

export function updateTaskFlowStepStatus(step: string, status: StepStatus): void {
  const currentStep = state.taskFlow.steps[step] || {
    status: 'pending',
    isValid: false,
  };
  state = {
    ...state,
    taskFlow: {
      ...state.taskFlow,
      steps: {
        ...state.taskFlow.steps,
        [step]: {
          status,
          isValid: currentStep.isValid,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setters — series data
// ---------------------------------------------------------------------------

export function setSeriesDataA(data: Record<string, SeriesData | undefined>): void {
  state = { ...state, seriesDataA: data };
}

export function setSeriesDataB(data: Record<string, SeriesData | undefined>): void {
  state = { ...state, seriesDataB: data };
}

export function setSeriesDataForVariable(
  panel: 'A' | 'B',
  variable: string,
  data: SeriesData
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

export function deleteSeriesDataForVariable(panel: 'A' | 'B', variable: string): void {
  if (panel === 'A') {
    const { [variable]: _removed, ...restA } = state.seriesDataA;
    void _removed;
    state = { ...state, seriesDataA: restA };
  } else {
    const { [variable]: _removed, ...restB } = state.seriesDataB;
    void _removed;
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
    gifPathsA: {},
    frameDateLabels: [],
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
    gifPathsB: {},
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
    activeGifPathA: null,
    activeGifPathB: null,
    gifPathsA: {},
    gifPathsB: {},
  };
}

// ---------------------------------------------------------------------------
// Reset completo (para uso futuro si se necesita)
// ---------------------------------------------------------------------------

export function resetState(): void {
  state = { ...initialState };
}

// ---------------------------------------------------------------------------
// Getters / Setters — local stations list
// ---------------------------------------------------------------------------

export function getLocalStations(): LocalStationsResponse | null {
  return state.localStations;
}

export function setLocalStations(localStations: LocalStationsResponse | null): void {
  state = {
    ...state,
    localStations,
  };
}
