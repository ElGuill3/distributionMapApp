/* eslint-disable @typescript-eslint/no-explicit-any */
declare const L: any;
declare const Plotly: any;

const DEFAULT_CENTER: [number, number] = [17.8409, -92.6189];
const DEFAULT_ZOOM = 8;
const MAX_SPAN_DEG = 8.0;

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

const osmBase = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
osmBase.addTo(map);

// Referencias gráfica NDVI
const ndviChartContainer = document.getElementById('ndvi-chart-container') as HTMLDivElement | null;
const ndviChartDiv = document.getElementById('ndvi-chart') as HTMLDivElement | null;

function showNdviChartContainer(): void {
  if (!ndviChartContainer) return;
  ndviChartContainer.classList.remove('hidden');
}

function hideNdviChartContainer(): void {
  if (!ndviChartContainer) return;
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

let currentBbox: [number, number, number, number] | null = null;

// overlay NDVI (GIF o PNG)
let ndviOverlay: any | null = null;

map.on(L.Draw.Event.CREATED, (e: any) => {
  const layer = e.layer;
  const bounds = layer.getBounds();
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  const widthDeg = Math.abs(northEast.lng - southWest.lng);
  const heightDeg = Math.abs(northEast.lat - southWest.lat);

  if (widthDeg > MAX_SPAN_DEG || heightDeg > MAX_SPAN_DEG) {
    alert(
      'El bounding box es demasiado grande (máx. ~8° por lado). Dibuja una región más pequeña.'
    );
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

  const squareBounds = L.latLngBounds(
    L.latLng(squareSouth, squareWest),
    L.latLng(squareNorth, squareEast)
  );

  if (layer.setBounds) {
    layer.setBounds(squareBounds);
  }

  drawnItems.clearLayers();
  drawnItems.addLayer(layer);

  currentBbox = [squareWest, squareSouth, squareEast, squareNorth];

  if (ndviOverlay) {
    map.removeLayer(ndviOverlay);
    ndviOverlay = null;
    map.removeControl(ndviColorbar);
  }

  hideNdviChartContainer();
  if (ndviChartDiv) {
    Plotly.purge(ndviChartDiv);
  }
});

// ========== Inputs y botones ==========
const startInput = document.getElementById('startDate') as HTMLInputElement | null;
const endInput = document.getElementById('endDate') as HTMLInputElement | null;
const generateGifButton = document.getElementById('generateNdviGifBBox') as HTMLButtonElement | null;

const singleDateInput = document.getElementById('singleDate') as HTMLInputElement | null;
const generatePngButton = document.getElementById('generateNdviPngBBox') as HTMLButtonElement | null;

// ========== Modal (no usado para NDVI, pero lo dejamos) ==========
const gifModal = document.getElementById('gifModal') as HTMLDivElement | null;
const gifImage = document.getElementById('gifImage') as HTMLImageElement | null;
const gifModalClose = document.getElementById('gifModalClose') as HTMLButtonElement | null;
const gifModalTitle = document.getElementById('gifModalTitle') as HTMLHeadingElement | null;

function openGifModal(url: string, title: string): void {
  if (!gifModal || !gifImage || !gifModalTitle) return;
  gifModalTitle.textContent = title;
  gifImage.src = url;
  gifModal.classList.add('active');
  gifModal.setAttribute('aria-hidden', 'false');
}

function closeGifModal(): void {
  if (!gifModal || !gifImage) return;
  gifModal.classList.remove('active');
  gifModal.setAttribute('aria-hidden', 'true');
  gifImage.src = '';
}

if (gifModalClose && gifModal) {
  gifModalClose.addEventListener('click', closeGifModal);
  gifModal.addEventListener('click', (e: MouseEvent) => {
    if (e.target === gifModal) {
      closeGifModal();
    }
  });
}

// ========== Barra de colores NDVI (solo se añade cuando hay GIF) ==========
const ndviColorbar = L.control({ position: 'topright' });

ndviColorbar.onAdd = function () {
  const div = L.DomUtil.create('div', 'ndvi-colorbar');

  div.innerHTML = `
    <div class="ndvi-colorbar-scale"></div>
    <div class="ndvi-colorbar-labels">
      <span class="ndvi-max">0.5-0.8 Suelo desnudo, roca, nieve, agua.</span>
      <span class="ndvi-max">0.3-0.5 Poca vegetación, zonas áridas.</span>
      <span class="ndvi-max">0.2-0.3 Vegetación escasa, pastos secos.</span>
      <span class="ndvi-mid">0.1-0.2 Vegetación moderada, agricultura.</span>
      <span class="ndvi-min">0.0-0.1 Vegetación densa, salud vegetal alta.</span>
    </div>
  `;
  return div;
};

const ndviMaxLabel = document.querySelector('.ndvi-colorbar-labels .ndvi-max') as HTMLSpanElement | null;
const ndviMidLabel = document.querySelector('.ndvi-colorbar-labels .ndvi-mid') as HTMLSpanElement | null;
const ndviMinLabel = document.querySelector('.ndvi-colorbar-labels .ndvi-min') as HTMLSpanElement | null;

function updateNdviColorbar(vmin: number, vmax: number): void {
  if (!ndviMaxLabel || !ndviMidLabel || !ndviMinLabel) return;
  ndviMaxLabel.textContent = `${vmax.toFixed(2)} máx NDVI`;
  ndviMinLabel.textContent = `${vmin.toFixed(2)} mín NDVI`;
  ndviMidLabel.textContent = `${((vmin + vmax) / 2).toFixed(2)} NDVI medio`;
}

function plotNdviTimeseries(dates: string[], ndvi: number[]): void {
  if (!ndviChartDiv) return;

  // Asegurar que el contenedor está visible antes de medir
  showNdviChartContainer();

  // Esperar al layout real del div
  requestAnimationFrame(() => {
    const width = ndviChartDiv.clientWidth || 600;
    const height = ndviChartDiv.clientHeight || 280;

    const trace = {
      x: dates,
      y: ndvi,
      type: 'scatter',
      mode: 'lines',
      line: {
        color: '#006837',
        width: 2
      },
      hovertemplate: 'Fecha: %{x}<br>NDVI: %{y:.3f}<extra></extra>'
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
        title: 'NDVI promedio',
        range: [0, 0.8]
      },
      showlegend: false
    };

    const config = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines']
    };

    // Si ya hay gráfica, actualizar; si no, crear
    if ((ndviChartDiv as any)._fullLayout) {
      Plotly.react(ndviChartDiv, [trace], layout, config);
    } else {
      Plotly.newPlot(ndviChartDiv, [trace], layout, config);
    }
  });
}

// ========== Petición de GIF NDVI como overlay ==========
if (startInput && endInput && generateGifButton) {
  generateGifButton.addEventListener('click', async () => {
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

    const bboxJson = JSON.stringify(currentBbox);

    try {
      const gifPromise = fetch(
        `/api/ndvi-gif-bbox?start=${encodeURIComponent(start)}&end=${encodeURIComponent(
          end
        )}&bbox=${encodeURIComponent(bboxJson)}`
      );

      const tsPromise = fetch(
        `/api/ndvi-timeseries-bbox?start=${encodeURIComponent(start)}&end=${encodeURIComponent(
          end
        )}&bbox=${encodeURIComponent(bboxJson)}`
      );

      const [gifResp, tsResp] = await Promise.all([gifPromise, tsPromise]);

      const gifData = await gifResp.json();
      const tsData = await tsResp.json();

      if (!gifResp.ok) {
        alert(gifData.error || 'Error generando GIF NDVI.');
        return;
      }

      if (!tsResp.ok) {
        // eslint-disable-next-line no-console
        console.warn('Error en serie temporal NDVI:', tsData.error || tsData);
      }

      const gifUrl: string = gifData.gifUrl;
      const bbox: [number, number, number, number] = gifData.bbox;
      const [minLon, minLat, maxLon, maxLat] = bbox;

      if (ndviOverlay) {
        map.removeLayer(ndviOverlay);
        ndviOverlay = null;
      }

      const overlayBounds = L.latLngBounds(
        L.latLng(minLat, minLon),
        L.latLng(maxLat, maxLon)
      );

      ndviOverlay = L.imageOverlay(gifUrl, overlayBounds, {
        opacity: 0.8
      }).addTo(map);

      ndviColorbar.addTo(map);
      map.fitBounds(overlayBounds);

      if (tsResp.ok && Array.isArray(tsData.dates) && Array.isArray(tsData.ndvi)) {
        plotNdviTimeseries(tsData.dates as string[], tsData.ndvi as number[]);
      } else {
        hideNdviChartContainer();
        if (ndviChartDiv) {
          Plotly.purge(ndviChartDiv);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert('Error de red al generar GIF/serie NDVI.');
    }
  });
}

// ========== Petición de PNG NDVI (1 fecha) como overlay ==========
if (singleDateInput && generatePngButton) {
  generatePngButton.addEventListener('click', async () => {
    const date = singleDateInput.value;

    if (!date) {
      alert('Selecciona una fecha.');
      return;
    }
    if (!currentBbox) {
      alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
      return;
    }

    hideNdviChartContainer();
    if (ndviChartDiv) {
      Plotly.purge(ndviChartDiv);
    }

    const bboxJson = JSON.stringify(currentBbox);

    const resp = await fetch(
      `/api/ndvi-png-bbox?date=${encodeURIComponent(date)}&bbox=${encodeURIComponent(
        bboxJson
      )}`
    );
    const data = await resp.json();

    if (!resp.ok) {
      alert(data.error || 'Error generando PNG NDVI.');
      return;
    }

    const pngUrl: string = data.pngUrl;
    const bbox: [number, number, number, number] = data.bbox;
    const [minLon, minLat, maxLon, maxLat] = bbox;

    const ndviMin: number = data.ndviMin;
    const ndviMax: number = data.ndviMax;
    updateNdviColorbar(ndviMin, ndviMax);

    if (ndviOverlay) {
      map.removeLayer(ndviOverlay);
      ndviOverlay = null;
      map.removeControl(ndviColorbar);
    }

    const overlayBounds = L.latLngBounds(
      L.latLng(minLat, minLon),
      L.latLng(maxLat, maxLon)
    );

    ndviOverlay = L.imageOverlay(pngUrl, overlayBounds, {
      opacity: 0.8
    }).addTo(map);

    map.fitBounds(overlayBounds);
  });
}

// ========== Sidebar ==========
const collapseButton = document.getElementById('sidebarToggle') as HTMLButtonElement | null;
const restoreButton = document.getElementById('sidebarRestore') as HTMLButtonElement | null;
const body = document.body;

if (collapseButton && restoreButton) {
  const collapseSr = collapseButton.querySelector('.sr-only') as HTMLElement | null;
  const restoreSr = restoreButton.querySelector('.sr-only') as HTMLElement | null;

  const syncState = (): void => {
    const isHidden = body.classList.contains('sidebar-collapsed');
    collapseButton.setAttribute('aria-expanded', String(!isHidden));
    restoreButton.setAttribute('aria-expanded', String(isHidden));

    const label = isHidden ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
    if (collapseSr) collapseSr.textContent = label;
    if (restoreSr) restoreSr.textContent = label;
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
