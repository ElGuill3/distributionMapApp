from flask import Flask, request, jsonify, render_template, send_from_directory
import ee
import os
import json
from typing import Optional
import math

ee.Initialize(project='inundaciones-proyecto')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_FOLDER = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, static_folder=STATIC_FOLDER, template_folder='templates')


# =========================
# NDVI (MODIS) - GIF + Serie
# =========================

def build_ndvi_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    """
    Genera un GIF NDVI (MODIS 061) recortado al bbox.
    Ajusta automáticamente las dimensiones para respetar
    el límite de píxeles totales de Earth Engine.
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection('MODIS/061/MOD13Q1')
           .select(['NDVI'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    def scale_and_mask(img):
        ndvi = img.multiply(0.0001)
        mask = ndvi.gte(-0.1).And(ndvi.lte(1.0))
        return ndvi.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_scaled = col.map(scale_and_mask)

    vis_params = {
        'min': 0.0,
        'max': 0.8,
        'palette': ['A50026', 'D73027', 'FFFFBF', 'A6D96A', '006837']
    }

    # Control de píxeles totales
    max_total_pixels = 26_000_000
    base_max_pixels_per_frame = 768 * 768

    pixels_per_frame = min(
        base_max_pixels_per_frame,
        max_total_pixels // max(n_frames, 1)
    )

    if ratio is not None and ratio > 0:
        safe_ratio = max(ratio, 1e-6)
        width_px = int(math.sqrt(pixels_per_frame * safe_ratio))
        height_px = int(width_px / safe_ratio)
    else:
        width_px = int(math.sqrt(pixels_per_frame))
        height_px = width_px

    width_px = max(256, width_px)
    height_px = max(256, height_px)

    dims = f'{width_px}x{height_px}'

    gif_url = col_scaled.getVideoThumbURL({
        'region': region,
        'dimensions': dims,
        'framesPerSecond': 2,
        'format': 'gif',
        'bands': ['NDVI'],
        'crs': 'EPSG:3857',
        **vis_params
    })

    return gif_url


def build_ndvi_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float]
):
    """
    Devuelve serie temporal NDVI promedio MODIS 061 en bbox.
    Salida: (dates, ndvi) donde dates = [YYYY-MM-DD], ndvi = [float].
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)

    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection('MODIS/061/MOD13Q1')
           .select(['NDVI'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def scale_and_mean(img):
        ndvi = img.multiply(0.0001)
        mask = ndvi.gte(-0.1).And(ndvi.lte(1.0))
        ndvi = ndvi.updateMask(mask)

        mean_dict = ndvi.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=250,
            maxPixels=1e7
        )

        mean_val = ee.Number(mean_dict.get('NDVI'))
        mean_val = mean_val.max(0.0).min(0.8)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')

        return ee.Feature(None, {
            'date': date_str,
            'ndvi': mean_val
        })

    fc = col.map(scale_and_mean)

    dates = fc.aggregate_array('date').getInfo()
    ndvi_vals = fc.aggregate_array('ndvi').getInfo()

    out_dates: list[str] = []
    out_ndvi: list[float] = []
    for d, v in zip(dates, ndvi_vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_ndvi.append(float(v))

    return out_dates, out_ndvi


# ===============================
# ERA5 Temperatura - GIF + Serie
# ===============================

def build_era5_temp_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    """
    Genera un GIF de temperatura media 2m ERA5 DAILY recortado al bbox.
    Temperatura en °C.
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection('ECMWF/ERA5/DAILY')
           .select(['mean_2m_air_temperature'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    def to_celsius_and_mask(img):
        # ERA5 está en Kelvin; convertir a °C
        temp_c = img.subtract(273.15)
        # rango razonable para México, recorte de seguridad
        mask = temp_c.gte(-20).And(temp_c.lte(50))
        return temp_c.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_c = col.map(to_celsius_and_mask)

    # Paleta típica de temperatura
    vis_params = {
        'min': 0.0,   # °C
        'max': 35.0,  # °C
        'palette': [
            '000080', '0000d9', '4000ff', '0080ff', '00ffff',
            '00ff80', '80ff00', 'daff00', 'ffff00',
            'ffb000', 'ff4f00', 'ff0000'
        ]
    }

    max_total_pixels = 26_000_000
    base_max_pixels_per_frame = 768 * 768

    pixels_per_frame = min(
        base_max_pixels_per_frame,
        max_total_pixels // max(n_frames, 1)
    )

    if ratio is not None and ratio > 0:
        safe_ratio = max(ratio, 1e-6)
        width_px = int(math.sqrt(pixels_per_frame * safe_ratio))
        height_px = int(width_px / safe_ratio)
    else:
        width_px = int(math.sqrt(pixels_per_frame))
        height_px = width_px

    width_px = max(256, width_px)
    height_px = max(256, height_px)

    dims = f'{width_px}x{height_px}'

    gif_url = col_c.getVideoThumbURL({
        'region': region,
        'dimensions': dims,
        'framesPerSecond': 2,
        'format': 'gif',
        'bands': ['mean_2m_air_temperature'],
        'crs': 'EPSG:3857',
        **vis_params
    })

    return gif_url


def build_era5_temp_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float]
):
    """
    Devuelve serie temporal de temperatura media 2m ERA5 DAILY en °C.
    Salida: (dates, temps) donde temps = [°C].
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)

    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection('ECMWF/ERA5/DAILY')
           .select(['mean_2m_air_temperature'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def to_celsius_and_mean(img):
        temp_c = img.subtract(273.15)
        mask = temp_c.gte(-20).And(temp_c.lte(50))
        temp_c = temp_c.updateMask(mask)

        mean_dict = temp_c.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=27_800,  # resolución ERA5 DAILY ~28 km
            maxPixels=1e7
        )

        mean_val = ee.Number(mean_dict.get('mean_2m_air_temperature'))
        # recorte de seguridad
        mean_val = mean_val.max(-20).min(50)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')

        return ee.Feature(None, {
            'date': date_str,
            'temp_c': mean_val
        })

    fc = col.map(to_celsius_and_mean)

    dates = fc.aggregate_array('date').getInfo()
    temps = fc.aggregate_array('temp_c').getInfo()

    out_dates: list[str] = []
    out_temps: list[float] = []
    for d, v in zip(dates, temps):
        if d is not None and v is not None:
            out_dates.append(d)
            out_temps.append(float(v))

    return out_dates, out_temps


# =====================
# Endpoints NDVI
# =====================

@app.get('/api/ndvi-gif-bbox')
def ndvi_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        ratio = float(ratio_str) if ratio_str is not None else None
    except Exception:
        ratio = None

    try:
        gif_url = build_ndvi_gif_bbox(start, end, bbox, ratio)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not gif_url:
        return jsonify({'error': 'No hay imágenes NDVI para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})


@app.get('/api/ndvi-timeseries-bbox')
def ndvi_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, ndvi_vals = build_ndvi_timeseries_bbox(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': 'No hay imágenes NDVI para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'ndvi': ndvi_vals,
        'bbox': bbox
    })


# =====================
# Endpoints ERA5 Temp
# =====================

@app.get('/api/era5-temp-gif-bbox')
def era5_temp_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        ratio = float(ratio_str) if ratio_str is not None else None
    except Exception:
        ratio = None

    try:
        gif_url = build_era5_temp_gif_bbox(start, end, bbox, ratio)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not gif_url:
        return jsonify({'error': 'No hay datos de temperatura ERA5 para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})


@app.get('/api/era5-temp-timeseries-bbox')
def era5_temp_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, temps = build_era5_temp_timeseries_bbox(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': 'No hay datos de temperatura ERA5 para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'temp': temps,
        'bbox': bbox
    })


# =====================
# Rutas Flask base
# =====================

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_FOLDER, filename)


if __name__ == '__main__':
    app.run(debug=True)
