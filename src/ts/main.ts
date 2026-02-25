/**
 * Punto de entrada del frontend — distributionMapApp.
 *
 * Conecta todos los módulos: mapa, API, UI y listeners.
 */

import type {
  BBox,
  VariableKey,
  GifResponse,
  TimeseriesResponse,
  StationResponse,
  FloodRiskResponse,
  SeriesData,
} from './types.js';
import { VARIABLE_DATA_KEY } from './types.js';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_SPAN_DEG, GIF_ENDPOINT, TS_ENDPOINT } from './config.js';
import {
  buildColorbars,
  switchColorbar,
  removeActiveOverlay,
  setActiveOverlay,
  municipalFloodOverlays,
} from './map/overlays.js';
import {
  createProgressIndicator,
  updateProgressIndicator,
  removeProgressIndicator,
} from './ui/progress.js';
import { plotAllSelectedSeries } from './ui/chart.js';
import { registerVariableListener } from './listeners/variableListeners.js';

// ---------------------------------------------------------------------------
// Mapa Leaflet
// ---------------------------------------------------------------------------

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:     19,
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
    marker:       false,
    circle:       false,
    polyline:     false,
    polygon:      false,
    circlemarker: false,
    rectangle:    { shapeOptions: { color: '#ff7800', weight: 2 } },
  },
  edit: {
    featureGroup: drawnItems as L.FeatureGroup,
    edit:         true,
    remove:       true,
  },
});
map.addControl(drawControl);

let currentBbox: BBox | null = null;

map.on(L.Draw.Event.CREATED, (e) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = ((e as unknown) as { layer: L.Rectangle }).layer;
  const bounds = layer.getBounds();
  const sw     = bounds.getSouthWest();
  const ne     = bounds.getNorthEast();

  const widthDeg  = Math.abs(ne.lng - sw.lng);
  const heightDeg = Math.abs(ne.lat - sw.lat);

  if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
    alert('El bounding box es demasiado grande (máx. ~8° por lado). Dibuja una región más pequeña.');
    return;
  }

  const centerLat = (sw.lat + ne.lat) / 2;
  const centerLng = (sw.lng + ne.lng) / 2;
  const halfSide  = Math.min(widthDeg, heightDeg) / 2;

  const squareSouth = centerLat - halfSide;
  const squareNorth = centerLat + halfSide;
  const squareWest  = centerLng - halfSide;
  const squareEast  = centerLng + halfSide;

  const squareBounds = L.latLngBounds(
    L.latLng(squareSouth, squareWest),
    L.latLng(squareNorth, squareEast),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((layer as any).setBounds) (layer as any).setBounds(squareBounds);

  drawnItems.clearLayers();
  drawnItems.addLayer(layer);

  currentBbox = [squareWest, squareSouth, squareEast, squareNorth];

  removeActiveOverlay(map);
  switchColorbar(map, null);
  hideChartContainer();
  if (ndviChartDiv) Plotly.purge(ndviChartDiv);

  // Limpiar series almacenadas
  (Object.keys(allSeriesData) as VariableKey[]).forEach(k => delete allSeriesData[k]);
});

// ---------------------------------------------------------------------------
// Gráfica Plotly
// ---------------------------------------------------------------------------

const ndviChartContainer = document.getElementById('ndvi-chart-container') as HTMLDivElement | null;
const ndviChartDiv       = document.getElementById('ndvi-chart')           as HTMLDivElement | null;

const allSeriesData: Partial<Record<VariableKey, SeriesData | undefined>> = {};

function showChartContainer(): void {
  ndviChartContainer?.classList.remove('hidden');
}
function hideChartContainer(): void {
  ndviChartContainer?.classList.add('hidden');
}

function renderChart(): void {
  if (!ndviChartDiv) return;
  plotAllSelectedSeries(ndviChartDiv, allSeriesData, showChartContainer, hideChartContainer);
}

// ---------------------------------------------------------------------------
// Estado de variable activa
// ---------------------------------------------------------------------------

let currentVariable: VariableKey = 'ndvi';

// ---------------------------------------------------------------------------
// SSE + petición GIF + serie temporal
// ---------------------------------------------------------------------------

async function requestGifAndSeries(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox,
): Promise<void> {
  currentVariable = variable;

  const bboxJson  = JSON.stringify(bbox);
  const taskId    = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`
    + `&task_id=${encodeURIComponent(taskId)}`;

  const tsUrl  = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`;

  createProgressIndicator();

  const eventSource = new EventSource(`/api/gif-progress/${taskId}`);
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as { progress: number; message: string };
      updateProgressIndicator(data.progress, data.message);
      if (data.progress === 100 || data.progress === -1) {
        eventSource.close();
        if (data.progress === 100) removeProgressIndicator(1000);
      }
    } catch {
      // silently ignore malformed SSE messages
    }
  };
  eventSource.onerror = () => eventSource.close();

  try {
    const [gifResp, tsResp] = await Promise.all([fetch(gifUrl), fetch(tsUrl)]);
    const gifData = await gifResp.json() as GifResponse & { error?: string };
    const tsData  = await tsResp.json()  as TimeseriesResponse & { error?: string };

    if (!gifResp.ok) {
      alert(gifData.error ?? 'Error generando animación.');
      return;
    }

    // Mostrar overlay del GIF
    removeActiveOverlay(map);
    const [minLon, minLat, maxLon, maxLat] = gifData.bbox;
    const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
    const overlay       = L.imageOverlay(gifData.gifUrl, overlayBounds, { opacity: 0.8 }).addTo(map);
    setActiveOverlay(overlay);
    switchColorbar(map, variable);
    map.fitBounds(overlayBounds);

    // Serie temporal
    if (tsResp.ok) {
      const dataKey = VARIABLE_DATA_KEY[variable] as keyof TimeseriesResponse;
      const values  = tsData[dataKey] as number[] | undefined;
      if (tsData.dates && values) {
        allSeriesData[variable] = { dates: tsData.dates, values };
        renderChart();
      }
    } else {
      console.warn('Error en serie temporal:', tsData.error);
    }

  } catch (err) {
    console.error(err);
    alert('Error de red al generar animación / serie temporal.');
    updateProgressIndicator(-1, 'Error de red');
    removeProgressIndicator(3000);
  } finally {
    eventSource.close();
  }
}

// ---------------------------------------------------------------------------
// Riesgo de inundación por municipio
// ---------------------------------------------------------------------------

async function toggleMunicipalFloodRisk(muni: string, checked: boolean): Promise<void> {
  if (!checked) {
    const existing = municipalFloodOverlays[muni];
    if (existing) {
      map.removeLayer(existing);
      delete municipalFloodOverlays[muni];
    }
    return;
  }

  if (municipalFloodOverlays[muni]) {
    municipalFloodOverlays[muni]?.addTo(map);
    return;
  }

  try {
    const resp = await fetch(`/api/flood-risk-municipio?muni=${encodeURIComponent(muni)}`);
    const data = await resp.json() as FloodRiskResponse & { error?: string };

    if (!resp.ok) {
      alert(data.error ?? 'Error generando mapa de riesgo por municipio.');
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = data.bbox;
    const bounds  = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
    const overlay = L.imageOverlay(data.mapUrl, bounds, { opacity: 0.8 }).addTo(map);
    municipalFloodOverlays[muni] = overlay;
    switchColorbar(map, 'flood');
  } catch (err) {
    console.error(err);
    alert('Error de red al generar mapa de riesgo por municipio.');
  }
}

// ---------------------------------------------------------------------------
// Estaciones locales
// ---------------------------------------------------------------------------

async function requestLocalStationLevel(
  stationId: 'SPTTB' | 'BDCTB',
  start: string,
  end: string,
): Promise<void> {
  const url = `/api/local-station-level-range?station=${encodeURIComponent(stationId)}`
    + `&start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json() as StationResponse & { error?: string };

    if (!resp.ok) {
      alert(data.error ?? 'Error cargando serie de nivel de estación local.');
      return;
    }

    const key: VariableKey = stationId === 'SPTTB' ? 'local_sp' : 'local_bd';
    allSeriesData[key] = { dates: data.dates, values: data.level_m };
    renderChart();
  } catch (err) {
    console.error(err);
    alert('Error de red al cargar serie de estación local.');
  }
}

// ---------------------------------------------------------------------------
// Inputs del DOM
// ---------------------------------------------------------------------------

const startInput           = document.getElementById('startDate')          as HTMLInputElement | null;
const endInput             = document.getElementById('endDate')            as HTMLInputElement | null;
const generateGifButton    = document.getElementById('generateNdviGifBBox') as HTMLButtonElement | null;

const tempStartInput       = document.getElementById('tempStartDate')      as HTMLInputElement | null;
const tempEndInput         = document.getElementById('tempEndDate')        as HTMLInputElement | null;
const generateTempGifButton = document.getElementById('generateTempGifBBox') as HTMLButtonElement | null;

const soilStartInput       = document.getElementById('soilStartDate')      as HTMLInputElement | null;
const soilEndInput         = document.getElementById('soilEndDate')        as HTMLInputElement | null;
const generateSoilGifButton = document.getElementById('generateSoilGifBBox') as HTMLButtonElement | null;

const precipStartInput     = document.getElementById('precipStartDate')    as HTMLInputElement | null;
const precipEndInput       = document.getElementById('precipEndDate')      as HTMLInputElement | null;
const generatePrecipGifButton = document.getElementById('generatePrecipGifBBox') as HTMLButtonElement | null;

const waterStartInput      = document.getElementById('waterStartDate')     as HTMLInputElement | null;
const waterEndInput        = document.getElementById('waterEndDate')       as HTMLInputElement | null;
const generateWaterGifButton = document.getElementById('generateWaterGifBBox') as HTMLButtonElement | null;

const spStartInput  = document.getElementById('spStartDate') as HTMLInputElement | null;
const spEndInput    = document.getElementById('spEndDate')   as HTMLInputElement | null;
const bdStartInput  = document.getElementById('bdStartDate') as HTMLInputElement | null;
const bdEndInput    = document.getElementById('bdEndDate')   as HTMLInputElement | null;
const btnLocalSpLevel = document.getElementById('btnLocalSpLevel') as HTMLButtonElement | null;
const btnLocalBdLevel = document.getElementById('btnLocalBdLevel') as HTMLButtonElement | null;

// ---------------------------------------------------------------------------
// R8: Registro de listeners usando la factory
// ---------------------------------------------------------------------------

const getBbox = () => currentBbox;

const variableConfigs: Parameters<typeof registerVariableListener>[0][] = [
  { variable: 'ndvi',   startInput,       endInput,       button: generateGifButton,        getBbox, onRequest: requestGifAndSeries },
  { variable: 'temp',   startInput: tempStartInput,   endInput: tempEndInput,   button: generateTempGifButton,   getBbox, onRequest: requestGifAndSeries },
  { variable: 'soil',   startInput: soilStartInput,   endInput: soilEndInput,   button: generateSoilGifButton,   getBbox, onRequest: requestGifAndSeries },
  { variable: 'precip', startInput: precipStartInput, endInput: precipEndInput, button: generatePrecipGifButton, getBbox, onRequest: requestGifAndSeries },
  { variable: 'water',  startInput: waterStartInput,  endInput: waterEndInput,  button: generateWaterGifButton,  getBbox, onRequest: requestGifAndSeries },
];

variableConfigs.forEach(cfg => registerVariableListener(cfg));

// ---------------------------------------------------------------------------
// Listeners de municipios (riesgo de inundación)
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLInputElement>('input.chk-flood-muni').forEach(chk => {
  chk.addEventListener('change', () => {
    const muni = chk.dataset['muni'];
    if (!muni) return;
    void toggleMunicipalFloodRisk(muni, chk.checked);
  });
});

// ---------------------------------------------------------------------------
// Listeners de estaciones locales
// ---------------------------------------------------------------------------

btnLocalSpLevel?.addEventListener('click', () => {
  const start = spStartInput?.value;
  const end   = spEndInput?.value;
  if (!start || !end) { alert('Selecciona fecha inicio y fecha fin para San Pedro.'); return; }
  void requestLocalStationLevel('SPTTB', start, end);
});

btnLocalBdLevel?.addEventListener('click', () => {
  const start = bdStartInput?.value;
  const end   = bdEndInput?.value;
  if (!start || !end) { alert('Selecciona fecha inicio y fecha fin para Boca del Cerro.'); return; }
  void requestLocalStationLevel('BDCTB', start, end);
});

// ---------------------------------------------------------------------------
// Sidebar colapsar/restaurar
// ---------------------------------------------------------------------------

const collapseButton = document.getElementById('sidebarToggle')  as HTMLButtonElement | null;
const restoreButton  = document.getElementById('sidebarRestore') as HTMLButtonElement | null;
const body           = document.body;

if (collapseButton && restoreButton) {
  const collapseSr = collapseButton.querySelector('.sr-only') as HTMLElement | null;
  const restoreSr  = restoreButton.querySelector('.sr-only')  as HTMLElement | null;

  const syncState = () => {
    const isHidden = body.classList.contains('sidebar-collapsed');
    collapseButton.setAttribute('aria-expanded', String(!isHidden));
    restoreButton.setAttribute('aria-expanded',  String(isHidden));
    const label = isHidden ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
    if (collapseSr) collapseSr.textContent = label;
    if (restoreSr)  restoreSr.textContent  = label;
  };

  syncState();
  collapseButton.addEventListener('click', () => { body.classList.add('sidebar-collapsed');    syncState(); });
  restoreButton.addEventListener('click',  () => { body.classList.remove('sidebar-collapsed'); syncState(); });
}
