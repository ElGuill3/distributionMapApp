import { hasStationHistory } from './stationHistory.js';
import type { LocalStationInfo } from '../types.js';
import { formatForecastSummary, type ForecastResponse } from './bdctbForecast.js';
import { forecastLoaderFor } from './stationChart.js';
import { escapeHtml } from '../utils/html.js';
import { ipcetStatus, safeSource, stateLabel, tableDate } from './ipcetStatus.js';

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
    ${hasStationHistory(id) ? `<a href="#" class="station-popup-btn station-full-data-link" data-station-id="${escapeHtml(id)}">Ver datos 2000–2024</a>` : ''}
    ${isHidro ? `<button type="button" class="station-chart-link" data-station-id="${escapeHtml(id)}">Ver detalle</button>` : ''}
  `;
  const status = isHidro ? ipcetStatus.stateFor(id) : null;
  if (status) {
    const line = document.createElement('p');
    line.className = 'station-popup-ipcet';
    line.textContent = `${status.semaforo ? stateLabel(status.semaforo) : 'Sin estado confirmado'} (IPCET, ${tableDate(status.table_date)})${status.problems.length ? ' · nivel sin confirmar' : ''}`;
    const source = safeSource(status.source_url);
    if (source) {
      const link = document.createElement('a');
      link.className = 'ipcet-source';
      link.href = source;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Fuente: IPCET';
      line.append(' · ', link);
    }
    div.querySelector('.station-popup-meta')?.after(line);
  }
  if (isHidro && forecastLoaderFor(id)) {
    const block = document.createElement('div');
    block.className = 'station-forecast-summary';
    block.dataset['stationId'] = id;
    block.setAttribute('role', 'status');
    block.setAttribute('aria-live', 'polite');
    div.querySelector('.station-chart-link')?.before(block);
  }
  return div;
}

type Popup = Pick<L.Popup, 'getElement'> & {
  update(): unknown;
  getContent?: L.Popup['getContent'];
  setContent?: (content: Parameters<L.Popup['setContent']>[0]) => unknown;
};
const active = new Map<Popup, { stop: () => void }>();
const pendingRestores = new WeakMap<Popup, () => void>();

/** Shared by both maps. Construction never loads a forecast: only popupopen does. */
export function openStationPopup(popup: Popup): void {
  closeStationPopup(popup);
  // A rapid reopen must recover the factory before freezing fresh content.
  pendingRestores.get(popup)?.();
  const block = popup
    .getElement()
    ?.querySelector<HTMLElement>('.station-forecast-summary');
  const load = forecastLoaderFor(block?.dataset['stationId'] || '');
  if (!block || !load) return;
  // Leaflet reevaluates function-valued content on update(). Keep this open
  // instance stable, then restore the factory so the next open gets fresh status.
  const factory = popup.getContent?.();
  if (typeof factory === 'function')
    popup.setContent?.(block.closest<HTMLElement>('.station-popup-content')!);
  let disposed = false;
  let request: AbortController | undefined;
  let timer: number | undefined;
  let result: ForecastResponse | undefined;
  const deadline = Date.now() + 30 * 60000;
  const current = () => !disposed && block.isConnected;
  const cancel = () => {
    window.clearTimeout(timer);
    request?.abort();
    request = undefined;
  };
  const render = (lines: string[]) => {
    if (!current()) return;
    block.replaceChildren(
      ...lines.map(text => {
        const line = document.createElement('span');
        line.textContent = text;
        line.title = text;
        return line;
      })
    );
    popup.update();
    const medians = block.children[1] as HTMLElement | undefined;
    // NAMO proximity is optional: omit it rather than show a clipped phrase.
    // Keep the complete summary in the tooltip without widening the popup.
    if (
      medians &&
      medians.clientWidth > 0 &&
      medians.scrollWidth > medians.clientWidth
    ) {
      medians.textContent =
        medians.textContent?.replace(
          / · (?:mín\. .* bajo el NAMO|alcanza el NAMO|prácticamente en el NAMO)$/,
          ''
        ) ?? '';
      popup.update();
    }
  };
  const refresh = async () => {
    if (!current() || document.hidden) return;
    const controller = new AbortController();
    request = controller;
    try {
      const next = await load(controller.signal);
      if (!current() || controller.signal.aborted) return;
      result = next;
      render(formatForecastSummary(next));
    } catch {
      if (!current() || controller.signal.aborted) return;
      // Preserve the last validated summary on a transient poll failure.
      if (!result) render(['Pronóstico no disponible']);
    } finally {
      if (request === controller) request = undefined;
      if (
        current() &&
        !controller.signal.aborted &&
        !document.hidden &&
        result?.updating &&
        Date.now() < deadline
      )
        timer = window.setTimeout(
          () => void refresh(),
          Math.min(60000, deadline - Date.now())
        );
    }
  };
  const visibility = () => {
    cancel();
    if (
      !document.hidden &&
      current() &&
      (!result || (result.updating && Date.now() < deadline))
    )
      void refresh();
  };
  active.set(popup, {
    stop: () => {
      disposed = true;
      cancel();
      document.removeEventListener('visibilitychange', visibility);
      if (typeof factory === 'function') {
        // Leaflet is still removing the popup during popupclose.
        const restore = () => {
          window.clearTimeout(restoreTimer);
          pendingRestores.delete(popup);
          popup.setContent?.(factory);
        };
        const restoreTimer = window.setTimeout(restore, 0);
        pendingRestores.set(popup, restore);
      }
    },
  });
  document.addEventListener('visibilitychange', visibility);
  render(['Consultando pronóstico…']);
  void refresh();
}
export function closeStationPopup(popup?: Popup): void {
  if (popup) {
    active.get(popup)?.stop();
    active.delete(popup);
  } else {
    for (const controller of active.values()) controller.stop();
    active.clear();
  }
}
