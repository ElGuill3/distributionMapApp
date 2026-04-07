/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */
import { VARIABLE_DATA_KEY } from './types.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_SPAN_DEG, GIF_ENDPOINT, TS_ENDPOINT, VARIABLE_YEARS, SEASONS, } from './config.js';
import { buildColorbars, switchColorbar, removeActiveOverlay, setActiveOverlay, municipalFloodOverlays, } from './map/overlays.js';
import { createProgressIndicator, updateProgressIndicator, removeProgressIndicator, } from './ui/progress.js';
import { plotAllSelectedSeries } from './ui/chart.js';
import { registerVariableListener, seasonToDates } from './listeners/variableListeners.js';
import { GifPlayer, SyncPlayer, SoloPlayer } from './ui/gifPlayer.js';
// ---------------------------------------------------------------------------
// Mapa principal (A)
// ---------------------------------------------------------------------------
const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
buildColorbars();
// ---------------------------------------------------------------------------
// Marcadores de estaciones locales
// ---------------------------------------------------------------------------
const STATION_COORDS = {
    SPTTB: [17.791667, -91.158333],
    BDCTB: [17.433333, -91.483333],
};
const STATION_LABELS = {
    SPTTB: 'San Pedro (SPTTB)',
    BDCTB: 'Boca del Cerro (BDCTB)',
};
/** Marcadores de estaciones en mapa principal y mapa B. */
const stationMarkersMap = [];
const stationMarkersMapB = [];
function _makeStationMarker(id, targetMap, markerList) {
    const [lat, lon] = STATION_COORDS[id];
    const marker = L.marker(L.latLng(lat, lon))
        .bindPopup(`<div class="station-popup-content">` +
        `<b>${STATION_LABELS[id]}</b><br>Estación de nivel local<br>` +
        `<a href="#" class="station-full-data-link" data-station-id="${id}">` +
        `Ver datos 2000–2024</a></div>`)
        .addTo(targetMap);
    markerList.push(marker);
    return marker;
}
_makeStationMarker('SPTTB', map, stationMarkersMap);
_makeStationMarker('BDCTB', map, stationMarkersMap);
// ---------------------------------------------------------------------------
// Herramienta de dibujo (Leaflet.draw)
// ---------------------------------------------------------------------------
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
    draw: {
        marker: false,
        circle: false,
        polyline: false,
        polygon: false,
        circlemarker: false,
        rectangle: { shapeOptions: { color: '#ff7800', weight: 2 } },
    },
    edit: {
        featureGroup: drawnItems,
        edit: true,
        remove: true,
    },
});
map.addControl(drawControl);
let currentBbox = null;
map.on(L.Draw.Event.CREATED, (e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = e.layer;
    const bounds = layer.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const widthDeg = Math.abs(ne.lng - sw.lng);
    const heightDeg = Math.abs(ne.lat - sw.lat);
    if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
        alert('El bounding box es demasiado grande (máx. ~8° por lado). Dibuja una región más pequeña.');
        return;
    }
    const centerLat = (sw.lat + ne.lat) / 2;
    const centerLng = (sw.lng + ne.lng) / 2;
    const halfSide = Math.min(widthDeg, heightDeg) / 2;
    const squareSouth = centerLat - halfSide;
    const squareNorth = centerLat + halfSide;
    const squareWest = centerLng - halfSide;
    const squareEast = centerLng + halfSide;
    const squareBounds = L.latLngBounds(L.latLng(squareSouth, squareWest), L.latLng(squareNorth, squareEast));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (layer.setBounds)
        layer.setBounds(squareBounds);
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
    currentBbox = [squareWest, squareSouth, squareEast, squareNorth];
    removeActiveOverlay(map);
    switchColorbar(map, null);
    hideChartContainer();
    if (ndviChartDiv)
        Plotly.purge(ndviChartDiv);
    Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
    Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
    _cleanupComparePanels();
    hidePlayerControls();
    hideChartBContainer();
    if (chartBDiv)
        Plotly.purge(chartBDiv);
    clearMapBOverlay();
});
// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel A
// ---------------------------------------------------------------------------
const ndviChartContainer = document.getElementById('ndvi-chart-container');
const ndviChartDiv = document.getElementById('ndvi-chart');
const allSeriesData = {};
function showChartContainer() {
    // En modo comparativa la visibilidad se controla via CSS; no ocultar
    if (!compareModeActive) {
        ndviChartContainer === null || ndviChartContainer === void 0 ? void 0 : ndviChartContainer.classList.remove('hidden');
    }
}
function hideChartContainer() {
    if (!compareModeActive) {
        ndviChartContainer === null || ndviChartContainer === void 0 ? void 0 : ndviChartContainer.classList.add('hidden');
    }
}
function renderChart() {
    if (!ndviChartDiv)
        return;
    plotAllSelectedSeries(ndviChartDiv, allSeriesData, showChartContainer, hideChartContainer);
}
// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel B
// ---------------------------------------------------------------------------
const chartBContainer = document.getElementById('chart-b-container');
const chartBDiv = document.getElementById('chart-b');
const allSeriesDataB = {};
function showChartBContainer() {
    chartBContainer === null || chartBContainer === void 0 ? void 0 : chartBContainer.classList.remove('hidden');
}
function hideChartBContainer() {
    if (compareModeActive)
        return; // En compare mode siempre permanece visible
    chartBContainer === null || chartBContainer === void 0 ? void 0 : chartBContainer.classList.add('hidden');
}
function renderChartB() {
    if (!chartBDiv)
        return;
    plotAllSelectedSeries(chartBDiv, allSeriesDataB, showChartBContainer, hideChartBContainer);
}
// ---------------------------------------------------------------------------
// Estado de variable activa
// ---------------------------------------------------------------------------
let currentVariable = 'ndvi';
// ---------------------------------------------------------------------------
// Modo comparativa
// ---------------------------------------------------------------------------
let compareModeActive = false;
let mapB = null;
let mapBSyncLock = false;
/** Overlay activo en panel B. */
let activeBOverlay = null;
/** GifPlayers independientes por panel (solo en modo comparativa). */
let gifPlayerA = null;
let gifPlayerB = null;
/** Instancia del SyncPlayer activo (ambos paneles sincronizados). */
let syncPlayer = null;
/** Instancia del SoloPlayer activo (un solo panel animándose). */
let soloPlayer = null;
// DOM: modo comparativa
const toggleCompareModeButton = document.getElementById('toggleCompareMode');
const compareControlsA = document.getElementById('compare-controls-a');
const compareModeHint = document.querySelector('.compare-mode-hint');
// DOM: modo riesgo de inundación
const toggleFloodRiskModeButton = document.getElementById('toggleFloodRiskMode');
const floodRiskModeHint = document.querySelector('.flood-risk-mode-hint');
const btnClearNormal = document.getElementById('btnClearNormal');
let floodRiskModeActive = false;
// DOM: selectores de comparativa — panel A
const compareVarASelect = document.getElementById('compareVarA');
const compareYearASelect = document.getElementById('compareYearA');
const compareSeasonASelect = document.getElementById('compareSeasonA');
const btnGenerateA = document.getElementById('btnGenerateA');
const btnClearA = document.getElementById('btnClearA');
// DOM: selectores de comparativa — panel B
const compareVarBSelect = document.getElementById('compareVarB');
const compareYearBSelect = document.getElementById('compareYearB');
const compareSeasonBSelect = document.getElementById('compareSeasonB');
const btnGenerateB = document.getElementById('btnGenerateB');
const btnClearB = document.getElementById('btnClearB');
// DOM: player controls
const playerControlsDiv = document.getElementById('player-controls');
const playerPlayPauseBtn = document.getElementById('playerPlayPause');
const playerSlider = document.getElementById('playerSlider');
const playerFrameLabel = document.getElementById('playerFrameLabel');
const playerPlayIcon = document.getElementById('playerPlayIcon');
const playerSpeedSelect = document.getElementById('playerSpeed');
/** Devuelve el intervalo de frame seleccionado actualmente (en ms). */
function _selectedInterval() {
    var _a;
    return Number((_a = playerSpeedSelect === null || playerSpeedSelect === void 0 ? void 0 : playerSpeedSelect.value) !== null && _a !== void 0 ? _a : '1000') || 1000;
}
/** Inicializa mapB la primera vez que se activa el modo comparativa. */
function initMapB() {
    if (mapB)
        return;
    mapB = L.map('map-b', { zoomControl: false }).setView(map.getCenter(), map.getZoom());
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapB);
    map.on('moveend', () => {
        if (mapBSyncLock || !mapB)
            return;
        mapBSyncLock = true;
        mapB.setView(map.getCenter(), map.getZoom(), { animate: false });
        mapBSyncLock = false;
    });
    mapB.on('moveend', () => {
        if (mapBSyncLock)
            return;
        mapBSyncLock = true;
        map.setView(mapB.getCenter(), mapB.getZoom(), { animate: false });
        mapBSyncLock = false;
    });
    // Añadir marcadores de estaciones al mapa B
    _makeStationMarker('SPTTB', mapB, stationMarkersMapB);
    _makeStationMarker('BDCTB', mapB, stationMarkersMapB);
}
function clearMapBOverlay() {
    if (activeBOverlay && mapB) {
        mapB.removeLayer(activeBOverlay);
        activeBOverlay = null;
    }
}
/** Para el SyncPlayer sin liberar los GifPlayers. */
function stopSyncPlayer() {
    if (syncPlayer) {
        syncPlayer.stop();
        syncPlayer = null;
    }
}
/** Para el SoloPlayer. */
function stopSoloPlayer() {
    if (soloPlayer) {
        soloPlayer.stop();
        soloPlayer = null;
    }
}
/** Limpia todos los players y overlays activos. */
function _cleanupComparePanels() {
    stopSoloPlayer();
    stopSyncPlayer();
    gifPlayerA === null || gifPlayerA === void 0 ? void 0 : gifPlayerA.dispose();
    gifPlayerA = null;
    gifPlayerB === null || gifPlayerB === void 0 ? void 0 : gifPlayerB.dispose();
    gifPlayerB = null;
    _currentOverlayA = null;
    removeActiveOverlay(map);
    clearMapBOverlay();
    _updateStationMarkersVisibility();
}
/** Limpia solo el panel A (animación + gráfica) sin tocar el panel B. */
function _clearPanelA() {
    stopSyncPlayer();
    stopSoloPlayer();
    gifPlayerA === null || gifPlayerA === void 0 ? void 0 : gifPlayerA.dispose();
    gifPlayerA = null;
    _currentOverlayA = null;
    removeActiveOverlay(map);
    switchColorbar(map, null, mapB !== null && mapB !== void 0 ? mapB : undefined);
    Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
    if (ndviChartDiv)
        Plotly.purge(ndviChartDiv);
    hidePlayerControls();
    if (compareYearASelect)
        compareYearASelect.value = '';
    if (compareSeasonASelect) {
        compareSeasonASelect.value = '';
        compareSeasonASelect.disabled = true;
    }
    if (btnGenerateA)
        btnGenerateA.disabled = true;
    if (chkStationSpA)
        chkStationSpA.checked = false;
    if (chkStationBdA)
        chkStationBdA.checked = false;
    _updateStationMarkersVisibility();
}
/** Limpia solo el panel B (animación + gráfica) sin tocar el panel A. */
function _clearPanelB() {
    stopSyncPlayer();
    stopSoloPlayer();
    gifPlayerB === null || gifPlayerB === void 0 ? void 0 : gifPlayerB.dispose();
    gifPlayerB = null;
    clearMapBOverlay();
    switchColorbar(map, null, mapB !== null && mapB !== void 0 ? mapB : undefined);
    Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
    if (chartBDiv)
        Plotly.purge(chartBDiv);
    hidePlayerControls();
    if (compareYearBSelect)
        compareYearBSelect.value = '';
    if (compareSeasonBSelect) {
        compareSeasonBSelect.value = '';
        compareSeasonBSelect.disabled = true;
    }
    if (btnGenerateB)
        btnGenerateB.disabled = true;
    if (chkStationSpB)
        chkStationSpB.checked = false;
    if (chkStationBdB)
        chkStationBdB.checked = false;
    _updateStationMarkersVisibility();
}
/** Limpia la animación y gráfica en modo normal (panel A). */
function _clearNormalMode() {
    stopSoloPlayer();
    gifPlayerA === null || gifPlayerA === void 0 ? void 0 : gifPlayerA.dispose();
    gifPlayerA = null;
    _currentOverlayA = null;
    removeActiveOverlay(map);
    switchColorbar(map, null);
    Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
    if (ndviChartDiv)
        Plotly.purge(ndviChartDiv);
    hidePlayerControls();
    hideChartContainer();
    _updateStationMarkersVisibility();
}
// ---------------------------------------------------------------------------
// Visibilidad de marcadores de estaciones
// ---------------------------------------------------------------------------
function _setMarkersVisible(markers, targetMap, visible) {
    for (const m of markers) {
        if (visible && !targetMap.hasLayer(m)) {
            m.addTo(targetMap);
        }
        else if (!visible && targetMap.hasLayer(m)) {
            targetMap.removeLayer(m);
        }
    }
}
/**
 * Muestra u oculta los marcadores de estaciones según el estado actual:
 * - Mapa A: visibles cuando no hay animación activa ni capas flood.
 * - Mapa B: visibles cuando no hay animación activa en panel B.
 */
function _updateStationMarkersVisibility() {
    const showOnMap = !_currentOverlayA && Object.keys(municipalFloodOverlays).length === 0;
    _setMarkersVisible(stationMarkersMap, map, showOnMap);
    if (mapB) {
        _setMarkersVisible(stationMarkersMapB, mapB, !activeBOverlay);
    }
}
function showPlayerControls() {
    playerControlsDiv === null || playerControlsDiv === void 0 ? void 0 : playerControlsDiv.classList.remove('hidden');
}
function hidePlayerControls() {
    playerControlsDiv === null || playerControlsDiv === void 0 ? void 0 : playerControlsDiv.classList.add('hidden');
}
function onPlayerFrameChange(current, total) {
    if (playerSlider) {
        playerSlider.max = String(total - 1);
        playerSlider.value = String(current);
    }
    if (playerFrameLabel) {
        playerFrameLabel.textContent = `${current + 1} / ${total}`;
    }
}
function syncPlayPauseIcon() {
    if (!playerPlayIcon)
        return;
    const active = syncPlayer !== null && syncPlayer !== void 0 ? syncPlayer : soloPlayer;
    playerPlayIcon.textContent = (active === null || active === void 0 ? void 0 : active.isPlaying) ? '⏸' : '▶';
}
/**
 * Crea un SyncPlayer cuando ambos paneles tienen GIF cargado.
 * Se llama al terminar de generar cualquiera de los dos paneles.
 */
function trySyncBothPanels() {
    if (!gifPlayerA || !gifPlayerB || !activeBOverlay)
        return;
    const overlayA = _currentOverlayA;
    if (!overlayA)
        return;
    // Detener el SoloPlayer que animaba cada panel por separado
    stopSoloPlayer();
    stopSyncPlayer();
    syncPlayer = new SyncPlayer();
    syncPlayer.frameIntervalMs = _selectedInterval();
    syncPlayer.onFrameChange = (current, total) => {
        onPlayerFrameChange(current, total);
        syncPlayPauseIcon();
    };
    syncPlayer.start(gifPlayerA, overlayA, gifPlayerB, activeBOverlay);
    if (playerSlider) {
        playerSlider.max = String(Math.max(gifPlayerA.frameCount, gifPlayerB.frameCount) - 1);
        playerSlider.value = '0';
    }
    showPlayerControls();
    syncPlayPauseIcon();
}
/** Referencia al overlay GifPlayer activo en map A (solo modo comparativa). */
let _currentOverlayA = null;
// ---------------------------------------------------------------------------
// Población de selectores de comparativa
// ---------------------------------------------------------------------------
/** Rellena un selector de años (mantiene solo el placeholder en pos 0). */
function _populateYearSelect(sel, years) {
    if (!sel)
        return;
    while (sel.options.length > 1)
        sel.remove(1);
    for (const year of years) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        sel.appendChild(opt);
    }
}
/** Rellena las temporadas si todavía solo tiene el placeholder. */
function _ensureSeasonOptions(sel) {
    if (!sel || sel.options.length > 1)
        return;
    for (const s of SEASONS) {
        const opt = document.createElement('option');
        opt.value = s.value;
        opt.textContent = s.label;
        sel.appendChild(opt);
    }
}
/** Inicializa los selectores de año/temporada de ambos paneles. */
function _initCompareSelects() {
    var _a, _b;
    const varA = ((_a = compareVarASelect === null || compareVarASelect === void 0 ? void 0 : compareVarASelect.value) !== null && _a !== void 0 ? _a : 'ndvi');
    const varB = ((_b = compareVarBSelect === null || compareVarBSelect === void 0 ? void 0 : compareVarBSelect.value) !== null && _b !== void 0 ? _b : 'ndvi');
    _populateYearSelect(compareYearASelect, VARIABLE_YEARS[varA]);
    _populateYearSelect(compareYearBSelect, VARIABLE_YEARS[varB]);
    _ensureSeasonOptions(compareSeasonASelect);
    _ensureSeasonOptions(compareSeasonBSelect);
}
/** Registra la lógica reactiva de los selectores de comparativa de un panel. */
function _wireCompareSelectPair(yearSel, seasonSel, btn) {
    if (!yearSel || !seasonSel || !btn)
        return;
    const sync = () => { btn.disabled = !yearSel.value || !seasonSel.value; };
    yearSel.addEventListener('change', () => {
        const hasYear = Boolean(yearSel.value);
        seasonSel.disabled = !hasYear;
        if (!hasYear)
            seasonSel.value = '';
        sync();
    });
    seasonSel.addEventListener('change', sync);
}
_wireCompareSelectPair(compareYearASelect, compareSeasonASelect, btnGenerateA);
_wireCompareSelectPair(compareYearBSelect, compareSeasonBSelect, btnGenerateB);
// Cuando cambia la variable en un panel, repoblar su selector de años
compareVarASelect === null || compareVarASelect === void 0 ? void 0 : compareVarASelect.addEventListener('change', () => {
    var _a;
    const v = ((_a = compareVarASelect.value) !== null && _a !== void 0 ? _a : 'ndvi');
    _populateYearSelect(compareYearASelect, VARIABLE_YEARS[v]);
    if (compareYearASelect)
        compareYearASelect.value = '';
    if (compareSeasonASelect) {
        compareSeasonASelect.value = '';
        compareSeasonASelect.disabled = true;
    }
    if (btnGenerateA)
        btnGenerateA.disabled = true;
});
compareVarBSelect === null || compareVarBSelect === void 0 ? void 0 : compareVarBSelect.addEventListener('change', () => {
    var _a;
    const v = ((_a = compareVarBSelect.value) !== null && _a !== void 0 ? _a : 'ndvi');
    _populateYearSelect(compareYearBSelect, VARIABLE_YEARS[v]);
    if (compareYearBSelect)
        compareYearBSelect.value = '';
    if (compareSeasonBSelect) {
        compareSeasonBSelect.value = '';
        compareSeasonBSelect.disabled = true;
    }
    if (btnGenerateB)
        btnGenerateB.disabled = true;
});
// ---------------------------------------------------------------------------
// Listener: toggle modo comparativa
// ---------------------------------------------------------------------------
function _deactivateFloodRiskMode() {
    if (!floodRiskModeActive)
        return;
    floodRiskModeActive = false;
    document.body.classList.remove('flood-risk-mode-active');
    toggleFloodRiskModeButton === null || toggleFloodRiskModeButton === void 0 ? void 0 : toggleFloodRiskModeButton.setAttribute('aria-pressed', 'false');
    floodRiskModeHint === null || floodRiskModeHint === void 0 ? void 0 : floodRiskModeHint.classList.add('hidden');
    // Eliminar todos los overlays de riesgo activos
    for (const muni of Object.keys(municipalFloodOverlays)) {
        const ov = municipalFloodOverlays[muni];
        if (ov)
            map.removeLayer(ov);
        delete municipalFloodOverlays[muni];
    }
    document.querySelectorAll('input.chk-flood-muni').forEach(chk => { chk.checked = false; });
    switchColorbar(map, null);
}
toggleCompareModeButton === null || toggleCompareModeButton === void 0 ? void 0 : toggleCompareModeButton.addEventListener('click', () => {
    compareModeActive = !compareModeActive;
    document.body.classList.toggle('compare-mode-active', compareModeActive);
    toggleCompareModeButton.setAttribute('aria-pressed', String(compareModeActive));
    if (compareModeActive) {
        // Desactivar flood risk mode si estaba activo
        _deactivateFloodRiskMode();
        // Limpiar estado previo
        _cleanupComparePanels();
        Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
        Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
        if (ndviChartDiv)
            Plotly.purge(ndviChartDiv);
        if (chartBDiv)
            Plotly.purge(chartBDiv);
        hidePlayerControls();
        // Mostrar controles de comparativa y pistas
        compareControlsA === null || compareControlsA === void 0 ? void 0 : compareControlsA.classList.remove('hidden');
        showChartBContainer();
        compareModeHint === null || compareModeHint === void 0 ? void 0 : compareModeHint.classList.remove('hidden');
        // Poblar selectores de año/temporada según la variable seleccionada en cada panel
        _initCompareSelects();
        initMapB();
        setTimeout(() => {
            map.invalidateSize();
            mapB === null || mapB === void 0 ? void 0 : mapB.invalidateSize();
        }, 350);
    }
    else {
        // Limpiar y restaurar modo normal
        _cleanupComparePanels();
        Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
        Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
        hidePlayerControls();
        hideChartBContainer();
        if (ndviChartDiv)
            Plotly.purge(ndviChartDiv);
        if (chartBDiv)
            Plotly.purge(chartBDiv);
        hideChartContainer();
        // Quitar colorbars de ambos mapas al salir de comparativa
        switchColorbar(map, null, mapB !== null && mapB !== void 0 ? mapB : undefined);
        // Limpiar bounding box
        drawnItems.clearLayers();
        currentBbox = null;
        compareControlsA === null || compareControlsA === void 0 ? void 0 : compareControlsA.classList.add('hidden');
        compareModeHint === null || compareModeHint === void 0 ? void 0 : compareModeHint.classList.add('hidden');
        setTimeout(() => map.invalidateSize(), 350);
    }
});
// ---------------------------------------------------------------------------
// Listener: toggle modo riesgo de inundación
// ---------------------------------------------------------------------------
toggleFloodRiskModeButton === null || toggleFloodRiskModeButton === void 0 ? void 0 : toggleFloodRiskModeButton.addEventListener('click', () => {
    floodRiskModeActive = !floodRiskModeActive;
    document.body.classList.toggle('flood-risk-mode-active', floodRiskModeActive);
    toggleFloodRiskModeButton.setAttribute('aria-pressed', String(floodRiskModeActive));
    if (floodRiskModeActive) {
        // Desactivar compare mode si estaba activo
        if (compareModeActive) {
            compareModeActive = false;
            document.body.classList.remove('compare-mode-active');
            toggleCompareModeButton === null || toggleCompareModeButton === void 0 ? void 0 : toggleCompareModeButton.setAttribute('aria-pressed', 'false');
            _cleanupComparePanels();
            Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
            Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
            hidePlayerControls();
            hideChartBContainer();
            if (ndviChartDiv)
                Plotly.purge(ndviChartDiv);
            if (chartBDiv)
                Plotly.purge(chartBDiv);
            switchColorbar(map, null, mapB !== null && mapB !== void 0 ? mapB : undefined);
            drawnItems.clearLayers();
            currentBbox = null;
            compareControlsA === null || compareControlsA === void 0 ? void 0 : compareControlsA.classList.add('hidden');
            compareModeHint === null || compareModeHint === void 0 ? void 0 : compareModeHint.classList.add('hidden');
            setTimeout(() => map.invalidateSize(), 350);
        }
        // Limpiar animación normal si existe
        _clearNormalMode();
        floodRiskModeHint === null || floodRiskModeHint === void 0 ? void 0 : floodRiskModeHint.classList.remove('hidden');
    }
    else {
        _deactivateFloodRiskMode();
    }
});
// ---------------------------------------------------------------------------
// Listener: limpiar modo normal
// ---------------------------------------------------------------------------
btnClearNormal === null || btnClearNormal === void 0 ? void 0 : btnClearNormal.addEventListener('click', () => { _clearNormalMode(); });
// ---------------------------------------------------------------------------
// Listener: play/pause
// ---------------------------------------------------------------------------
playerPlayPauseBtn === null || playerPlayPauseBtn === void 0 ? void 0 : playerPlayPauseBtn.addEventListener('click', () => {
    const active = syncPlayer !== null && syncPlayer !== void 0 ? syncPlayer : soloPlayer;
    if (!active)
        return;
    if (active.isPlaying) {
        active.pause();
    }
    else {
        active.play();
    }
    syncPlayPauseIcon();
});
playerSlider === null || playerSlider === void 0 ? void 0 : playerSlider.addEventListener('input', () => {
    if (!playerSlider)
        return;
    const frame = Number(playerSlider.value);
    syncPlayer === null || syncPlayer === void 0 ? void 0 : syncPlayer.goToFrame(frame);
    soloPlayer === null || soloPlayer === void 0 ? void 0 : soloPlayer.goToFrame(frame);
});
playerSpeedSelect === null || playerSpeedSelect === void 0 ? void 0 : playerSpeedSelect.addEventListener('change', () => {
    const ms = _selectedInterval();
    if (syncPlayer)
        syncPlayer.frameIntervalMs = ms;
    if (soloPlayer)
        soloPlayer.frameIntervalMs = ms;
});
// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal — modo NORMAL (panel A)
// ---------------------------------------------------------------------------
async function requestGifAndSeries(variable, start, end, bbox) {
    var _a;
    currentVariable = variable;
    const bboxJson = JSON.stringify(bbox);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
        + `&end=${encodeURIComponent(end)}`
        + `&bbox=${encodeURIComponent(bboxJson)}`
        + `&task_id=${encodeURIComponent(taskId)}`;
    const tsUrl = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
        + `&end=${encodeURIComponent(end)}`
        + `&bbox=${encodeURIComponent(bboxJson)}`;
    createProgressIndicator();
    const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
    eventSource.onmessage = (event) => {
        var _a;
        try {
            const data = JSON.parse(event.data);
            if (typeof data.progress !== 'number')
                return;
            updateProgressIndicator(data.progress, (_a = data.message) !== null && _a !== void 0 ? _a : '');
            if (data.progress === 100 || data.progress === -1) {
                eventSource.close();
                if (data.progress === 100)
                    removeProgressIndicator(1000);
                else
                    removeProgressIndicator(3000);
            }
        }
        catch { /* ignore */ }
    };
    eventSource.onerror = () => eventSource.close();
    try {
        const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);
        const gifData = await gifResp.json();
        const tsData = await tsResp.json();
        if (!gifResp.ok) {
            alert((_a = gifData.error) !== null && _a !== void 0 ? _a : 'Error generando animación.');
            return;
        }
        const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        // Limpiar player anterior antes de crear el nuevo
        stopSoloPlayer();
        gifPlayerA === null || gifPlayerA === void 0 ? void 0 : gifPlayerA.dispose();
        gifPlayerA = null;
        _currentOverlayA = null;
        removeActiveOverlay(map);
        const player = new GifPlayer();
        await player.load(gifData.gifUrl);
        const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
        setActiveOverlay(overlay);
        switchColorbar(map, variable);
        map.fitBounds(overlayBounds);
        gifPlayerA = player;
        _currentOverlayA = overlay;
        _updateStationMarkersVisibility();
        soloPlayer = new SoloPlayer();
        soloPlayer.frameIntervalMs = _selectedInterval();
        soloPlayer.onFrameChange = (current, total) => {
            onPlayerFrameChange(current, total);
            syncPlayPauseIcon();
        };
        soloPlayer.start(player, overlay);
        if (playerSlider) {
            playerSlider.max = String(player.frameCount - 1);
            playerSlider.value = '0';
        }
        showPlayerControls();
        syncPlayPauseIcon();
        if (tsResp.ok) {
            const dataKey = VARIABLE_DATA_KEY[variable];
            const values = tsData[dataKey];
            if (tsData.dates && values) {
                allSeriesData[variable] = { dates: tsData.dates, values };
                renderChart();
            }
        }
        else {
            console.warn('Error en serie temporal:', tsData.error);
        }
    }
    catch (err) {
        console.error(err);
        alert('Error de red al generar animación / serie temporal.');
        updateProgressIndicator(-1, 'Error de red');
        removeProgressIndicator(3000);
    }
    finally {
        eventSource.close();
    }
}
// ---------------------------------------------------------------------------
// Petición GIF + serie temporal — modo COMPARATIVA (panel A o B)
// ---------------------------------------------------------------------------
async function requestGifAndSeriesForPanel(panel, variable, start, end, bbox) {
    var _a;
    currentVariable = variable;
    const bboxJson = JSON.stringify(bbox);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
        + `&end=${encodeURIComponent(end)}`
        + `&bbox=${encodeURIComponent(bboxJson)}`
        + `&task_id=${encodeURIComponent(taskId)}`;
    const tsUrl = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
        + `&end=${encodeURIComponent(end)}`
        + `&bbox=${encodeURIComponent(bboxJson)}`;
    createProgressIndicator();
    const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
    eventSource.onmessage = (event) => {
        var _a;
        try {
            const data = JSON.parse(event.data);
            if (typeof data.progress !== 'number')
                return;
            updateProgressIndicator(data.progress, (_a = data.message) !== null && _a !== void 0 ? _a : '');
            if (data.progress === 100 || data.progress === -1) {
                eventSource.close();
                if (data.progress === 100)
                    removeProgressIndicator(1000);
                else
                    removeProgressIndicator(3000);
            }
        }
        catch { /* ignore */ }
    };
    eventSource.onerror = () => eventSource.close();
    try {
        const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);
        const gifData = await gifResp.json();
        const tsData = await tsResp.json();
        if (!gifResp.ok) {
            alert((_a = gifData.error) !== null && _a !== void 0 ? _a : `Error generando animación (panel ${panel}).`);
            return;
        }
        const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        // Parar toda reproducción antes de modificar cualquier panel
        stopSoloPlayer();
        stopSyncPlayer();
        hidePlayerControls();
        if (panel === 'A') {
            // Liberar recursos anteriores del panel A
            gifPlayerA === null || gifPlayerA === void 0 ? void 0 : gifPlayerA.dispose();
            gifPlayerA = null;
            _currentOverlayA = null;
            removeActiveOverlay(map);
            const player = new GifPlayer();
            await player.load(gifData.gifUrl);
            const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
            setActiveOverlay(overlay);
            // En compare mode la colorbar va al panel derecho (mapB)
            if (mapB)
                switchColorbar(mapB, variable, map);
            map.fitBounds(overlayBounds);
            gifPlayerA = player;
            _currentOverlayA = overlay;
            _updateStationMarkersVisibility();
            // Animar panel A de forma independiente hasta que llegue el panel B
            soloPlayer = new SoloPlayer();
            soloPlayer.frameIntervalMs = _selectedInterval();
            soloPlayer.onFrameChange = (current, total) => {
                onPlayerFrameChange(current, total);
                syncPlayPauseIcon();
            };
            soloPlayer.start(player, overlay);
            if (playerSlider) {
                playerSlider.max = String(player.frameCount - 1);
                playerSlider.value = '0';
            }
            showPlayerControls();
            syncPlayPauseIcon();
            if (tsResp.ok) {
                const dataKey = VARIABLE_DATA_KEY[variable];
                const values = tsData[dataKey];
                if (tsData.dates && values) {
                    allSeriesData[variable] = { dates: tsData.dates, values };
                    renderChart();
                }
            }
            else {
                console.warn('Error en serie temporal panel A:', tsData.error);
            }
        }
        else {
            // Panel B
            gifPlayerB === null || gifPlayerB === void 0 ? void 0 : gifPlayerB.dispose();
            gifPlayerB = null;
            clearMapBOverlay();
            const player = new GifPlayer();
            await player.load(gifData.gifUrl);
            const overlay = L.imageOverlay(player.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(mapB);
            activeBOverlay = overlay;
            _updateStationMarkersVisibility();
            // La colorbar siempre en el panel derecho (mapB) en compare mode
            switchColorbar(mapB, variable, map);
            mapB === null || mapB === void 0 ? void 0 : mapB.fitBounds(overlayBounds);
            setTimeout(() => mapB === null || mapB === void 0 ? void 0 : mapB.setView(map.getCenter(), map.getZoom(), { animate: false }), 100);
            gifPlayerB = player;
            if (tsResp.ok) {
                const dataKeyB = VARIABLE_DATA_KEY[variable];
                const valuesB = tsData[dataKeyB];
                if (tsData.dates && valuesB) {
                    allSeriesDataB[variable] = { dates: tsData.dates, values: valuesB };
                    renderChartB();
                }
            }
            else {
                console.warn('Error en serie temporal panel B:', tsData.error);
            }
        }
        // Si ambos paneles tienen GIF → sincronizar
        trySyncBothPanels();
    }
    catch (err) {
        console.error(err);
        alert(`Error de red al generar animación / serie temporal (panel ${panel}).`);
        updateProgressIndicator(-1, 'Error de red');
        removeProgressIndicator(3000);
    }
    finally {
        eventSource.close();
    }
}
// ---------------------------------------------------------------------------
// Listeners: "Generar panel A" y "Generar panel B" (modo comparativa)
// ---------------------------------------------------------------------------
btnGenerateA === null || btnGenerateA === void 0 ? void 0 : btnGenerateA.addEventListener('click', () => {
    var _a;
    const variable = ((_a = compareVarASelect === null || compareVarASelect === void 0 ? void 0 : compareVarASelect.value) !== null && _a !== void 0 ? _a : 'ndvi');
    const year = Number(compareYearASelect === null || compareYearASelect === void 0 ? void 0 : compareYearASelect.value);
    const season = compareSeasonASelect === null || compareSeasonASelect === void 0 ? void 0 : compareSeasonASelect.value;
    const bbox = currentBbox;
    if (!year || !season) {
        alert('Selecciona año y temporada para el panel A.');
        return;
    }
    if (!bbox) {
        alert('Dibuja primero un rectángulo en el mapa.');
        return;
    }
    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('A', variable, start, end, bbox);
});
btnGenerateB === null || btnGenerateB === void 0 ? void 0 : btnGenerateB.addEventListener('click', () => {
    var _a;
    const variable = ((_a = compareVarBSelect === null || compareVarBSelect === void 0 ? void 0 : compareVarBSelect.value) !== null && _a !== void 0 ? _a : 'ndvi');
    const year = Number(compareYearBSelect === null || compareYearBSelect === void 0 ? void 0 : compareYearBSelect.value);
    const season = compareSeasonBSelect === null || compareSeasonBSelect === void 0 ? void 0 : compareSeasonBSelect.value;
    const bbox = currentBbox;
    if (!year || !season) {
        alert('Selecciona año y temporada para el panel B.');
        return;
    }
    if (!bbox) {
        alert('Dibuja primero un rectángulo en el mapa.');
        return;
    }
    const { start, end } = seasonToDates(year, season);
    void requestGifAndSeriesForPanel('B', variable, start, end, bbox);
});
btnClearA === null || btnClearA === void 0 ? void 0 : btnClearA.addEventListener('click', () => { _clearPanelA(); });
btnClearB === null || btnClearB === void 0 ? void 0 : btnClearB.addEventListener('click', () => { _clearPanelB(); });
// ---------------------------------------------------------------------------
// Riesgo de inundación por municipio
// ---------------------------------------------------------------------------
async function toggleMunicipalFloodRisk(muni, checked) {
    var _a, _b;
    if (!checked) {
        const existing = municipalFloodOverlays[muni];
        if (existing) {
            map.removeLayer(existing);
            delete municipalFloodOverlays[muni];
        }
        // Ocultar colorbar si ya no hay ninguna capa de riesgo activa
        if (Object.keys(municipalFloodOverlays).length === 0) {
            switchColorbar(map, null);
        }
        _updateStationMarkersVisibility();
        return;
    }
    if (municipalFloodOverlays[muni]) {
        (_a = municipalFloodOverlays[muni]) === null || _a === void 0 ? void 0 : _a.addTo(map);
        _updateStationMarkersVisibility();
        return;
    }
    try {
        const resp = await fetch(`/api/flood-risk-municipio?muni=${encodeURIComponent(muni)}`);
        const data = await resp.json();
        if (!resp.ok) {
            alert((_b = data.error) !== null && _b !== void 0 ? _b : 'Error generando mapa de riesgo por municipio.');
            return;
        }
        const [minLon, minLat, maxLon, maxLat] = data.bbox;
        const bounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        const overlay = L.imageOverlay(data.mapUrl, bounds, { opacity: 0.8 }).addTo(map);
        municipalFloodOverlays[muni] = overlay;
        switchColorbar(map, 'flood');
        _updateStationMarkersVisibility();
    }
    catch (err) {
        console.error(err);
        alert('Error de red al generar mapa de riesgo por municipio.');
    }
}
// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------
async function requestLocalStationLevel(stationId, start, end) {
    var _a;
    const url = `/api/local-station-level-range?station=${encodeURIComponent(stationId)}`
        + `&start=${encodeURIComponent(start)}`
        + `&end=${encodeURIComponent(end)}`;
    try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (!resp.ok) {
            alert((_a = data.error) !== null && _a !== void 0 ? _a : 'Error cargando serie de nivel de estación local.');
            return;
        }
        const key = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
        allSeriesData[key] = { dates: data.dates, values: data.level_m };
        renderChart();
    }
    catch (err) {
        console.error(err);
        alert('Error de red al cargar serie de estación local.');
    }
}
// ---------------------------------------------------------------------------
// Selectores DOM — variables principales
// ---------------------------------------------------------------------------
const ndviYearSelect = document.getElementById('ndviYear');
const ndviSeasonSelect = document.getElementById('ndviSeason');
const generateGifButton = document.getElementById('generateNdviGifBBox');
const tempYearSelect = document.getElementById('tempYear');
const tempSeasonSelect = document.getElementById('tempSeason');
const generateTempGifButton = document.getElementById('generateTempGifBBox');
const soilYearSelect = document.getElementById('soilYear');
const soilSeasonSelect = document.getElementById('soilSeason');
const generateSoilGifButton = document.getElementById('generateSoilGifBBox');
const precipYearSelect = document.getElementById('precipYear');
const precipSeasonSelect = document.getElementById('precipSeason');
const generatePrecipGifButton = document.getElementById('generatePrecipGifBBox');
const waterYearSelect = document.getElementById('waterYear');
const waterSeasonSelect = document.getElementById('waterSeason');
const generateWaterGifButton = document.getElementById('generateWaterGifBBox');
// Selectores DOM — estaciones locales
const spYearSelect = document.getElementById('spYear');
const spSeasonSelect = document.getElementById('spSeason');
const btnLocalSpLevel = document.getElementById('btnLocalSpLevel');
const bdYearSelect = document.getElementById('bdYear');
const bdSeasonSelect = document.getElementById('bdSeason');
const btnLocalBdLevel = document.getElementById('btnLocalBdLevel');
// ---------------------------------------------------------------------------
// Registro de listeners usando la factory
// ---------------------------------------------------------------------------
const getBbox = () => currentBbox;
const variableConfigs = [
    { variable: 'ndvi', yearSelect: ndviYearSelect, seasonSelect: ndviSeasonSelect, button: generateGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'temp', yearSelect: tempYearSelect, seasonSelect: tempSeasonSelect, button: generateTempGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'soil', yearSelect: soilYearSelect, seasonSelect: soilSeasonSelect, button: generateSoilGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'precip', yearSelect: precipYearSelect, seasonSelect: precipSeasonSelect, button: generatePrecipGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'water', yearSelect: waterYearSelect, seasonSelect: waterSeasonSelect, button: generateWaterGifButton, getBbox, onRequest: requestGifAndSeries },
];
variableConfigs.forEach(cfg => registerVariableListener(cfg));
// ---------------------------------------------------------------------------
// Listeners de estaciones locales (año + temporada)
// ---------------------------------------------------------------------------
function _wireLocalStation(yearSel, seasonSel, btn, stationId, stationKey) {
    if (!yearSel || !seasonSel || !btn)
        return;
    // Poblar selectores
    for (const year of VARIABLE_YEARS[stationKey]) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        yearSel.appendChild(opt);
    }
    for (const s of SEASONS) {
        const opt = document.createElement('option');
        opt.value = s.value;
        opt.textContent = s.label;
        seasonSel.appendChild(opt);
    }
    const syncBtn = () => { btn.disabled = !yearSel.value || !seasonSel.value; };
    yearSel.addEventListener('change', () => {
        const hasYear = Boolean(yearSel.value);
        seasonSel.disabled = !hasYear;
        if (!hasYear)
            seasonSel.value = '';
        syncBtn();
    });
    seasonSel.addEventListener('change', syncBtn);
    btn.addEventListener('click', () => {
        const year = Number(yearSel.value);
        const season = seasonSel.value;
        if (!year || !season) {
            alert('Selecciona año y temporada.');
            return;
        }
        const { start, end } = seasonToDates(year, season);
        void requestLocalStationLevel(stationId, start, end);
    });
}
_wireLocalStation(spYearSelect, spSeasonSelect, btnLocalSpLevel, 'SPTTB', 'local_sp');
_wireLocalStation(bdYearSelect, bdSeasonSelect, btnLocalBdLevel, 'BDCTB', 'local_bd');
// ---------------------------------------------------------------------------
// Checkboxes de estaciones en modo comparativa
// ---------------------------------------------------------------------------
const chkStationSpA = document.getElementById('chkStationSpA');
const chkStationBdA = document.getElementById('chkStationBdA');
const chkStationSpB = document.getElementById('chkStationSpB');
const chkStationBdB = document.getElementById('chkStationBdB');
async function _loadCompareStation(stationId, panel, year, season) {
    var _a;
    const { start, end } = seasonToDates(Number(year), season);
    const url = `/api/local-station-level-range?station=${encodeURIComponent(stationId)}`
        + `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (!resp.ok) {
            alert((_a = data.error) !== null && _a !== void 0 ? _a : 'Error cargando serie de nivel de estación local.');
            return;
        }
        const key = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
        if (panel === 'A') {
            allSeriesData[key] = { dates: data.dates, values: data.level_m };
            renderChart();
        }
        else {
            allSeriesDataB[key] = { dates: data.dates, values: data.level_m };
            renderChartB();
        }
    }
    catch (err) {
        console.error(err);
        alert('Error de red al cargar serie de estación local.');
    }
}
function _wireCompareStationCheck(chk, stationId, panel, yearSel, seasonSel) {
    if (!chk)
        return;
    chk.addEventListener('change', () => {
        var _a, _b;
        const key = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
        if (chk.checked) {
            const year = (_a = yearSel === null || yearSel === void 0 ? void 0 : yearSel.value) !== null && _a !== void 0 ? _a : '';
            const season = (_b = seasonSel === null || seasonSel === void 0 ? void 0 : seasonSel.value) !== null && _b !== void 0 ? _b : '';
            if (!year || !season) {
                alert('Selecciona año y temporada del panel antes de cargar la estación.');
                chk.checked = false;
                return;
            }
            void _loadCompareStation(stationId, panel, year, season);
        }
        else {
            if (panel === 'A') {
                delete allSeriesData[key];
                renderChart();
            }
            else {
                delete allSeriesDataB[key];
                renderChartB();
            }
        }
    });
}
_wireCompareStationCheck(chkStationSpA, 'SPTTB', 'A', compareYearASelect, compareSeasonASelect);
_wireCompareStationCheck(chkStationBdA, 'BDCTB', 'A', compareYearASelect, compareSeasonASelect);
_wireCompareStationCheck(chkStationSpB, 'SPTTB', 'B', compareYearBSelect, compareSeasonBSelect);
_wireCompareStationCheck(chkStationBdB, 'BDCTB', 'B', compareYearBSelect, compareSeasonBSelect);
// ---------------------------------------------------------------------------
// Listeners de municipios (riesgo de inundación)
// ---------------------------------------------------------------------------
document.querySelectorAll('input.chk-flood-muni').forEach(chk => {
    chk.addEventListener('change', () => {
        const muni = chk.dataset['muni'];
        if (!muni)
            return;
        void toggleMunicipalFloodRisk(muni, chk.checked);
    });
});
// ---------------------------------------------------------------------------
// Actualizar currentVariable al abrir un details de variable
// ---------------------------------------------------------------------------
const variableDetailsMap = {
    'ndvi-controls': 'ndvi',
    'temp-controls': 'temp',
    'soil-controls': 'soil',
    'precip-controls': 'precip',
    'water-controls': 'water',
};
document.querySelectorAll('details[id]').forEach(details => {
    details.addEventListener('toggle', () => {
        if (!details.open || compareModeActive)
            return;
        const v = variableDetailsMap[details.id];
        if (!v)
            return;
        currentVariable = v;
    });
});
// ---------------------------------------------------------------------------
// Listener: botón "Ver datos" en popup de estaciones locales
// ---------------------------------------------------------------------------
document.addEventListener('click', (e) => {
    const link = e.target.closest('.station-full-data-link');
    if (!link)
        return;
    e.preventDefault();
    const stationId = link.dataset['stationId'];
    if (!stationId)
        return;
    void requestLocalStationLevel(stationId, '2000-01-01', '2024-12-31');
});
// ---------------------------------------------------------------------------
// Sidebar colapsar/restaurar
// ---------------------------------------------------------------------------
const collapseButton = document.getElementById('sidebarToggle');
const restoreButton = document.getElementById('sidebarRestore');
const body = document.body;
if (collapseButton && restoreButton) {
    const collapseSr = collapseButton.querySelector('.sr-only');
    const restoreSr = restoreButton.querySelector('.sr-only');
    const syncState = () => {
        const isHidden = body.classList.contains('sidebar-collapsed');
        collapseButton.setAttribute('aria-expanded', String(!isHidden));
        restoreButton.setAttribute('aria-expanded', String(isHidden));
        const label = isHidden ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
        if (collapseSr)
            collapseSr.textContent = label;
        if (restoreSr)
            restoreSr.textContent = label;
        setTimeout(() => {
            map.invalidateSize();
            mapB === null || mapB === void 0 ? void 0 : mapB.invalidateSize();
        }, 350);
    };
    syncState();
    collapseButton.addEventListener('click', () => { body.classList.add('sidebar-collapsed'); syncState(); });
    restoreButton.addEventListener('click', () => { body.classList.remove('sidebar-collapsed'); syncState(); });
}
//# sourceMappingURL=main.js.map