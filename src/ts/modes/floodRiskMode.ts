/**
 * Módulo de modo riesgo de inundación — distributionMapApp.
 *
 * Encapsula toda la lógica de negocio del modo riesgo de inundación:
 * - Entrada/salida del modo riesgo
 * - Carga/limpieza de mapas de riesgo por municipio (overlays)
 * - Coordinación de colorbar 'flood'
 *
 * Phase E: extraído de main.ts. No contiene lógica de normal mode ni compare mode.
 *
 * La visibilidad de marcadores de estaciones se delega a quien llame,
 * pasando los marcadores como argumento (evita dependencia circular).
 */

import * as mapState from '../state/mapState.js';
import { fetchFloodRisk } from '../apiClient.js';
import {
  switchColorbar,
  municipalFloodOverlays,
} from '../map/overlays.js';
import * as L from 'leaflet';

// ---------------------------------------------------------------------------
// Referencias inyectadas desde main.ts
// ---------------------------------------------------------------------------

/** Referencia al mapa principal (inyectada desde main.ts). */
let _mapRef: L.Map | null = null;

/** Referencia al botón toggle de modo riesgo. */
let _toggleFloodRiskModeButton: HTMLButtonElement | null = null;

/** Hint de modo riesgo. */
let _floodRiskModeHint: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Interfaz pública del módulo
// ---------------------------------------------------------------------------

export interface FloodRiskModeDomRefs {
  map: L.Map;
  toggleFloodRiskModeButton: HTMLButtonElement | null;
  floodRiskModeHint: HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

/**
 * Inicializa las referencias del módulo al DOM y al mapa.
 * Debe llamarse desde main.ts al arrancar.
 */
export function initFloodRiskMode(domRefs: FloodRiskModeDomRefs): void {
  _mapRef = domRefs.map;
  _toggleFloodRiskModeButton = domRefs.toggleFloodRiskModeButton;
  _floodRiskModeHint = domRefs.floodRiskModeHint;
}

// ---------------------------------------------------------------------------
// API pública — entrada / salida del modo riesgo
// ---------------------------------------------------------------------------

/**
 * Activa el modo riesgo de inundación.
 * - Desactiva compare mode si estaba activo (delegado a main.ts)
 * - Limpia cualquier estado residual de otros modos
 * - Muestra el hint de modo riesgo
 *
 * @param deactivateCompareMode - Función para desactivar compare mode (inyectada)
 */
export function enterFloodRiskMode(
  deactivateCompareMode: () => void,
): void {
  // Desactivar compare mode si estaba activo
  if (mapState.getCompareModeActive()) {
    deactivateCompareMode();
  }

  mapState.setFloodRiskModeActive(true);
  document.body.classList.add('flood-risk-mode-active');
  _toggleFloodRiskModeButton?.setAttribute('aria-pressed', 'true');
  _floodRiskModeHint?.classList.remove('hidden');
}

/**
 * Desactiva el modo riesgo de inundación y limpia todos los overlays.
 */
export function exitFloodRiskMode(): void {
  if (!mapState.getFloodRiskModeActive()) return;

  mapState.setFloodRiskModeActive(false);
  document.body.classList.remove('flood-risk-mode-active');
  _toggleFloodRiskModeButton?.setAttribute('aria-pressed', 'false');
  _floodRiskModeHint?.classList.add('hidden');

  // Eliminar todos los overlays de riesgo activos
  for (const muni of Object.keys(municipalFloodOverlays)) {
    const ov = municipalFloodOverlays[muni];
    if (ov && _mapRef) _mapRef.removeLayer(ov);
    delete municipalFloodOverlays[muni];
  }

  // Desmarcar todos los checkboxes de municipio
  document.querySelectorAll<HTMLInputElement>('input.chk-flood-muni').forEach(chk => {
    chk.checked = false;
  });

  // Ocultar colorbar de flood
  if (_mapRef) switchColorbar(_mapRef, null);
}

// ---------------------------------------------------------------------------
// API pública — overlays de riesgo por municipio
// ---------------------------------------------------------------------------

/**
 * Activa o desactiva el overlay de riesgo de inundación para un municipio.
 *
 * @param muni    Nombre del municipio
 * @param checked true = mostrar overlay, false = eliminar overlay
 */
export async function toggleMunicipalFloodRisk(
  muni: string,
  checked: boolean,
): Promise<void> {
  if (!checked) {
    const existing = municipalFloodOverlays[muni];
    if (existing && _mapRef) {
      _mapRef.removeLayer(existing);
      delete municipalFloodOverlays[muni];
    }
    // Ocultar colorbar si ya no hay ninguna capa de riesgo activa
    if (Object.keys(municipalFloodOverlays).length === 0 && _mapRef) {
      switchColorbar(_mapRef, null);
    }
    return;
  }

  if (municipalFloodOverlays[muni]) {
    municipalFloodOverlays[muni]?.addTo(_mapRef!);
    return;
  }

  try {
    const data = await fetchFloodRisk({ municipio: muni });

    const [minLon, minLat, maxLon, maxLat] = data.bbox;
    const bounds  = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
    const overlay = L.imageOverlay(data.mapUrl, bounds, { opacity: 0.8 }).addTo(_mapRef!);
    municipalFloodOverlays[muni] = overlay;
    if (_mapRef) switchColorbar(_mapRef, 'flood');
  } catch (err) {
    console.error(err);
    alert('Error de red al generar mapa de riesgo por municipio.');
  }
}

// ---------------------------------------------------------------------------
// Registro de listeners del modo riesgo
// ---------------------------------------------------------------------------

/**
 * Registra el listener para toggle de modo riesgo.
 * Debe llamarse desde main.ts durante la inicialización, después de initFloodRiskMode.
 *
 * @param onEnter        Callback para entrar al modo riesgo (delega a main.ts la coordinación con compareMode)
 * @param onExit         Callback para salir del modo riesgo
 * @param clearNormalMode Función para limpiar el modo normal (delegada a normalMode)
 */
export function registerFloodRiskModeListeners(
  onEnter: () => void,
  onExit: () => void,
  clearNormalMode: () => void,
): void {
  _toggleFloodRiskModeButton?.addEventListener('click', () => {
    const newState = !mapState.getFloodRiskModeActive();

    if (newState) {
      onEnter();
    } else {
      onExit();
    }
  });

  // Listeners de checkboxes de municipios
  document.querySelectorAll<HTMLInputElement>('input.chk-flood-muni').forEach(chk => {
    chk.addEventListener('change', () => {
      const muni = chk.dataset['muni'];
      if (!muni) return;
      void toggleMunicipalFloodRisk(muni, chk.checked);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers de visibilidad de marcadores de estaciones
// ---------------------------------------------------------------------------

/**
 * Actualiza la visibilidad de los marcadores de estaciones.
 * Oculta marcadores en mapa A cuando hay overlays de riesgo activos.
 *
 * @param stationMarkersMap Marcadores del mapa principal
 * @param stationMarkersMapB Marcadores del mapa B (puede ser null)
 */
export function updateStationMarkersVisibility(
  stationMarkersMap: L.Marker[],
  stationMarkersMapB: L.Marker[] | null,
): void {
  const showOnMap = Object.keys(municipalFloodOverlays).length === 0;
  if (_mapRef) {
    for (const m of stationMarkersMap) {
      if (showOnMap && !_mapRef!.hasLayer(m)) {
        m.addTo(_mapRef!);
      } else if (!showOnMap && _mapRef!.hasLayer(m)) {
        _mapRef!.removeLayer(m);
      }
    }
  }
  if (stationMarkersMapB && mapState.getMapB()) {
    const showOnMapB = !mapState.getOverlayB();
    for (const m of stationMarkersMapB) {
      const mapB = mapState.getMapB()!;
      if (showOnMapB && !mapB.hasLayer(m)) {
        m.addTo(mapB);
      } else if (!showOnMapB && mapB.hasLayer(m)) {
        mapB.removeLayer(m);
      }
    }
  }
}