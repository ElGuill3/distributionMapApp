"use strict";
const DEFAULT_CENTER = [17.8409, -92.6189];
const DEFAULT_ZOOM = 8;
const MAX_SPAN_DEG = 8.0;
const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);
const osmBase = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
osmBase.addTo(map);
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
// overlay NDVI (GIF o PNG)
let ndviOverlay = null;
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
    // Forzar 1:1 en grados manteniendo el centro
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
    // si ya hay overlay NDVI, lo quitamos para no dejarlo desalineado
    if (ndviOverlay) {
        map.removeLayer(ndviOverlay);
        ndviOverlay = null;
    }
});
// ========== Inputs y botones ==========
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const generateGifButton = document.getElementById('generateNdviGifBBox');
const singleDateInput = document.getElementById('singleDate');
const generatePngButton = document.getElementById('generateNdviPngBBox');
// ========== Modal (lo dejamos por si quieres reutilizarlo, pero ya no lo usamos para NDVI) ==========
const gifModal = document.getElementById('gifModal');
const gifImage = document.getElementById('gifImage');
const gifModalClose = document.getElementById('gifModalClose');
const gifModalTitle = document.getElementById('gifModalTitle');
function openGifModal(url, title) {
    if (!gifModal || !gifImage || !gifModalTitle)
        return;
    gifModalTitle.textContent = title;
    gifImage.src = url;
    gifModal.classList.add('active');
    gifModal.setAttribute('aria-hidden', 'false');
}
function closeGifModal() {
    if (!gifModal || !gifImage)
        return;
    gifModal.classList.remove('active');
    gifModal.setAttribute('aria-hidden', 'true');
    gifImage.src = '';
}
if (gifModalClose && gifModal) {
    gifModalClose.addEventListener('click', closeGifModal);
    gifModal.addEventListener('click', (e) => {
        if (e.target === gifModal) {
            closeGifModal();
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
        const resp = await fetch(`/api/ndvi-gif-bbox?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&bbox=${encodeURIComponent(bboxJson)}`);
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || 'Error generando GIF NDVI.');
            return;
        }
        const gifUrl = data.gifUrl;
        const bbox = data.bbox;
        const [minLon, minLat, maxLon, maxLat] = bbox;
        // remover overlay anterior si existe
        if (ndviOverlay) {
            map.removeLayer(ndviOverlay);
            ndviOverlay = null;
        }
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        ndviOverlay = L.imageOverlay(gifUrl, overlayBounds, {
            opacity: 0.8
        }).addTo(map);
        map.fitBounds(overlayBounds);
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
        const bboxJson = JSON.stringify(currentBbox);
        const resp = await fetch(`/api/ndvi-png-bbox?date=${encodeURIComponent(date)}&bbox=${encodeURIComponent(bboxJson)}`);
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || 'Error generando PNG NDVI.');
            return;
        }
        const pngUrl = data.pngUrl;
        const bbox = data.bbox;
        const [minLon, minLat, maxLon, maxLat] = bbox;
        // remover overlay anterior si existe
        if (ndviOverlay) {
            map.removeLayer(ndviOverlay);
            ndviOverlay = null;
        }
        const overlayBounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon));
        ndviOverlay = L.imageOverlay(pngUrl, overlayBounds, {
            opacity: 0.8
        }).addTo(map);
        map.fitBounds(overlayBounds);
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
// ========== Barra de colores NDVI ==========
const ndviColorbar = L.control({ position: 'topright' });
ndviColorbar.onAdd = function () {
    const div = L.DomUtil.create('div', 'ndvi-colorbar');
    // Ajusta los valores si cambias min/max en GEE
    div.innerHTML = `
    <div class="ndvi-colorbar-scale"></div>
    <div class="ndvi-colorbar-labels">
      <span>0.8</span>
      <span>0.4</span>
      <span>0.0</span>
    </div>
  `;
    return div;
};
ndviColorbar.addTo(map);
//# sourceMappingURL=main.js.map