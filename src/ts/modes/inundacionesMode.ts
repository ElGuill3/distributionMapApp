/**
 * Módulo de modo detección de inundaciones — distributionMapApp.
 *
 * Encapsula la lógica de negocio para el modo histórico/reciente de inundaciones:
 * - Selección de satélite (Sentinel-1 / Landsat)
 * - Rango de fechas libre e inputs de umbral manual/automático
 * - Carga de teselas de Earth Engine (capa de inundación y fondo satelital)
 * - Leyenda interactiva flotante con control de opacidad/visibilidad de capas
 * - Cálculo asíncrono del área inundada en hectáreas
 */

import * as mapState from '../state/mapState.js';
import {
  showErrorModal,
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
} from '../ui/progress.js';

// L is the global Leaflet instance loaded via <script> tag (not an ES module import)
declare const L: typeof import('leaflet');

let _mapRef: L.Map | null = null;
let _toggleInundacionesModeButton: HTMLButtonElement | null = null;
let _inundacionesModeHint: HTMLElement | null = null;

let backgroundLayer: L.TileLayer | null = null;
let floodLayer: L.TileLayer | null = null;
let inundationsLegendCtrl: L.Control | null = null;

export interface InundacionesModeDomRefs {
  map: L.Map;
  toggleInundacionesModeButton: HTMLButtonElement | null;
  inundacionesModeHint: HTMLElement | null;
}

/**
 * Inicializa las referencias del módulo al DOM y al mapa.
 */
export function initInundacionesMode(domRefs: InundacionesModeDomRefs): void {
  _mapRef = domRefs.map;
  _toggleInundacionesModeButton = domRefs.toggleInundacionesModeButton;
  _inundacionesModeHint = domRefs.inundacionesModeHint;

  setupDomListeners();
}

/**
 * Configura los event listeners para el panel de inundaciones
 */
function setupDomListeners(): void {
  const satSelect = document.getElementById('inund-satellite') as HTMLSelectElement | null;
  const satHint = document.getElementById('inund-satellite-hint') as HTMLElement | null;
  const thresholdModeSelect = document.getElementById('inund-threshold-mode') as HTMLSelectElement | null;
  const manualGroup = document.getElementById('inund-threshold-manual-group') as HTMLElement | null;
  const thresholdValueInput = document.getElementById('inund-threshold-value') as HTMLInputElement | null;
  const processBtn = document.getElementById('inund-btn-process') as HTMLButtonElement | null;

  // Actualizar pista dinámica del satélite y umbrales por defecto
  satSelect?.addEventListener('change', () => {
    if (!satHint || !satSelect) return;
    if (satSelect.value === 'sentinel1') {
      satHint.textContent = 'Sentinel-1 (Radar): Cobertura 2015–2024. Inmune a nubes.';
      if (thresholdValueInput) thresholdValueInput.value = '-18.0';
    } else {
      satHint.textContent = 'Landsat (Óptico): Cobertura 2000–2024. Sujeto a nubes.';
      if (thresholdValueInput) thresholdValueInput.value = '0.05';
    }
  });

  // Mostrar/ocultar input de umbral manual
  thresholdModeSelect?.addEventListener('change', () => {
    if (!manualGroup || !thresholdModeSelect) return;
    if (thresholdModeSelect.value === 'manual') {
      manualGroup.classList.remove('hidden');
    } else {
      manualGroup.classList.add('hidden');
    }
  });

  // Botón procesar
  processBtn?.addEventListener('click', () => {
    void handleProcessFlood();
  });
}

/**
 * Realiza las llamadas a la API y dibuja las capas e info en el mapa
 */
async function handleProcessFlood(): Promise<void> {
  if (!_mapRef) return;

  const processBtn = document.getElementById('inund-btn-process') as HTMLButtonElement | null;
  const satSelect = document.getElementById('inund-satellite') as HTMLSelectElement | null;
  const startInput = document.getElementById('inund-start') as HTMLInputElement | null;
  const endInput = document.getElementById('inund-end') as HTMLInputElement | null;
  const thresholdModeSelect = document.getElementById('inund-threshold-mode') as HTMLSelectElement | null;
  const thresholdValueInput = document.getElementById('inund-threshold-value') as HTMLInputElement | null;

  if (!satSelect || !startInput || !endInput || !thresholdModeSelect || !thresholdValueInput) return;

  const satellite = satSelect.value;
  const start = startInput.value;
  const end = endInput.value;
  const auto = thresholdModeSelect.value === 'auto';
  const threshold = parseFloat(thresholdValueInput.value);

  if (!start || !end) {
    showErrorModal('Error de validación', 'Debés seleccionar una fecha de inicio y fin.');
    return;
  }

  const bbox = mapState.getBbox();
  if (!bbox) {
    showErrorModal('Sin región seleccionada', 'Por favor, dibujá un área en el mapa antes de visualizar.');
    return;
  }

  // Deshabilitar botón para evitar múltiples clics concurrentes
  if (processBtn) processBtn.disabled = true;

  // Mostrar modal de progreso blocking
  createProgressIndicator();
  updateProgressIndicator(30, 'Procesando imágenes en Google Earth Engine (esto puede tardar unos segundos)...');

  // Limpiar capas previas
  clearLayers();

  // Activar spinner en mapa
  document.getElementById('map')?.classList.add('map-loading');

  try {
    const bboxStr = JSON.stringify(bbox);
    const detectUrl = `/api/flood-detection?start=${start}&end=${end}&bbox=${encodeURIComponent(bboxStr)}&satellite=${satellite}&auto=${auto}&threshold=${threshold}`;
    const resp = await fetch(detectUrl);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || 'Error al procesar la inundación');
    }

    // Agregar capa de fondo satelital
    backgroundLayer = L.tileLayer(data.background_layer, { opacity: 0.85 }).addTo(_mapRef);

    // Agregar capa de inundación en cian
    floodLayer = L.tileLayer(data.water_layer, { opacity: 0.9 }).addTo(_mapRef);

    // Ajustar vista del mapa
    const bounds = L.latLngBounds(L.latLng(bbox[1], bbox[0]), L.latLng(bbox[3], bbox[2]));
    _mapRef.fitBounds(bounds);

    // Crear la leyenda flotante con datos
    createLegendControl({
      satellite: satellite === 'sentinel1' ? 'Sentinel-1 (Radar)' : 'Landsat (Óptico)',
      period: `${start} a ${end}`,
      threshold: data.computed_threshold,
      total_ha: 'Calculando...',
      bgLayer: backgroundLayer,
      floodLayer: floodLayer,
    });

    // Consultar el área en hectáreas de forma asíncrona
    updateProgressIndicator(80, 'Cargando capas de mapa y calculando hectáreas inundadas...');
    const statsUrl = `/api/flood-stats?start=${start}&end=${end}&bbox=${encodeURIComponent(bboxStr)}&satellite=${satellite}&auto=${auto}&threshold=${threshold}`;
    void fetch(statsUrl)
      .then(res => res.json())
      .then(statsData => {
        if (statsData.total_ha !== undefined) {
          updateLegendArea(statsData.total_ha);
        } else {
          updateLegendArea('No disponible');
        }
      })
      .catch(err => {
        console.error('Error fetching flood stats:', err);
        updateLegendArea('Error');
      });

    // Ocultar modal de progreso de forma exitosa
    removeProgressIndicator(200);

  } catch (err: any) {
    console.error(err);
    // Eliminar modal de progreso en caso de error
    removeProgressIndicator();
    showErrorModal('Error en detección', err.message || 'No se pudieron recuperar los datos de inundación.');
  } finally {
    document.getElementById('map')?.classList.remove('map-loading');
    if (processBtn) processBtn.disabled = false;
  }
}

/**
 * Remueve las capas e iconos asociados al modo de inundación
 */
function clearLayers(): void {
  if (!_mapRef) return;
  if (backgroundLayer) {
    _mapRef.removeLayer(backgroundLayer);
    backgroundLayer = null;
  }
  if (floodLayer) {
    _mapRef.removeLayer(floodLayer);
    floodLayer = null;
  }
  if (inundationsLegendCtrl) {
    _mapRef.removeControl(inundationsLegendCtrl);
    inundationsLegendCtrl = null;
  }
}

/**
 * Crea e inyecta la leyenda interactiva flotante en el mapa Leaflet
 */
function createLegendControl(info: {
  satellite: string;
  period: string;
  threshold: number;
  total_ha: string;
  bgLayer: L.TileLayer;
  floodLayer: L.TileLayer;
}): void {
  if (!_mapRef) return;

  inundationsLegendCtrl = new L.Control({ position: 'topright' });
  inundationsLegendCtrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'inund-legend-card');
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    div.innerHTML = `
      <h4 class="inund-legend-title">Inundación Detectada</h4>
      <div class="inund-legend-item">
        <span>Satélite:</span>
        <span>${info.satellite}</span>
      </div>
      <div class="inund-legend-item">
        <span>Periodo:</span>
        <span style="font-size: 0.78rem;">${info.period}</span>
      </div>
      <div class="inund-legend-item">
        <span>Umbral:</span>
        <span>${info.threshold}</span>
      </div>
      <div class="inund-legend-item">
        <span>Área Inundada:</span>
        <span id="inund-legend-area-value" style="color: var(--teal-600); font-weight: bold;">${info.total_ha}</span>
      </div>
      <div class="inund-legend-toggles">
        <label style="color: var(--text-primary);">
          <input type="checkbox" id="chk-toggle-flood-layer" checked>
          Mostrar inundación (Cian)
        </label>
        <label style="color: var(--text-primary);">
          <input type="checkbox" id="chk-toggle-bg-layer" checked>
          Mostrar imagen de fondo
        </label>
      </div>
    `;

    // Listeners para checkboxes
    const floodChk = div.querySelector('#chk-toggle-flood-layer') as HTMLInputElement | null;
    const bgChk = div.querySelector('#chk-toggle-bg-layer') as HTMLInputElement | null;

    floodChk?.addEventListener('change', () => {
      if (!_mapRef) return;
      if (floodChk.checked) {
        info.floodLayer.addTo(_mapRef);
      } else {
        _mapRef.removeLayer(info.floodLayer);
      }
    });

    bgChk?.addEventListener('change', () => {
      if (!_mapRef) return;
      if (bgChk.checked) {
        info.bgLayer.addTo(_mapRef);
      } else {
        _mapRef.removeLayer(info.bgLayer);
      }
    });

    return div;
  };

  inundationsLegendCtrl.addTo(_mapRef);
}

/**
 * Actualiza el valor del área calculada en la leyenda flotante
 */
function updateLegendArea(ha: number | string): void {
  const el = document.getElementById('inund-legend-area-value');
  if (el) {
    if (typeof ha === 'number') {
      el.textContent = `${ha.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
    } else {
      el.textContent = ha;
    }
  }
}

/**
 * Activa el modo de inundación en el frontend
 */
export function enterInundacionesMode(): void {
  // Actualizar estado en mapState
  mapState.setInundacionesModeActive(true);

  document.body.classList.add('inundaciones-mode-active');
  _toggleInundacionesModeButton?.setAttribute('aria-pressed', 'true');
  _inundacionesModeHint?.classList.remove('hidden');
}

/**
 * Desactiva el modo de inundación y remueve todas sus capas y leyendas
 */
export function exitInundacionesMode(): void {
  if (!mapState.getInundacionesModeActive()) return;

  mapState.setInundacionesModeActive(false);
  document.body.classList.remove('inundaciones-mode-active');
  _toggleInundacionesModeButton?.setAttribute('aria-pressed', 'false');
  _inundacionesModeHint?.classList.add('hidden');

  clearLayers();
}
