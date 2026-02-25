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
// ---------------------------------------------------------------------------
// Estado de overlays
// ---------------------------------------------------------------------------
export let activeOverlay = null;
export function setActiveOverlay(overlay) {
    activeOverlay = overlay;
}
export const municipalFloodOverlays = {};
// ---------------------------------------------------------------------------
// Colorbars
// ---------------------------------------------------------------------------
export let allColorbars = {};
/**
 * Crea e inicializa todos los controles de colorbar.
 * Debe llamarse una sola vez al arrancar la aplicación.
 */
export function buildColorbars() {
    allColorbars = {
        ndvi: _makeColorbar('ndvi-colorbar', _ndviHtml()),
        temp: _makeColorbar('temp-colorbar', _tempHtml()),
        soil: _makeColorbar('soil-colorbar', _soilHtml()),
        precip: _makeColorbar('precip-colorbar', _precipHtml()),
        water: _makeColorbar('precip-colorbar', _waterHtml()),
        flood: _makeColorbar('flood-risk-colorbar', _floodHtml()),
    };
}
/**
 * Activa la colorbar de la variable indicada y desactiva todas las demás.
 *
 * @param map      - Mapa donde se muestran los controles.
 * @param variable - Variable activa o 'flood'. null desactiva todas.
 */
export function switchColorbar(map, variable) {
    for (const [key, ctrl] of Object.entries(allColorbars)) {
        if (!ctrl)
            continue;
        if (key === variable) {
            ctrl.addTo(map);
        }
        else {
            map.removeControl(ctrl);
        }
    }
}
/**
 * Elimina el overlay GIF activo del mapa.
 */
export function removeActiveOverlay(map) {
    if (activeOverlay) {
        map.removeLayer(activeOverlay);
        activeOverlay = null;
    }
}
// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------
function _makeColorbar(cssClass, innerHtml) {
    const ctrl = new L.Control({ position: 'topright' });
    ctrl.onAdd = () => {
        const div = L.DomUtil.create('div', cssClass);
        div.innerHTML = innerHtml;
        return div;
    };
    return ctrl;
}
function _ndviHtml() {
    return `
    <div class="ndvi-colorbar-scale"></div>
    <div class="ndvi-colorbar-labels">
      <span class="ndvi-max">0.5-0.8 Vegetación densa, salud vegetal alta.</span>
      <span class="ndvi-max">0.3-0.5 Vegetación moderada, agricultura.</span>
      <span class="ndvi-max">0.2-0.3 Vegetación escasa, pastos secos.</span>
      <span class="ndvi-mid">0.1-0.2 Poca vegetación, zonas áridas.</span>
      <span class="ndvi-min">0.0-0.1 Suelo desnudo, roca, nieve, agua.</span>
    </div>`;
}
function _tempHtml() {
    return `
    <div class="temp-colorbar-scale"></div>
    <div class="temp-colorbar-labels">
      <span>≥ 35 °C</span><span>30–35 °C</span><span>25–30 °C</span>
      <span>20–25 °C</span><span>15–20 °C</span><span>10–15 °C</span>
      <span>5–10 °C</span><span>0–5 °C</span>
    </div>`;
}
function _soilHtml() {
    return `
    <div class="soil-colorbar-scale"></div>
    <div class="soil-colorbar-labels">
      <span>≥ 60 %</span><span>50–60 %</span><span>40–50 %</span>
      <span>30–40 %</span><span>20–30 %</span><span>10–20 %</span>
      <span>0–10 %</span>
    </div>`;
}
function _precipHtml() {
    return `
    <div class="precip-colorbar-scale"></div>
    <div class="precip-colorbar-labels">
      <span>≥ 80 mm/día</span><span>60–80 mm/día</span>
      <span>40–60 mm/día</span><span>20–40 mm/día</span>
      <span>10–20 mm/día</span><span>1–10 mm/día</span>
      <span>0–1 mm/día</span>
    </div>`;
}
function _waterHtml() {
    return `
    <div class="precip-colorbar-scale"
         style="background: linear-gradient(to top, #00000000 0%, #0000ff 100%);"></div>
    <div class="precip-colorbar-labels">
      <span>100 % agua</span><span>50 % agua</span><span>0 % agua</span>
    </div>`;
}
function _floodHtml() {
    return `
    <div class="flood-risk-colorbar-scale"></div>
    <div class="flood-risk-colorbar-labels">
      <span>80–100 Crítico</span><span>60–80  Muy alto</span>
      <span>40–60  Alto</span><span>20–40  Moderado</span>
      <span>0–20   Bajo</span>
    </div>`;
}
//# sourceMappingURL=overlays.js.map