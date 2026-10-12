import type { LocalStationInfo } from '../types.js';
import { bdctbForecastAction } from './bdctbForecast.js';
import { escapeHtml } from '../utils/html.js';

/** Shared station popup renderer for both map panels. */
export function buildStationPopup(
  id: string,
  info: LocalStationInfo,
  isHidro: boolean
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'station-popup-content';
  const badgeClass = isHidro ? 'station-badge-hidro' : 'station-badge-clima';
  const badgeLabel = isHidro ? 'Hidro' : 'Clima';
  const icon = isHidro ? 'waves' : 'droplet';
  const metric = isHidro ? 'Nivel del río' : 'Precipitación';
  div.innerHTML = `
    <div class="station-popup-header">
      <span class="station-badge ${badgeClass}"><span data-lucide="${icon}" style="width: 12px; height: 12px;"></span> ${badgeLabel}</span>
    </div>
    <h3 class="station-popup-title">${escapeHtml(info.station_name || info.name)}</h3>
    <div class="station-popup-meta">
      <span class="station-popup-meta-item"><span data-lucide="map-pin" style="width: 12px; height: 12px;"></span> ${escapeHtml(info.municipio || 'Sin Municipio')}</span>
      <span class="station-popup-meta-item"><span data-lucide="line-chart" style="width: 12px; height: 12px;"></span> ${metric}</span>
    </div>
    <a href="#" class="station-popup-btn station-full-data-link" data-station-id="${escapeHtml(id)}">Ver datos 2000–2024</a>
    ${bdctbForecastAction(id, isHidro)}
  `;
  return div;
}
