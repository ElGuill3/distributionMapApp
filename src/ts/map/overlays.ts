/**
 * Gestión de overlays del mapa y barras de colores (colorbars).
 *
 * Los tipos de Leaflet se usan a través del UMD global `L` (disponible
 * gracias a allowUmdGlobalAccess + @types/leaflet en tsconfig).
 *
 * Exporta:
 *  - activeOverlay          : overlay GIF activo
 *  - municipalFloodOverlays : overlays de riesgo por municipio
 *  - buildColorbars()       : inicializa todos los controles de colorbar
 *  - switchColorbar()       : activa una colorbar, desactiva las demás
 *  - removeActiveOverlay()  : elimina el overlay GIF activo del mapa
 *  - setActiveOverlay()     : actualiza la referencia al overlay activo
 */

import type { VariableKey } from '../types.js';
import * as mapState from '../state/mapState.js';
import { initLucideIcons } from '../ui/icons.js';

// ---------------------------------------------------------------------------
// Estado de overlays
// ---------------------------------------------------------------------------

export let activeOverlay: L.ImageOverlay | null = null;

export function setActiveOverlay(overlay: L.ImageOverlay | null): void {
  activeOverlay = overlay;
}

export const municipalFloodOverlays: Record<string, L.ImageOverlay> = {};

/**
 * Sets the opacity of the active GIF overlay.
 * @param opacity - Value from 0 to 100 (slider input)
 */
export function setOverlayOpacity(opacity: number): void {
  if (mapState.getCompareModeActive()) {
    mapState.getOverlayA()?.setOpacity(opacity / 100);
    mapState.getOverlayB()?.setOpacity(opacity / 100);
  } else {
    activeOverlay?.setOpacity(opacity / 100);
  }
}

// ---------------------------------------------------------------------------
// Colorbars
// ---------------------------------------------------------------------------

export let allColorbars: Partial<Record<VariableKey | 'flood', L.Control>> = {};

/**
 * Crea e inicializa todos los controles de colorbar.
 * Debe llamarse una sola vez al arrancar la aplicación.
 */
export function buildColorbars(): void {
  allColorbars = {
    ndvi: _makeColorbar('ndvi-colorbar', _ndviHtml()),
    temp: _makeColorbar('temp-colorbar', _tempHtml()),
    soil: _makeColorbar('soil-colorbar', _soilHtml()),
    precip: _makeColorbar('precip-colorbar', _precipHtml()),
    flood: _makeColorbar('flood-risk-colorbar', _floodHtml()),
  };
}

/**
 * Activa la colorbar de la variable indicada en `targetMap` y desactiva todas
 * las demás. Si se pasa `removeFromMap`, también se eliminan de ese mapa
 * (útil al mover la colorbar entre paneles en modo comparativa).
 *
 * @param targetMap    - Mapa donde se mostrará la colorbar activa.
 * @param variable     - Variable activa o 'flood'. null desactiva todas.
 * @param removeFromMap - Mapa adicional del que eliminar todos los controles.
 */
export function switchColorbar(
  targetMap: L.Map,
  variable: VariableKey | 'flood' | null,
  removeFromMap?: L.Map
): void {
  for (const [key, ctrl] of Object.entries(allColorbars)) {
    if (!ctrl) continue;
    targetMap.removeControl(ctrl);
    if (removeFromMap) removeFromMap.removeControl(ctrl);
    if (key === variable) {
      ctrl.addTo(targetMap);
    }
  }
}

/**
 * Elimina el overlay GIF activo del mapa.
 */
export function removeActiveOverlay(map: L.Map): void {
  if (activeOverlay) {
    map.removeLayer(activeOverlay);
    activeOverlay = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

const CHEVRON_UP_ICON = `<span data-lucide="chevron-up" aria-hidden="true"></span>`;
const CHEVRON_DOWN_ICON = `<span data-lucide="chevron-down" aria-hidden="true"></span>`;

function _makeColorbar(cssClass: string, innerHtml: string): L.Control {
  const ctrl = new L.Control({ position: 'topright' });
  ctrl.onAdd = () => {
    const wrapper = L.DomUtil.create('div', 'colorbar-wrapper');
    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);

    const toggleBtn = L.DomUtil.create(
      'button',
      'colorbar-toggle-btn',
      wrapper
    ) as HTMLButtonElement;
    toggleBtn.type = 'button';
    toggleBtn.title = 'Ocultar leyenda';
    toggleBtn.innerHTML = CHEVRON_UP_ICON;
    initLucideIcons(toggleBtn);

    const content = L.DomUtil.create('div', cssClass, wrapper);
    content.innerHTML = innerHtml;

    toggleBtn.addEventListener('click', () => {
      const hidden = content.classList.toggle('colorbar-content-hidden');
      toggleBtn.innerHTML = hidden ? CHEVRON_DOWN_ICON : CHEVRON_UP_ICON;
      initLucideIcons(toggleBtn);
      toggleBtn.title = hidden ? 'Mostrar leyenda' : 'Ocultar leyenda';
    });

    return wrapper;
  };
  return ctrl;
}

function _ndviHtml(): string {
  return `
    <div class="ndvi-colorbar-scale"></div>
    <div class="ndvi-colorbar-labels">
      <span class="colorbar-label-item" data-tooltip="Vegetación densa, salud vegetal alta.">0.5 – 0.8</span>
      <span class="colorbar-label-item" data-tooltip="Vegetación moderada, agricultura.">0.3 – 0.5</span>
      <span class="colorbar-label-item" data-tooltip="Vegetación escasa, pastos secos.">0.2 – 0.3</span>
      <span class="colorbar-label-item" data-tooltip="Poca vegetación, zonas áridas.">0.1 – 0.2</span>
      <span class="colorbar-label-item" data-tooltip="Suelo desnudo, roca, nieve, agua.">0.0 – 0.1</span>
    </div>`;
}

function _tempHtml(): string {
  return `
    <div class="temp-colorbar-scale"></div>
    <div class="temp-colorbar-labels">
      <span class="colorbar-label-item">≥ 35 °C</span>
      <span class="colorbar-label-item">30–35 °C</span>
      <span class="colorbar-label-item">25–30 °C</span>
      <span class="colorbar-label-item">20–25 °C</span>
      <span class="colorbar-label-item">15–20 °C</span>
      <span class="colorbar-label-item">10–15 °C</span>
      <span class="colorbar-label-item">5–10 °C</span>
      <span class="colorbar-label-item">0–5 °C</span>
    </div>`;
}

function _soilHtml(): string {
  return `
    <div class="soil-colorbar-scale"></div>
    <div class="soil-colorbar-labels">
      <span class="colorbar-label-item">≥ 60 %</span>
      <span class="colorbar-label-item">50–60 %</span>
      <span class="colorbar-label-item">40–50 %</span>
      <span class="colorbar-label-item">30–40 %</span>
      <span class="colorbar-label-item">20–30 %</span>
      <span class="colorbar-label-item">10–20 %</span>
      <span class="colorbar-label-item">0–10 %</span>
    </div>`;
}

function _precipHtml(): string {
  return `
    <div class="precip-colorbar-scale"></div>
    <div class="precip-colorbar-labels">
      <span class="colorbar-label-item">≥ 80 mm/día</span>
      <span class="colorbar-label-item">60–80 mm/día</span>
      <span class="colorbar-label-item">40–60 mm/día</span>
      <span class="colorbar-label-item">20–40 mm/día</span>
      <span class="colorbar-label-item">10–20 mm/día</span>
      <span class="colorbar-label-item">1–10 mm/día</span>
      <span class="colorbar-label-item">0–1 mm/día</span>
    </div>`;
}

function _floodHtml(): string {
  return `
    <div class="flood-risk-colorbar-scale"></div>
    <div class="flood-risk-colorbar-labels">
      <span class="colorbar-label-item" data-tooltip="Crítico">80 – 100</span>
      <span class="colorbar-label-item" data-tooltip="Muy alto">60 – 80</span>
      <span class="colorbar-label-item" data-tooltip="Alto">40 – 60</span>
      <span class="colorbar-label-item" data-tooltip="Moderado">20 – 40</span>
      <span class="colorbar-label-item" data-tooltip="Bajo">0 – 20</span>
    </div>`;
}
