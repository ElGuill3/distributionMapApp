"use strict";
const DEFAULT_CENTER = [17.8409, -92.6189];
const DEFAULT_ZOOM = 8;
const MAX_SPAN_DEG = 8.0;
let currentVariable = 'ndvi';
const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);
const osmBase = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
osmBase.addTo(map);
// Referencias gráfica
const ndviChartContainer = document.getElementById('ndvi-chart-container');
const ndviChartDiv = document.getElementById('ndvi-chart');
function showChartContainer() {
    if (!ndviChartContainer)
        return;
    ndviChartContainer.classList.remove('hidden');
}
function hideChartContainer() {
    if (!ndviChartContainer)
        return;
    ndviChartContainer.classList.add('hidden');
}
// ========== Leaflet.draw: selección de bbox ==========
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
    draw: {
        marker: false,
        circle: false,
        polyline: false,
        polygon: false,
        circlemarker: false,
        rectangle: {
            shapeOptions: {
                color: '#ff7800',
                weight: 2
            }
        }
    },
    edit: {
        featureGroup: drawnItems,
        edit: true,
        remove: true
    }
});
map.addControl(drawControl);
let currentBbox = null;
// overlay de la variable activa (GIF)
let activeOverlay = null;
map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    const bounds = layer.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const widthDeg = Math.abs(northEast.lng - southWest.lng);
    const heightDeg = Math.abs(northEast.lat - southWest.lat);
    if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
        alert('El bounding box es demasiado grande (máx. ~8° por lado). Dibuja una región más pequeña.');
        return;
    }
    const centerLat = (southWest.lat + northEast.lat) / 2;
    const centerLng = (southWest.lng + northEast.lng) / 2;
    const side = Math.min(widthDeg, heightDeg);
    const halfSide = side / 2;
    const squareSouth = centerLat - halfSide;
    const squareNorth = centerLat + halfSide;
    const squareWest = centerLng - halfSide;
    const squareEast = centerLng + halfSide;
    const squareBounds = L.latLngBounds(L.latLng(squareSouth, squareWest), L.latLng(squareNorth, squareEast));
    if (layer.setBounds) {
        layer.setBounds(squareBounds);
    }
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
    currentBbox = [squareWest, squareSouth, squareEast, squareNorth];
    if (activeOverlay) {
        map.removeLayer(activeOverlay);
        activeOverlay = null;
        map.removeControl(ndviColorbar);
        map.removeControl(tempColorbar);
        map.removeControl(soilColorbar);
        map.removeControl(precipColorbar);
        map.removeControl(waterColorbar);
    }
    hideChartContainer();
    if (ndviChartDiv) {
        Plotly.purge(ndviChartDiv);
    }
});
// ========== Inputs y selector de variable ==========
// NDVI controls
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const generateGifButton = document.getElementById('generateNdviGifBBox');
// Temperatura ERA5 controls
const tempStartInput = document.getElementById('tempStartDate');
const tempEndInput = document.getElementById('tempEndDate');
const generateTempGifButton = document.getElementById('generateTempGifBBox');
// Humedad del suelo ERA5 controls
const soilStartInput = document.getElementById('soilStartDate');
const soilEndInput = document.getElementById('soilEndDate');
const generateSoilGifButton = document.getElementById('generateSoilGifBBox');
// Precipitación CHIRPS controls
const precipStartInput = document.getElementById('precipStartDate');
const precipEndInput = document.getElementById('precipEndDate');
const generatePrecipGifButton = document.getElementById('generatePrecipGifBBox');
// Agua (Sentinel-2) controls
const waterStartInput = document.getElementById('waterStartDate');
const waterEndInput = document.getElementById('waterEndDate');
const generateWaterGifButton = document.getElementById('generateWaterGifBBox');
// ========== Barras de colores ==========
// NDVI
const ndviColorbar = L.control({ position: 'topright' });
ndviColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'ndvi-colorbar');
    div.innerHTML = `
    <div class="ndvi-colorbar-scale"></div>
    <div class="ndvi-colorbar-labels">
      <span class="ndvi-max">0.5-0.8 Vegetación densa, salud vegetal alta.</span>
      <span class="ndvi-max">0.3-0.5 Vegetación moderada, agricultura.</span>
      <span class="ndvi-max">0.2-0.3 Vegetación escasa, pastos secos.</span>
      <span class="ndvi-mid">0.1-0.2 Poca vegetación, zonas áridas.</span>
      <span class="ndvi-min">0.0-0.1 Suelo desnudo, roca, nieve, agua.</span>
    </div>
  `;
    return div;
};
// Temperatura ERA5
const tempColorbar = L.control({ position: 'topright' });
tempColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'temp-colorbar');
    div.innerHTML = `
    <div class="temp-colorbar-scale"></div>
    <div class="temp-colorbar-labels">
      <span>≥ 35 °C</span>
      <span>30–35 °C</span>
      <span>25–30 °C</span>
      <span>20–25 °C</span>
      <span>15–20 °C</span>
      <span>10–15 °C</span>
      <span>5–10 °C</span>
      <span>0–5 °C</span>
    </div>
  `;
    return div;
};
// Humedad del suelo
const soilColorbar = L.control({ position: 'topright' });
soilColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'soil-colorbar');
    div.innerHTML = `
    <div class="soil-colorbar-scale"></div>
    <div class="soil-colorbar-labels">
      <span>≥ 60 %</span>
      <span>50–60 %</span>
      <span>40–50 %</span>
      <span>30–40 %</span>
      <span>20–30 %</span>
      <span>10–20 %</span>
      <span>0–10 %</span>
    </div>
  `;
    return div;
};
// Precipitación diaria CHIRPS
const precipColorbar = L.control({ position: 'topright' });
precipColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'precip-colorbar');
    div.innerHTML = `
    <div class="precip-colorbar-scale"></div>
    <div class="precip-colorbar-labels">
      <span>≥ 80 mm/día</span>
      <span>60–80 mm/día</span>
      <span>40–60 mm/día</span>
      <span>20–40 mm/día</span>
      <span>10–20 mm/día</span>
      <span>1–10 mm/día</span>
      <span>0–1 mm/día</span>
    </div>
  `;
    return div;
};
// Agua (NDWI Sentinel-2)
const waterColorbar = L.control({ position: 'topright' });
waterColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'precip-colorbar');
    div.innerHTML = `
    <div class="precip-colorbar-scale" style="background: linear-gradient(to top, #00000000 0%, #0000ff 100%);"></div>
    <div class="precip-colorbar-labels">
      <span>100 % agua</span>
      <span>50 % agua</span>
      <span>0 % agua</span>
    </div>
  `;
    return div;
};
// ========== Gráfica genérica ==========
function plotTimeseries(variable, dates, values) {
    if (!ndviChartDiv)
        return;
    if (!values || values.length === 0)
        return;
    showChartContainer();
    requestAnimationFrame(() => {
        const width = ndviChartDiv.clientWidth || 600;
        const height = ndviChartDiv.clientHeight || 280;
        let yTitle = '';
        let yRange = null;
        let lineColor = '';
        let hoverLabel = '';
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const span = dataMax - dataMin || 1;
        const padding = span * 0.1;
        if (variable === 'ndvi') {
            yTitle = 'NDVI promedio';
            yRange = [Math.max(0, dataMin - padding), Math.min(1, dataMax + padding)];
            lineColor = '#006837';
            hoverLabel = 'NDVI';
        }
        else if (variable === 'temp') {
            yTitle = 'Temperatura media 2m (°C)';
            yRange = [dataMin - padding, dataMax + padding];
            lineColor = '#ff4f00';
            hoverLabel = 'Temp';
        }
        else if (variable === 'soil') {
            yTitle = 'Humedad del suelo (%)';
            yRange = [0, 100];
            lineColor = '#2b6cb0';
            hoverLabel = 'Humedad';
        }
        else if (variable === 'precip') {
            yTitle = 'Precipitación diaria (mm/día)';
            yRange = [Math.max(0, dataMin - padding), dataMax + padding];
            lineColor = '#0044aa';
            hoverLabel = 'Pr';
        }
        else {
            yTitle = 'Hectáreas con agua en el bbox';
            yRange = [0, dataMax + padding];
            lineColor = '#0000ff';
            hoverLabel = 'ha agua';
        }
        const trace = {
            x: dates,
            y: values,
            type: 'scatter',
            mode: 'lines',
            line: {
                color: lineColor,
                width: 2
            },
            hovertemplate: `Fecha: %{x}<br>${hoverLabel}: %{y:.2f}<extra></extra>`
        };
        const layout = {
            margin: { l: 60, r: 20, t: 30, b: 50 },
            width,
            height,
            xaxis: {
                title: 'Fecha',
                type: 'date'
            },
            yaxis: {
                title: yTitle,
                range: yRange !== null && yRange !== void 0 ? yRange : undefined
            },
            showlegend: false
        };
        const config = {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines']
        };
        if (ndviChartDiv._fullLayout) {
            Plotly.react(ndviChartDiv, [trace], layout, config);
        }
        else {
            Plotly.newPlot(ndviChartDiv, [trace], layout, config);
        }
    });
}
// ========== Petición genérica GIF + serie ==========
async function requestGifAndSeries(variable, start, end, bbox) {
    const bboxJson = JSON.stringify(bbox);
    const gifEndpoint = variable === 'ndvi'
        ? '/api/ndvi-gif-bbox'
        : variable === 'temp'
            ? '/api/era5-temp-gif-bbox'
            : variable === 'soil'
                ? '/api/era5-soil-gif-bbox'
                : variable === 'precip'
                    ? '/api/imerg-precip-gif-bbox'
                    : '/api/water-gif-bbox';
    const tsEndpoint = variable === 'ndvi'
        ? '/api/ndvi-timeseries-bbox'
        : variable === 'temp'
            ? '/api/era5-temp-timeseries-bbox'
            : variable === 'soil'
                ? '/api/era5-soil-timeseries-bbox'
                : variable === 'precip'
                    ? '/api/imerg-precip-timeseries-bbox'
                    : '/api/water-timeseries-bbox';
    const gifUrlWithParams = `${gifEndpoint}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&bbox=${encodeURIComponent(bboxJson)}`;
    const tsUrlWithParams = `${tsEndpoint}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&bbox=${encodeURIComponent(bboxJson)}`;
    try {
        const [gifResp, tsResp] = await Promise.all([
            fetch(gifUrlWithParams),
            fetch(tsUrlWithParams)
        ]);
        const gifData = await gifResp.json();
        const tsData = await tsResp.json();
        if (!gifResp.ok) {
            alert(gifData.error || 'Error generando animación.');
            return;
        }
        if (!tsResp.ok) {
            console.warn('Error en serie temporal:', tsData.error || tsData);
        }
        const gifUrl = gifData.gifUrl;
        const bboxResp = gifData.bbox;
        const [minLon, minLat, maxLon, maxLat] = bboxResp;
        if (activeOverlay) {
            map.removeLayer(activeOverlay);
            activeOverlay = null;
        }
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        activeOverlay = L.imageOverlay(gifUrl, overlayBounds, {
            opacity: 0.8
        }).addTo(map);
        if (variable === 'ndvi') {
            ndviColorbar.addTo(map);
            map.removeControl(tempColorbar);
            map.removeControl(soilColorbar);
            map.removeControl(precipColorbar);
            map.removeControl(waterColorbar);
        }
        else if (variable === 'temp') {
            tempColorbar.addTo(map);
            map.removeControl(ndviColorbar);
            map.removeControl(soilColorbar);
            map.removeControl(precipColorbar);
            map.removeControl(waterColorbar);
        }
        else if (variable === 'soil') {
            soilColorbar.addTo(map);
            map.removeControl(ndviColorbar);
            map.removeControl(tempColorbar);
            map.removeControl(precipColorbar);
            map.removeControl(waterColorbar);
        }
        else if (variable === 'precip') {
            precipColorbar.addTo(map);
            map.removeControl(ndviColorbar);
            map.removeControl(tempColorbar);
            map.removeControl(soilColorbar);
            map.removeControl(waterColorbar);
        }
        else {
            waterColorbar.addTo(map);
            map.removeControl(ndviColorbar);
            map.removeControl(tempColorbar);
            map.removeControl(soilColorbar);
            map.removeControl(precipColorbar);
        }
        map.fitBounds(overlayBounds);
        if (tsResp.ok) {
            const dates = tsData.dates;
            const values = variable === 'ndvi'
                ? tsData.ndvi
                : variable === 'temp'
                    ? tsData.temp
                    : variable === 'soil'
                        ? tsData.soil_pct
                        : variable === 'precip'
                            ? tsData.precip_mm
                            : tsData.water_ha;
            plotTimeseries(variable, dates, values);
        }
        else {
            hideChartContainer();
            if (ndviChartDiv) {
                Plotly.purge(ndviChartDiv);
            }
        }
    }
    catch (err) {
        console.error(err);
        alert('Error de red al generar animación / serie temporal.');
    }
}
// ========== Listeners específicos ==========
// NDVI
if (startInput && endInput && generateGifButton) {
    generateGifButton.addEventListener('click', () => {
        const start = startInput.value;
        const end = endInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        if (!currentBbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        currentVariable = 'ndvi';
        requestGifAndSeries('ndvi', start, end, currentBbox);
    });
}
// Temperatura
if (tempStartInput && tempEndInput && generateTempGifButton) {
    generateTempGifButton.addEventListener('click', () => {
        const start = tempStartInput.value;
        const end = tempEndInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        if (!currentBbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        currentVariable = 'temp';
        requestGifAndSeries('temp', start, end, currentBbox);
    });
}
// Humedad del suelo
if (soilStartInput && soilEndInput && generateSoilGifButton) {
    generateSoilGifButton.addEventListener('click', () => {
        const start = soilStartInput.value;
        const end = soilEndInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        if (!currentBbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        currentVariable = 'soil';
        requestGifAndSeries('soil', start, end, currentBbox);
    });
}
// Precipitación
if (precipStartInput && precipEndInput && generatePrecipGifButton) {
    generatePrecipGifButton.addEventListener('click', () => {
        const start = precipStartInput.value;
        const end = precipEndInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        if (!currentBbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        currentVariable = 'precip';
        requestGifAndSeries('precip', start, end, currentBbox);
    });
}
// Agua
if (waterStartInput && waterEndInput && generateWaterGifButton) {
    generateWaterGifButton.addEventListener('click', () => {
        const start = waterStartInput.value;
        const end = waterEndInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        if (!currentBbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        currentVariable = 'water';
        requestGifAndSeries('water', start, end, currentBbox);
    });
}
// ========== Sidebar ==========
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
    };
    syncState();
    collapseButton.addEventListener('click', () => {
        body.classList.add('sidebar-collapsed');
        syncState();
    });
    restoreButton.addEventListener('click', () => {
        body.classList.remove('sidebar-collapsed');
        syncState();
    });
}
//# sourceMappingURL=main.js.map