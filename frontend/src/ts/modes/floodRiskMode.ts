/**
 * Módulo de modo riesgo de inundación — distributionMapApp.
 *
 * Encapsula toda la lógica de negocio del modo riesgo de inundación:
 * - Entrada/salida del modo riesgo
 * - Capa estatal de susceptibilidad (tiles XYZ estáticos) y su leyenda
 * - Lectura de la clase bajo el cursor (color del tile, sin servidor)
 * - Ficha y contorno de los municipios marcados en el panel
 *
 * No contiene lógica de normal mode ni compare mode.
 *
 * La visibilidad de marcadores de estaciones se delega a quien llame,
 * pasando los marcadores como argumento (evita dependencia circular).
 */

import * as mapState from '../state/mapState.js';
import { fetchFloodRiskMetadata, fetchFloodRiskMunicipalities } from '../apiClient.js';
import { showErrorModal } from '../ui/progress.js';
import { switchColorbar, municipalFloodOverlays } from '../map/overlays.js';
import {
  classFromRgba,
  findMunicipality,
  muniKey,
  municipalityCardHtml,
  tilePixel,
  TILE_SIZE,
  type FloodRiskMetadata,
  type MunicipalityFeature,
} from '../map/floodRiskLayer.js';
import { escapeHtml } from '../utils/html.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
declare const L: typeof import('leaflet');

/** Key of the statewide layer inside `municipalFloodOverlays`. */
const STATE_LAYER_KEY = 'estado';
const TILE_CACHE_LIMIT = 64;

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
// Estado de la capa estatal
// ---------------------------------------------------------------------------

let _metadata: FloodRiskMetadata | null = null;
let _municipalities: MunicipalityFeature[] = [];
let _loading: Promise<void> | null = null;
let _readout: L.Control | null = null;
let _readoutEl: HTMLElement | null = null;
let _pendingMove: L.LeafletMouseEvent | null = null;
const _outlines: Record<string, L.GeoJSON> = {};
const _tilePixels = new Map<string, Promise<ImageData | null>>();

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
 * - Muestra la capa estatal, su leyenda y el lector de valor
 * - Muestra el hint de modo riesgo
 *
 * @param deactivateCompareMode - Función para desactivar compare mode (inyectada)
 */
export function enterFloodRiskMode(deactivateCompareMode: () => void): void {
  if (mapState.getCompareModeActive()) {
    deactivateCompareMode();
  }

  mapState.setFloodRiskModeActive(true);
  document.body.classList.add('flood-risk-mode-active');
  _toggleFloodRiskModeButton?.setAttribute('aria-pressed', 'true');
  _floodRiskModeHint?.classList.remove('hidden');
  void showStateLayer();
}

/**
 * Desactiva el modo riesgo de inundación y limpia capas, leyenda y fichas.
 */
export function exitFloodRiskMode(): void {
  if (!mapState.getFloodRiskModeActive()) return;

  mapState.setFloodRiskModeActive(false);
  document.body.classList.remove('flood-risk-mode-active');
  _toggleFloodRiskModeButton?.setAttribute('aria-pressed', 'false');
  _floodRiskModeHint?.classList.add('hidden');

  for (const key of Object.keys(municipalFloodOverlays)) {
    const layer = municipalFloodOverlays[key];
    if (layer && _mapRef) _mapRef.removeLayer(layer);
    delete municipalFloodOverlays[key];
  }
  for (const key of Object.keys(_outlines)) {
    _outlines[key]?.remove();
    delete _outlines[key];
  }
  document.querySelectorAll<HTMLInputElement>('input.chk-flood-muni').forEach(chk => {
    chk.checked = false;
  });

  if (_mapRef) {
    _mapRef.off('mousemove', _onMouseMove);
    _mapRef.off('mouseout', _onMouseOut);
    if (_readout) _mapRef.removeControl(_readout);
    switchColorbar(_mapRef, null);
  }
}

// ---------------------------------------------------------------------------
// Capa estatal
// ---------------------------------------------------------------------------

async function _ensureLoaded(): Promise<void> {
  if (_metadata) return;
  _loading ??= Promise.all([fetchFloodRiskMetadata(), fetchFloodRiskMunicipalities()])
    .then(([metadata, municipalities]) => {
      _metadata = metadata;
      _municipalities = municipalities;
    })
    .finally(() => {
      _loading = null;
    });
  await _loading;
}

async function showStateLayer(): Promise<void> {
  try {
    await _ensureLoaded();
  } catch (err) {
    console.error(err);
    showErrorModal(
      'Error de red',
      'No se pudo cargar el mapa de susceptibilidad. Verificá tu conexión.'
    );
    return;
  }
  if (!_mapRef || !_metadata || !mapState.getFloodRiskModeActive()) return;
  if (!municipalFloodOverlays[STATE_LAYER_KEY]) {
    const [west, south, east, north] = _metadata.bounds;
    municipalFloodOverlays[STATE_LAYER_KEY] = L.tileLayer(_metadata.tiles.url, {
      minZoom: 0,
      maxNativeZoom: _metadata.tiles.maxzoom,
      minNativeZoom: _metadata.tiles.minzoom,
      bounds: L.latLngBounds([south, west], [north, east]),
      opacity: 0.8,
      attribution: 'Susceptibilidad: INEGI, CENAPRED, Copernicus, JRC, MERIT Hydro',
    });
  }
  municipalFloodOverlays[STATE_LAYER_KEY]?.addTo(_mapRef);
  switchColorbar(_mapRef, 'flood');
  _addReadout(_mapRef);
}

function _addReadout(map: L.Map): void {
  if (!_readout) {
    _readout = new L.Control({ position: 'bottomleft' });
    _readout.onAdd = () => {
      _readoutEl = L.DomUtil.create('div', 'flood-readout');
      _readoutEl.setAttribute('aria-live', 'polite');
      _readoutEl.textContent = 'Pasa el cursor sobre el mapa';
      return _readoutEl;
    };
  }
  _readout.addTo(map);
  map.on('mousemove', _onMouseMove);
  map.on('mouseout', _onMouseOut);
}

function _onMouseOut(): void {
  if (_readoutEl) _readoutEl.textContent = 'Pasa el cursor sobre el mapa';
}

function _onMouseMove(event: L.LeafletMouseEvent): void {
  const scheduled = _pendingMove !== null;
  _pendingMove = event;
  if (scheduled) return;
  requestAnimationFrame(() => {
    const move = _pendingMove;
    _pendingMove = null;
    if (move) void _updateReadout(move.latlng);
  });
}

function _loadTilePixels(z: number, x: number, y: number): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`;
  const cached = _tilePixels.get(key);
  if (cached) return cached;
  const url = _metadata!.tiles.url
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  const pixels = new Promise<ImageData | null>(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  _tilePixels.set(key, pixels);
  if (_tilePixels.size > TILE_CACHE_LIMIT) {
    const oldest = _tilePixels.keys().next().value;
    if (oldest !== undefined) _tilePixels.delete(oldest);
  }
  return pixels;
}

async function _updateReadout(latlng: L.LatLng): Promise<void> {
  if (!_metadata || !_mapRef || !_readoutEl) return;
  const { minzoom, maxzoom } = _metadata.tiles;
  const z = Math.max(minzoom, Math.min(maxzoom, Math.round(_mapRef.getZoom())));
  const { x, y, px, py } = tilePixel(latlng.lat, latlng.lng, z);
  const pixels = await _loadTilePixels(z, x, y);
  const offset = (py * TILE_SIZE + px) * 4;
  const cls = pixels
    ? classFromRgba(pixels.data.subarray(offset, offset + 4), _metadata.classes)
    : null;
  const muni = findMunicipality(latlng.lng, latlng.lat, _municipalities);
  if (!_readoutEl) return;
  if (!cls) {
    _readoutEl.innerHTML = muni
      ? `${escapeHtml(muni.properties.name)} · sin dato (agua permanente o fuera del modelo)`
      : 'Fuera del área del modelo';
    return;
  }
  _readoutEl.innerHTML = `Susceptibilidad <strong>${escapeHtml(cls.label)}</strong>${
    muni ? ` · ${escapeHtml(muni.properties.name)}` : ''
  }`;
}

// ---------------------------------------------------------------------------
// API pública — municipios marcados en el panel
// ---------------------------------------------------------------------------

/**
 * Marca o desmarca un municipio: contorno, ficha con estadísticas y zoom.
 *
 * @param muni    Clave del municipio (data-muni)
 * @param checked true = mostrar contorno y ficha, false = quitarlos
 */
export async function toggleMunicipalFloodRisk(
  muni: string,
  checked: boolean
): Promise<void> {
  if (!checked) {
    _outlines[muni]?.remove();
    delete _outlines[muni];
    return;
  }
  try {
    await _ensureLoaded();
  } catch (err) {
    console.error(err);
    showErrorModal('Error de red', 'No se pudieron cargar los municipios.');
    return;
  }
  const feature = _municipalities.find(f => muniKey(f.properties.name) === muni);
  if (!feature || !_mapRef || !_metadata) return;
  const outline = L.geoJSON(feature as unknown as GeoJSON.Feature, {
    style: { className: 'flood-muni-outline', fill: false, weight: 3 },
  });
  outline
    .bindPopup(
      municipalityCardHtml(
        feature.properties,
        _metadata.classes,
        _municipalities.length
      )
    )
    .addTo(_mapRef);
  _outlines[muni]?.remove();
  _outlines[muni] = outline;
  _mapRef.fitBounds(outline.getBounds(), { padding: [24, 24] });
  outline.openPopup(outline.getBounds().getCenter());
}

// ---------------------------------------------------------------------------
// Registro de listeners del modo riesgo
// ---------------------------------------------------------------------------

/**
 * Registra el listener para toggle de modo riesgo.
 * Debe llamarse desde main.ts durante la inicialización, después de initFloodRiskMode.
 *
 * Los tres callbacks se ignoran: la entrada y salida del modo ocurren con los
 * eventos floodRiskModeActivated/Deactivated que emite sidebar/modoSection.ts y
 * maneja main.ts. Se conservan para no romper la firma pública.
 *
 * @param onEnter         Sin uso (compatibilidad de firma)
 * @param onExit          Sin uso (compatibilidad de firma)
 * @param _clearNormalMode Sin uso (compatibilidad de firma)
 */
export function registerFloodRiskModeListeners(
  onEnter: () => void,
  onExit: () => void,
  _clearNormalMode: () => void
): void {
  // Kept for API compatibility
  void _clearNormalMode;
  void onEnter;
  void onExit;

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
 * Oculta marcadores en mapa A cuando hay capas de riesgo activas.
 *
 * @param stationMarkersMap Marcadores del mapa principal
 * @param stationMarkersMapB Marcadores del mapa B (puede ser null)
 */
export function updateStationMarkersVisibility(
  stationMarkersMap: L.Marker[],
  stationMarkersMapB: L.Marker[] | null
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
