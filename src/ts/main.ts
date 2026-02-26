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
import { GifPlayer, SyncPlayer } from './ui/gifPlayer.js';

// ---------------------------------------------------------------------------
// Mapa principal (A)
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

  // Limpiar series y estado de comparativa al dibujar un bbox nuevo
  (Object.keys(allSeriesData)  as VariableKey[]).forEach(k => delete allSeriesData[k]);
  (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
  destroySyncPlayer();
  hidePlayerControls();
  hideChartBContainer();
  if (chartBDiv) Plotly.purge(chartBDiv);
  clearMapBOverlay();
});

// ---------------------------------------------------------------------------
// Gráfica Plotly — Panel A
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
// Gráfica Plotly — Panel B
// ---------------------------------------------------------------------------

const chartBContainer = document.getElementById('chart-b-container') as HTMLDivElement | null;
const chartBDiv       = document.getElementById('chart-b')           as HTMLDivElement | null;

const allSeriesDataB: Partial<Record<VariableKey, SeriesData | undefined>> = {};

function showChartBContainer(): void {
  chartBContainer?.classList.remove('hidden');
}
function hideChartBContainer(): void {
  chartBContainer?.classList.add('hidden');
}

function renderChartB(): void {
  if (!chartBDiv) return;
  plotAllSelectedSeries(chartBDiv, allSeriesDataB, showChartBContainer, hideChartBContainer);
}

// ---------------------------------------------------------------------------
// Estado de variable activa
// ---------------------------------------------------------------------------

let currentVariable: VariableKey = 'ndvi';

// ---------------------------------------------------------------------------
// Modo comparativa
// ---------------------------------------------------------------------------

let compareModeActive = false;
let mapB: L.Map | null = null;
let mapBSyncLock = false; // Evita bucle infinito al sincronizar vistas

/** Mapa de overlay activo en panel B. */
let activeBOverlay: L.ImageOverlay | null = null;

/** Instancia del SyncPlayer activo (puede ser null si no hay GIFs cargados). */
let syncPlayer: SyncPlayer | null = null;

// DOM: controles del modo comparativa
const toggleCompareModeButton = document.getElementById('toggleCompareMode') as HTMLButtonElement | null;
const compareYearBWrapper     = document.getElementById('compareYearBWrapper') as HTMLDivElement | null;
const compareYearBInput       = document.getElementById('compareYearB')        as HTMLInputElement | null;

// DOM: player controls
const playerControlsDiv  = document.getElementById('player-controls')  as HTMLDivElement | null;
const playerPlayPauseBtn = document.getElementById('playerPlayPause')   as HTMLButtonElement | null;
const playerSlider       = document.getElementById('playerSlider')      as HTMLInputElement | null;
const playerFrameLabel   = document.getElementById('playerFrameLabel')  as HTMLSpanElement | null;
const playerPlayIcon     = document.getElementById('playerPlayIcon')    as HTMLSpanElement | null;

/** Inicializa mapB la primera vez que se activa el modo comparativa. */
function initMapB(): void {
  if (mapB) return;

  mapB = L.map('map-b', { zoomControl: false }).setView(map.getCenter(), map.getZoom());

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:     19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapB);

  // Sincronizar pan/zoom A → B
  map.on('moveend', () => {
    if (mapBSyncLock || !mapB) return;
    mapBSyncLock = true;
    mapB.setView(map.getCenter(), map.getZoom(), { animate: false });
    mapBSyncLock = false;
  });

  // Sincronizar pan/zoom B → A
  mapB.on('moveend', () => {
    if (mapBSyncLock) return;
    mapBSyncLock = true;
    map.setView(mapB!.getCenter(), mapB!.getZoom(), { animate: false });
    mapBSyncLock = false;
  });
}

function clearMapBOverlay(): void {
  if (activeBOverlay && mapB) {
    mapB.removeLayer(activeBOverlay);
    activeBOverlay = null;
  }
}

function destroySyncPlayer(): void {
  if (syncPlayer) {
    syncPlayer.destroy();
    syncPlayer = null;
  }
}

function showPlayerControls(): void {
  playerControlsDiv?.classList.remove('hidden');
}
function hidePlayerControls(): void {
  playerControlsDiv?.classList.add('hidden');
}

/** Actualiza el slider y el label de frame. */
function onPlayerFrameChange(current: number, total: number): void {
  if (playerSlider) {
    playerSlider.max   = String(total - 1);
    playerSlider.value = String(current);
  }
  if (playerFrameLabel) {
    playerFrameLabel.textContent = `${current + 1} / ${total}`;
  }
}

/** Sincroniza el ícono play/pause con el estado actual. */
function syncPlayPauseIcon(): void {
  if (!playerPlayIcon) return;
  playerPlayIcon.textContent = syncPlayer?.isPlaying ? '⏸' : '▶';
}

// Listener: toggle modo comparativa
toggleCompareModeButton?.addEventListener('click', () => {
  compareModeActive = !compareModeActive;
  document.body.classList.toggle('compare-mode-active', compareModeActive);
  toggleCompareModeButton.setAttribute('aria-pressed', String(compareModeActive));

  if (compareModeActive) {
    compareYearBWrapper?.classList.remove('hidden');
    initMapB();
    // Forzar invalidateSize en el mapa A (ahora ocupa la mitad del ancho)
    setTimeout(() => {
      map.invalidateSize();
      mapB?.invalidateSize();
    }, 350); // Espera la transición CSS
  } else {
    compareYearBWrapper?.classList.add('hidden');
    // Limpiar estado al desactivar
    (Object.keys(allSeriesDataB) as VariableKey[]).forEach(k => delete allSeriesDataB[k]);
    destroySyncPlayer();
    hidePlayerControls();
    hideChartBContainer();
    clearMapBOverlay();
    if (chartBDiv) Plotly.purge(chartBDiv);
    // Restaurar tamaño del mapa A
    setTimeout(() => map.invalidateSize(), 350);
  }
});

// Listener: play/pause
playerPlayPauseBtn?.addEventListener('click', () => {
  if (!syncPlayer) return;
  if (syncPlayer.isPlaying) {
    syncPlayer.pause();
  } else {
    syncPlayer.play();
  }
  syncPlayPauseIcon();
});

// Listener: slider de frames — goToFrame dispara onFrameChange internamente
playerSlider?.addEventListener('input', () => {
  if (!syncPlayer || !playerSlider) return;
  syncPlayer.goToFrame(Number(playerSlider.value));
});

// ---------------------------------------------------------------------------
// Helper: calcular fechas del período B
// ---------------------------------------------------------------------------

/**
 * Sustituye el año en una fecha ISO (YYYY-MM-DD) por yearB.
 * Maneja el 29 de febrero: si el año destino no es bisiesto, devuelve el 28.
 */
function replaceDateYear(dateStr: string, yearB: number): string {
  const [, month, day] = dateStr.split('-');
  // Validar 29-feb en año no bisiesto
  if (month === '02' && day === '29' && !isLeapYear(yearB)) {
    return `${yearB}-02-28`;
  }
  return `${yearB}-${month}-${day}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

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

  const bboxJson = JSON.stringify(bbox);
  const taskId   = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const gifUrl = `${GIF_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`
    + `&task_id=${encodeURIComponent(taskId)}`;

  const tsUrl = `${TS_ENDPOINT[variable]}?start=${encodeURIComponent(start)}`
    + `&end=${encodeURIComponent(end)}`
    + `&bbox=${encodeURIComponent(bboxJson)}`;

  // ---- Validar año B si está en modo comparativa ----
  let startB = '';
  let endB   = '';
  let gifUrlB = '';
  let tsUrlB  = '';

  if (compareModeActive) {
    const yearBRaw = compareYearBInput?.value.trim();
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
    endB   = replaceDateYear(end,   yearB);

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
    // Lanzar todas las peticiones en paralelo
    const fetches: Promise<Response>[] = [fetch(gifUrl), fetch(tsUrl)];
    if (compareModeActive) {
      fetches.push(fetch(gifUrlB), fetch(tsUrlB));
    }

    const responses = await Promise.all(fetches);
    const [gifResp, tsResp, gifRespB, tsRespB] = responses as [Response, Response, Response | undefined, Response | undefined];

    const gifData = await gifResp.json() as GifResponse & { error?: string };
    const tsData  = await tsResp.json()  as TimeseriesResponse & { error?: string };

    if (!gifResp.ok) {
      alert(gifData.error ?? 'Error generando animación.');
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
    } else {
      if (!gifRespB || !tsRespB) return;

      const gifDataB = await gifRespB.json() as GifResponse & { error?: string };

      if (!gifRespB.ok) {
        alert(gifDataB.error ?? 'Error generando animación del período B.');
        return;
      }

      // Destruir reproducción anterior si existía
      destroySyncPlayer();
      clearMapBOverlay();
      removeActiveOverlay(map);

      // Pre-renderizar ambos GIFs (puede tardar unos segundos)
      const [pA, pB] = await Promise.all([
        (async () => { const p = new GifPlayer(); await p.load(gifData.gifUrl);  return p; })(),
        (async () => { const p = new GifPlayer(); await p.load(gifDataB.gifUrl); return p; })(),
      ]);

      // Crear overlays con el primer frame
      const overlayA = L.imageOverlay(pA.getFrameUrl(0), overlayBounds, { opacity: 0.8 }).addTo(map);
      setActiveOverlay(overlayA);
      switchColorbar(map, variable);
      map.fitBounds(overlayBounds);

      const [minLonB, minLatB, maxLonB, maxLatB] = gifDataB.bbox;
      const overlayBoundsB = L.latLngBounds(L.latLng(minLatB, minLonB), L.latLng(maxLatB, maxLonB));
      const overlayB = L.imageOverlay(pB.getFrameUrl(0), overlayBoundsB, { opacity: 0.8 }).addTo(mapB!);
      activeBOverlay = overlayB;
      mapB?.fitBounds(overlayBoundsB);

      // Sincronizar zoom/posición de mapB con mapA tras fitBounds
      setTimeout(() => mapB?.setView(map.getCenter(), map.getZoom(), { animate: false }), 100);

      // Iniciar SyncPlayer
      syncPlayer = new SyncPlayer();
      syncPlayer.onFrameChange = (current, total) => {
        onPlayerFrameChange(current, total);
        syncPlayPauseIcon();
      };
      syncPlayer.start(pA, overlayA, pB, overlayB);

      // Configurar slider
      if (playerSlider) {
        playerSlider.max   = String(Math.max(pA.frameCount, pB.frameCount) - 1);
        playerSlider.value = '0';
      }
      showPlayerControls();
      syncPlayPauseIcon();

      // Serie temporal B
      const tsDataB = await tsRespB.json() as TimeseriesResponse & { error?: string };
      if (tsRespB.ok) {
        const dataKeyB = VARIABLE_DATA_KEY[variable] as keyof TimeseriesResponse;
        const valuesB  = tsDataB[dataKeyB] as number[] | undefined;
        if (tsDataB.dates && valuesB) {
          allSeriesDataB[variable] = { dates: tsDataB.dates, values: valuesB };
          renderChartB();
        }
      } else {
        console.warn('Error en serie temporal período B:', tsDataB.error);
      }
    }

    // ---- Serie temporal A (común a ambos modos) ----
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
    // Invalidar tamaño de mapas tras la transición del sidebar
    setTimeout(() => {
      map.invalidateSize();
      mapB?.invalidateSize();
    }, 350);
  };

  syncState();
  collapseButton.addEventListener('click', () => { body.classList.add('sidebar-collapsed');    syncState(); });
  restoreButton.addEventListener('click',  () => { body.classList.remove('sidebar-collapsed'); syncState(); });
}
