/**
 * Módulo de modo riesgo de inundación — distributionMapApp.
 *
 * Encapsula toda la lógica de negocio del modo riesgo de inundación:
 * - Entrada/salida del modo riesgo
 * - Capa estatal de susceptibilidad (tiles XYZ estáticos) y su leyenda
 * - Lectura de la clase bajo el cursor (color del tile, sin servidor)
 * - Selección de un municipio (en el mapa o en la lista): resaltado y ficha
 * - Vista por municipio: coropleta del % de superficie en clase alta o muy alta
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
  applyClassColors,
  findMunicipality,
  highShareClass,
  readoutHtml,
  TilePixelCache,
  municipalityCardHtml,
  muniKey,
  tilePixel,
  TILE_SIZE,
  type FloodRiskMetadata,
  type MunicipalityFeature,
} from '../map/floodRiskLayer.js';
import { escapeHtml } from '../utils/html.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
declare const L: typeof import('leaflet');

/** Keys of the flood layers inside `municipalFloodOverlays`. */
const STATE_LAYER_KEY = 'estado';
const MUNICIPAL_LAYER_KEY = 'municipios';

export type FloodView = 'detail' | 'municipal';
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
let _view: FloodView = 'detail';
let _tiles: L.TileLayer | null = null;
let _choropleth: L.GeoJSON | null = null;
/** Transparent municipality polygons on top of either view: hover and click. */
let _hits: L.GeoJSON | null = null;
const _hitByKey = new Map<string, L.Polygon>();
/** Key (data-muni) of the selected municipality, at most one. */
let _selected: string | null = null;
/**
 * Municipality highlighted under the cursor. The readout names this one, so
 * text, highlight and click agree where simplified borders overlap.
 */
let _hovered: MunicipalityFeature | null = null;
let _readoutRequest = 0;
const _tilePixels = new TilePixelCache(TILE_CACHE_LIMIT, _decodeTile);

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
  _mapRef?.closePopup();
  _markSelected(null);
  _hovered = null;
  _hits?.remove();
  _view = 'detail';
  const detailRadio = document.querySelector<HTMLInputElement>(
    'input[name="flood-view"][value="detail"]'
  );
  if (detailRadio) detailRadio.checked = true;

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
      applyClassColors(metadata.classes, document.documentElement);
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
  _applyView();
  _addReadout(_mapRef);
}

/**
 * Cambia entre el detalle a 30 m (tiles) y la coropleta por municipio.
 *
 * @param view 'detail' | 'municipal'
 */
export function setFloodView(view: FloodView): void {
  _view = view;
  if (mapState.getFloodRiskModeActive() && _metadata) _applyView();
}

function _tileLayer(metadata: FloodRiskMetadata): L.TileLayer {
  if (!_tiles) {
    const [west, south, east, north] = metadata.bounds;
    _tiles = L.tileLayer(metadata.tiles.url, {
      minZoom: 0,
      maxNativeZoom: metadata.tiles.maxzoom,
      minNativeZoom: metadata.tiles.minzoom,
      bounds: L.latLngBounds([south, west], [north, east]),
      opacity: 0.8,
      attribution: 'Susceptibilidad: INEGI, CENAPRED, Copernicus, JRC, MERIT Hydro',
    });
  }
  return _tiles;
}

function _choroplethLayer(): L.GeoJSON {
  if (!_choropleth) {
    _choropleth = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: _municipalities,
      } as unknown as GeoJSON.FeatureCollection,
      {
        style: feature => {
          const share =
            (feature?.properties as { high_share?: number } | undefined)?.high_share ??
            0;
          return {
            className: `flood-choropleth flood-choropleth-${highShareClass(share)}`,
          };
        },
        // Hover and clicks go to the municipality layer drawn on top.
        interactive: false,
      }
    );
  }
  return _choropleth;
}

function _hitLayer(metadata: FloodRiskMetadata): L.GeoJSON {
  if (!_hits) {
    const total = _municipalities.length;
    _hits = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: _municipalities,
      } as unknown as GeoJSON.FeatureCollection,
      {
        style: { className: 'flood-muni-hit', weight: 3 },
        onEachFeature: (feature, layer) => {
          const props = (feature as unknown as MunicipalityFeature).properties;
          const key = muniKey(props.name);
          const polygon = layer as L.Polygon;
          _hitByKey.set(key, polygon);
          polygon.bindPopup(municipalityCardHtml(props, metadata.classes, total));
          const muni = feature as unknown as MunicipalityFeature;
          polygon.on('mouseover', () => {
            _hovered = muni;
            polygon.getElement()?.classList.add('is-hover');
          });
          polygon.on('mouseout', () => {
            if (_hovered === muni) _hovered = null;
            polygon.getElement()?.classList.remove('is-hover');
          });
          // The popup opens on the same click (bindPopup); just record it.
          polygon.on('click', () => _markSelected(key));
          // Opening another card closes this one: only clear if still current.
          polygon.on('popupclose', () => {
            if (_selected === key) _markSelected(null);
          });
        },
      }
    );
  }
  return _hits;
}

/** Highlight `key` on the map and in the list (or clear the selection). */
function _markSelected(key: string | null): void {
  if (_selected)
    _hitByKey.get(_selected)?.getElement()?.classList.remove('is-selected');
  _selected = key;
  if (key) {
    const polygon = _hitByKey.get(key);
    polygon?.getElement()?.classList.add('is-selected');
    polygon?.bringToFront();
  }
  document.querySelectorAll<HTMLButtonElement>('button.flood-muni-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset['muni'] === key));
  });
}

function _setLayer(key: string, layer: L.Layer | null): void {
  const current = municipalFloodOverlays[key];
  if (current && current !== layer && _mapRef) _mapRef.removeLayer(current);
  if (layer && _mapRef) {
    layer.addTo(_mapRef);
    municipalFloodOverlays[key] = layer;
  } else {
    delete municipalFloodOverlays[key];
  }
}

function _applyView(): void {
  if (!_mapRef || !_metadata) return;
  if (_view === 'municipal') {
    _setLayer(STATE_LAYER_KEY, null);
    _setLayer(MUNICIPAL_LAYER_KEY, _choroplethLayer());
    switchColorbar(_mapRef, 'floodMunicipal');
  } else {
    _setLayer(MUNICIPAL_LAYER_KEY, null);
    _setLayer(STATE_LAYER_KEY, _tileLayer(_metadata));
    switchColorbar(_mapRef, 'flood');
  }
  const hits = _hitLayer(_metadata);
  if (_mapRef.hasLayer(hits)) hits.bringToFront();
  else hits.addTo(_mapRef);
  if (_selected) _hitByKey.get(_selected)?.bringToFront();
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
  _readoutRequest += 1; // a tile still loading must not overwrite this
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

function _decodeTile(key: string): Promise<ImageData> {
  const [z, x, y] = key.split('/');
  const url = _metadata!.tiles.url
    .replace('{z}', z ?? '')
    .replace('{x}', x ?? '')
    .replace('{y}', y ?? '');
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('2D canvas unavailable'));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE));
    };
    img.onerror = () => reject(new Error(`tile ${key} failed to load`));
    img.src = url;
  });
}

/** The highlighted municipality, or the one containing the point. */
function _muniAt(latlng: L.LatLng): MunicipalityFeature | null {
  return _hovered ?? findMunicipality(latlng.lng, latlng.lat, _municipalities);
}

async function _updateReadout(latlng: L.LatLng): Promise<void> {
  if (!_metadata || !_mapRef || !_readoutEl) return;
  if (_view === 'municipal') {
    _readoutRequest += 1;
    const muni = _muniAt(latlng);
    _readoutEl.innerHTML = muni
      ? `${escapeHtml(muni.properties.name)} · <strong>${Math.round(
          muni.properties.high_share * 100
        )}%</strong> en susceptibilidad alta o muy alta`
      : 'Fuera del estado';
    return;
  }
  const { minzoom, maxzoom } = _metadata.tiles;
  const z = Math.max(minzoom, Math.min(maxzoom, Math.round(_mapRef.getZoom())));
  const { x, y, px, py } = tilePixel(latlng.lat, latlng.lng, z);
  // Tile decoding is async: only the latest hover may write the readout.
  const request = ++_readoutRequest;
  let status: 'ok' | 'error' = 'ok';
  let cls = null;
  try {
    const pixels = await _tilePixels.get(`${z}/${x}/${y}`);
    const offset = (py * TILE_SIZE + px) * 4;
    cls = classFromRgba(pixels.data.subarray(offset, offset + 4), _metadata.classes);
  } catch (err) {
    console.warn(err);
    status = 'error';
  }
  if (request !== _readoutRequest || !_readoutEl) return;
  const muni = _muniAt(latlng);
  _readoutEl.innerHTML = readoutHtml({
    status,
    cls,
    muni: muni?.properties.name ?? null,
  });
}

/**
 * Selecciona un municipio desde la lista: lo resalta, hace zoom y abre su
 * ficha. Si ya estaba seleccionado, lo deselecciona. Los clics en el mapa
 * seleccionan sin zoom (el municipio ya está a la vista).
 *
 * @param muni Clave del municipio (data-muni)
 */
export async function selectFloodMunicipality(muni: string): Promise<void> {
  try {
    await _ensureLoaded();
  } catch (err) {
    console.error(err);
    showErrorModal('Error de red', 'No se pudieron cargar los municipios.');
    return;
  }
  // The mode may have been left while loading.
  if (!mapState.getFloodRiskModeActive() || !_mapRef || !_metadata) return;
  if (_selected === muni) {
    _mapRef.closePopup();
    return;
  }
  if (!_hits || !_mapRef.hasLayer(_hits)) _applyView();
  const polygon = _hitByKey.get(muni);
  if (!polygon) {
    console.warn(`No published flood statistics for municipality "${muni}"`);
    return;
  }
  _markSelected(muni);
  _mapRef.fitBounds(polygon.getBounds(), { padding: [24, 24] });
  polygon.openPopup(polygon.getBounds().getCenter());
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

  document
    .querySelectorAll<HTMLInputElement>('input[name="flood-view"]')
    .forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked)
          setFloodView(radio.value === 'municipal' ? 'municipal' : 'detail');
      });
    });

  // Lista de municipios: selección única, igual que hacer clic en el mapa.
  document.querySelectorAll<HTMLButtonElement>('button.flood-muni-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const muni = btn.dataset['muni'];
      if (muni) void selectFloodMunicipality(muni);
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
