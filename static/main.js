/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */
import { VARIABLE_DATA_KEY } from './types.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_SPAN_DEG, GIF_ENDPOINT, TS_ENDPOINT } from './config.js';
import { buildColorbars, switchColorbar, removeActiveOverlay, setActiveOverlay, municipalFloodOverlays, } from './map/overlays.js';
import { createProgressIndicator, updateProgressIndicator, removeProgressIndicator, } from './ui/progress.js';
import { plotAllSelectedSeries } from './ui/chart.js';
import { registerVariableListener } from './listeners/variableListeners.js';
import { GifPlayer, SyncPlayer } from './ui/gifPlayer.js';
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
    // Limpiar series y estado de comparativa al dibujar un bbox nuevo
    Object.keys(allSeriesData).forEach(k => delete allSeriesData[k]);
    Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
    destroySyncPlayer();
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
    ndviChartContainer === null || ndviChartContainer === void 0 ? void 0 : ndviChartContainer.classList.remove('hidden');
}
function hideChartContainer() {
    ndviChartContainer === null || ndviChartContainer === void 0 ? void 0 : ndviChartContainer.classList.add('hidden');
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
let mapBSyncLock = false; // Evita bucle infinito al sincronizar vistas
/** Mapa de overlay activo en panel B. */
let activeBOverlay = null;
/** Instancia del SyncPlayer activo (puede ser null si no hay GIFs cargados). */
let syncPlayer = null;
// DOM: controles del modo comparativa
const toggleCompareModeButton = document.getElementById('toggleCompareMode');
const compareYearBWrapper = document.getElementById('compareYearBWrapper');
const compareYearBInput = document.getElementById('compareYearB');
// DOM: player controls
const playerControlsDiv = document.getElementById('player-controls');
const playerPlayPauseBtn = document.getElementById('playerPlayPause');
const playerSlider = document.getElementById('playerSlider');
const playerFrameLabel = document.getElementById('playerFrameLabel');
const playerPlayIcon = document.getElementById('playerPlayIcon');
/** Inicializa mapB la primera vez que se activa el modo comparativa. */
function initMapB() {
    if (mapB)
        return;
    mapB = L.map('map-b', { zoomControl: false }).setView(map.getCenter(), map.getZoom());
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapB);
    // Sincronizar pan/zoom A → B
    map.on('moveend', () => {
        if (mapBSyncLock || !mapB)
            return;
        mapBSyncLock = true;
        mapB.setView(map.getCenter(), map.getZoom(), { animate: false });
        mapBSyncLock = false;
    });
    // Sincronizar pan/zoom B → A
    mapB.on('moveend', () => {
        if (mapBSyncLock)
            return;
        mapBSyncLock = true;
        map.setView(mapB.getCenter(), mapB.getZoom(), { animate: false });
        mapBSyncLock = false;
    });
}
function clearMapBOverlay() {
    if (activeBOverlay && mapB) {
        mapB.removeLayer(activeBOverlay);
        activeBOverlay = null;
    }
}
function destroySyncPlayer() {
    if (syncPlayer) {
        syncPlayer.destroy();
        syncPlayer = null;
    }
}
function showPlayerControls() {
    playerControlsDiv === null || playerControlsDiv === void 0 ? void 0 : playerControlsDiv.classList.remove('hidden');
}
function hidePlayerControls() {
    playerControlsDiv === null || playerControlsDiv === void 0 ? void 0 : playerControlsDiv.classList.add('hidden');
}
/** Actualiza el slider y el label de frame. */
function onPlayerFrameChange(current, total) {
    if (playerSlider) {
        playerSlider.max = String(total - 1);
        playerSlider.value = String(current);
    }
    if (playerFrameLabel) {
        playerFrameLabel.textContent = `${current + 1} / ${total}`;
    }
}
/** Sincroniza el ícono play/pause con el estado actual. */
function syncPlayPauseIcon() {
    if (!playerPlayIcon)
        return;
    playerPlayIcon.textContent = (syncPlayer === null || syncPlayer === void 0 ? void 0 : syncPlayer.isPlaying) ? '⏸' : '▶';
}
// Listener: toggle modo comparativa
toggleCompareModeButton === null || toggleCompareModeButton === void 0 ? void 0 : toggleCompareModeButton.addEventListener('click', () => {
    compareModeActive = !compareModeActive;
    document.body.classList.toggle('compare-mode-active', compareModeActive);
    toggleCompareModeButton.setAttribute('aria-pressed', String(compareModeActive));
    if (compareModeActive) {
        compareYearBWrapper === null || compareYearBWrapper === void 0 ? void 0 : compareYearBWrapper.classList.remove('hidden');
        initMapB();
        // Forzar invalidateSize en el mapa A (ahora ocupa la mitad del ancho)
        setTimeout(() => {
            map.invalidateSize();
            mapB === null || mapB === void 0 ? void 0 : mapB.invalidateSize();
        }, 350); // Espera la transición CSS
    }
    else {
        compareYearBWrapper === null || compareYearBWrapper === void 0 ? void 0 : compareYearBWrapper.classList.add('hidden');
        // Limpiar estado al desactivar
        Object.keys(allSeriesDataB).forEach(k => delete allSeriesDataB[k]);
        destroySyncPlayer();
        hidePlayerControls();
        hideChartBContainer();
        clearMapBOverlay();
        if (chartBDiv)
            Plotly.purge(chartBDiv);
        // Restaurar tamaño del mapa A
        setTimeout(() => map.invalidateSize(), 350);
    }
});
// Listener: play/pause
playerPlayPauseBtn === null || playerPlayPauseBtn === void 0 ? void 0 : playerPlayPauseBtn.addEventListener('click', () => {
    if (!syncPlayer)
        return;
    if (syncPlayer.isPlaying) {
        syncPlayer.pause();
    }
    else {
        syncPlayer.play();
    }
    syncPlayPauseIcon();
});
// Listener: slider de frames — goToFrame dispara onFrameChange internamente
playerSlider === null || playerSlider === void 0 ? void 0 : playerSlider.addEventListener('input', () => {
    if (!syncPlayer || !playerSlider)
        return;
    syncPlayer.goToFrame(Number(playerSlider.value));
});
// ---------------------------------------------------------------------------
// Helper: calcular fechas del período B
// ---------------------------------------------------------------------------
/**
 * Sustituye el año en una fecha ISO (YYYY-MM-DD) por yearB.
 * Maneja el 29 de febrero: si el año destino no es bisiesto, devuelve el 28.
 */
function replaceDateYear(dateStr, yearB) {
    const [, month, day] = dateStr.split('-');
    // Validar 29-feb en año no bisiesto
    if (month === '02' && day === '29' && !isLeapYear(yearB)) {
        return `${yearB}-02-28`;
    }
    return `${yearB}-${month}-${day}`;
}
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal
// ---------------------------------------------------------------------------
async function requestGifAndSeries(variable, start, end, bbox) {
    var _a, _b;
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
    // ---- Validar año B si está en modo comparativa ----
    let startB = '';
    let endB = '';
    let gifUrlB = '';
    let tsUrlB = '';
    if (compareModeActive) {
        const yearBRaw = compareYearBInput === null || compareYearBInput === void 0 ? void 0 : compareYearBInput.value.trim();
        if (!yearBRaw) {
            alert('Modo comparativa activo: introduce el año B antes de generar.');
            return;
        }
        const yearB = Number(yearBRaw);
        if (!Number.isInteger(yearB) || yearB < 2000 || yearB > 2030) {
            alert('El año B debe ser un número entero entre 2000 y 2030.');
            return;
        }
        const yearA = Number(start.substring(0, 4));
        if (yearB === yearA) {
            alert('El año B debe ser diferente al año del período A.');
            return;
        }
        startB = replaceDateYear(start, yearB);
        endB = replaceDateYear(end, yearB);
        const taskIdB = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        gifUrlB = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(startB)}`
            + `&end=${encodeURIComponent(endB)}`
            + `&bbox=${encodeURIComponent(bboxJson)}`
            + `&task_id=${encodeURIComponent(taskIdB)}`;
        tsUrlB = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(startB)}`
            + `&end=${encodeURIComponent(endB)}`
            + `&bbox=${encodeURIComponent(bboxJson)}`;
    }
    createProgressIndicator();
    const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateProgressIndicator(data.progress, data.message);
            if (data.progress === 100 || data.progress === -1) {
                eventSource.close();
                if (data.progress === 100)
                    removeProgressIndicator(1000);
            }
        }
        catch {
            // silently ignore malformed SSE messages
        }
    };
    eventSource.onerror = () => eventSource.close();
    try {
        // Lanzar todas las peticiones en paralelo
        const fetches = [fetch(gifUrl), fetch(tsUrl)];
        if (compareModeActive) {
            fetches.push(fetch(gifUrlB), fetch(tsUrlB));
        }
        const responses = await Promise.all(fetches);
        const [gifResp, tsResp, gifRespB, tsRespB] = responses;
        const gifData = await gifResp.json();
        const tsData = await tsResp.json();
        if (!gifResp.ok) {
            alert((_a = gifData.error) !== null && _a !== void 0 ? _a : 'Error generando animación.');
            return;
        }
        const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        // ---- Modo normal: overlay nativo del browser ----
        if (!compareModeActive) {
            removeActiveOverlay(map);
            const overlay = L.imageOverlay(gifData.gifUrl, overlayBounds, { opacity: 0.8 }).addTo(map);
            setActiveOverlay(overlay);
            switchColorbar(map, variable);
            map.fitBounds(overlayBounds);
            // ---- Modo comparativa: GifPlayer + SyncPlayer ----
        }
        else {
            if (!gifRespB || !tsRespB)
                return;
            const gifDataB = await gifRespB.json();
            if (!gifRespB.ok) {
                alert((_b = gifDataB.error) !== null && _b !== void 0 ? _b : 'Error generando animación del período B.');
                return;
            }
            // Destruir reproducción anterior si existía
            destroySyncPlayer();
            clearMapBOverlay();
            removeActiveOverlay(map);
            // Pre-renderizar ambos GIFs (puede tardar unos segundos)
            const [pA, pB] = await Promise.all([
                (async () => { const p = new GifPlayer(); await p.load(gifData.gifUrl); return p; })(),
                (async () => { const p = new GifPlayer(); await p.load(gifDataB.gifUrl); return p; })(),
            ]);
            // Crear overlays con el primer frame
            const overlayA = L.imageOverlay(pA.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
            setActiveOverlay(overlayA);
            switchColorbar(map, variable);
            map.fitBounds(overlayBounds);
            const [minLonB, minLatB, maxLonB, maxLatB] = gifDataB.bbox;
            const overlayBoundsB = L.latLngBounds(L.latLng(minLatB, minLonB), L.latLng(maxLatB, maxLonB));
            const overlayB = L.imageOverlay(pB.getFrameUrl(0), overlayBoundsB, { opacity: 0.8 }).addTo(mapB);
            activeBOverlay = overlayB;
            mapB === null || mapB === void 0 ? void 0 : mapB.fitBounds(overlayBoundsB);
            // Sincronizar zoom/posición de mapB con mapA tras fitBounds
            setTimeout(() => mapB === null || mapB === void 0 ? void 0 : mapB.setView(map.getCenter(), map.getZoom(), { animate: false }), 100);
            // Iniciar SyncPlayer
            syncPlayer = new SyncPlayer();
            syncPlayer.onFrameChange = (current, total) => {
                onPlayerFrameChange(current, total);
                syncPlayPauseIcon();
            };
            syncPlayer.start(pA, overlayA, pB, overlayB);
            // Configurar slider
            if (playerSlider) {
                playerSlider.max = String(Math.max(pA.frameCount, pB.frameCount) - 1);
                playerSlider.value = '0';
            }
            showPlayerControls();
            syncPlayPauseIcon();
            // Serie temporal B
            const tsDataB = await tsRespB.json();
            if (tsRespB.ok) {
                const dataKeyB = VARIABLE_DATA_KEY[variable];
                const valuesB = tsDataB[dataKeyB];
                if (tsDataB.dates && valuesB) {
                    allSeriesDataB[variable] = { dates: tsDataB.dates, values: valuesB };
                    renderChartB();
                }
            }
            else {
                console.warn('Error en serie temporal período B:', tsDataB.error);
            }
        }
        // ---- Serie temporal A (común a ambos modos) ----
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
        return;
    }
    if (municipalFloodOverlays[muni]) {
        (_a = municipalFloodOverlays[muni]) === null || _a === void 0 ? void 0 : _a.addTo(map);
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
// Inputs del DOM
// ---------------------------------------------------------------------------
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const generateGifButton = document.getElementById('generateNdviGifBBox');
const tempStartInput = document.getElementById('tempStartDate');
const tempEndInput = document.getElementById('tempEndDate');
const generateTempGifButton = document.getElementById('generateTempGifBBox');
const soilStartInput = document.getElementById('soilStartDate');
const soilEndInput = document.getElementById('soilEndDate');
const generateSoilGifButton = document.getElementById('generateSoilGifBBox');
const precipStartInput = document.getElementById('precipStartDate');
const precipEndInput = document.getElementById('precipEndDate');
const generatePrecipGifButton = document.getElementById('generatePrecipGifBBox');
const waterStartInput = document.getElementById('waterStartDate');
const waterEndInput = document.getElementById('waterEndDate');
const generateWaterGifButton = document.getElementById('generateWaterGifBBox');
const spStartInput = document.getElementById('spStartDate');
const spEndInput = document.getElementById('spEndDate');
const bdStartInput = document.getElementById('bdStartDate');
const bdEndInput = document.getElementById('bdEndDate');
const btnLocalSpLevel = document.getElementById('btnLocalSpLevel');
const btnLocalBdLevel = document.getElementById('btnLocalBdLevel');
// ---------------------------------------------------------------------------
// R8: Registro de listeners usando la factory
// ---------------------------------------------------------------------------
const getBbox = () => currentBbox;
const variableConfigs = [
    { variable: 'ndvi', startInput, endInput, button: generateGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'temp', startInput: tempStartInput, endInput: tempEndInput, button: generateTempGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'soil', startInput: soilStartInput, endInput: soilEndInput, button: generateSoilGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'precip', startInput: precipStartInput, endInput: precipEndInput, button: generatePrecipGifButton, getBbox, onRequest: requestGifAndSeries },
    { variable: 'water', startInput: waterStartInput, endInput: waterEndInput, button: generateWaterGifButton, getBbox, onRequest: requestGifAndSeries },
];
variableConfigs.forEach(cfg => registerVariableListener(cfg));
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
// Listeners de estaciones locales
// ---------------------------------------------------------------------------
btnLocalSpLevel === null || btnLocalSpLevel === void 0 ? void 0 : btnLocalSpLevel.addEventListener('click', () => {
    const start = spStartInput === null || spStartInput === void 0 ? void 0 : spStartInput.value;
    const end = spEndInput === null || spEndInput === void 0 ? void 0 : spEndInput.value;
    if (!start || !end) {
        alert('Selecciona fecha inicio y fecha fin para San Pedro.');
        return;
    }
    void requestLocalStationLevel('SPTTB', start, end);
});
btnLocalBdLevel === null || btnLocalBdLevel === void 0 ? void 0 : btnLocalBdLevel.addEventListener('click', () => {
    const start = bdStartInput === null || bdStartInput === void 0 ? void 0 : bdStartInput.value;
    const end = bdEndInput === null || bdEndInput === void 0 ? void 0 : bdEndInput.value;
    if (!start || !end) {
        alert('Selecciona fecha inicio y fecha fin para Boca del Cerro.');
        return;
    }
    void requestLocalStationLevel('BDCTB', start, end);
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
        // Invalidar tamaño de mapas tras la transición del sidebar
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