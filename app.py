from flask import Flask, request, jsonify, render_template, send_from_directory
import ee
import os
import json
from typing import Optional
import math
from datetime import datetime

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
# ERA5-Land Temperatura - GIF + Serie
# ===============================

ERA5_LAND_DAILY = 'ECMWF/ERA5_LAND/DAILY_AGGR'

def build_era5_temp_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection(ERA5_LAND_DAILY)
           .select(['temperature_2m'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    def to_celsius_and_mask(img):
        temp_c = img.subtract(273.15)
        mask = temp_c.gte(-20).And(temp_c.lte(50))
        return temp_c.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_c = col.map(to_celsius_and_mask)

    vis_params = {
        'min': 0.0,
        'max': 35.0,
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
        'framesPerSecond': 3,
        'format': 'gif',
        'bands': ['temperature_2m'],
        'crs': 'EPSG:3857',
        **vis_params
    })

    return gif_url

def build_era5_temp_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float]
):
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)

    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection(ERA5_LAND_DAILY)
           .select(['temperature_2m'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def daily_mean_feature(img):
        temp_c = img.subtract(273.15)
        mask = temp_c.gte(-20).And(temp_c.lte(50))
        temp_c = temp_c.updateMask(mask)

        mean_dict = temp_c.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=10_000,
            maxPixels=1e7
        )

        mean_val = ee.Number(mean_dict.get('temperature_2m'))
        mean_val = mean_val.max(-20).min(50)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')

        return ee.Feature(None, {
            'date': date_str,
            'temp_c': mean_val
        })

    fc = col.map(daily_mean_feature)

    dates = fc.aggregate_array('date').getInfo()
    temps = fc.aggregate_array('temp_c').getInfo()

    out_dates: list[str] = []
    out_temps: list[float] = []
    for d, v in zip(dates, temps):
        if d is not None and v is not None:
            out_dates.append(d)
            out_temps.append(float(v))

    return out_dates, out_temps

# ===============================
# ERA5-Land Humedad del suelo - GIF + Serie
# ===============================

SOIL_BAND = 'volumetric_soil_water_layer_1'

def build_era5_soil_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    """
    GIF de humedad del suelo superficial (0–7 cm) en % volumétrico.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection(ERA5_LAND_DAILY)
           .select([SOIL_BAND])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    def to_percent_and_mask(img):
        # fracción 0–1 → porcentaje 0–100
        sm_pct = img.multiply(100)
        mask = sm_pct.gte(0).And(sm_pct.lte(100))
        return sm_pct.updateMask(mask).copyProperties(img, ['system:time_start'])

    col_p = col.map(to_percent_and_mask)

    vis_params = {
        'min': 0.0,
        'max': 60.0,
        'palette': [
            '552200', '8c510a', 'bf812d', 'dfc27d',
            'f6e8c3', 'c7eae5', '80cdc1', '35978f', '01665e'
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

    gif_url = col_p.getVideoThumbURL({
        'region': region,
        'dimensions': dims,
        'framesPerSecond': 3,
        'format': 'gif',
        'bands': [SOIL_BAND],
        'crs': 'EPSG:3857',
        **vis_params
    })

    return gif_url

def build_era5_soil_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float]
):
    """
    Serie diaria de humedad del suelo (0–7 cm) en %.
    Salida: (dates, soil_pct).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)

    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection(ERA5_LAND_DAILY)
           .select([SOIL_BAND])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def daily_mean_feature(img):
        sm = img  # fracción 0–1
        mean_dict = sm.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=10_000,
            maxPixels=1e7
        )
        mean_val = ee.Number(mean_dict.get(SOIL_BAND))
        # recorte de seguridad y conversión a %
        mean_val = mean_val.max(0).min(1).multiply(100)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')

        return ee.Feature(None, {
            'date': date_str,
            'soil_pct': mean_val
        })

    fc = col.map(daily_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals = fc.aggregate_array('soil_pct').getInfo()

    out_dates: list[str] = []
    out_vals: list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

# ===============================
# CHIRPS Precipitación - GIF + Serie
# ===============================

CHIRPS_DAILY = 'UCSB-CHG/CHIRPS/DAILY'

def build_chirps_precip_gif_bbox(start: str, end: str, bbox: list[float], ratio: Optional[float] = None):
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)
    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection(CHIRPS_DAILY)
           .select(['precipitation'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    vis_params = {
        'min': 0.0,
        'max': 80.0,
        'palette': ['ffffff', 'cce7ff', '99ccff', '66b2ff', '3389ff', '0055ff', '002b7f']
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

    gif_url = col.getVideoThumbURL({
        'region': region,
        'dimensions': dims,
        'framesPerSecond': 5,
        'format': 'gif',
        'bands': ['precipitation'],
        'crs': 'EPSG:3857',
        **vis_params
    })
    return gif_url


def build_chirps_precip_timeseries_bbox(start: str, end: str, bbox: list[float]):
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)
    start_date = ee.Date(start)
    end_date = ee.Date(end)

    col = (ee.ImageCollection(CHIRPS_DAILY)
           .select(['precipitation'])
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def daily_mean_feature(img):
        mean_dict = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=5000,
            maxPixels=1e7
        )
        mean_val = ee.Number(mean_dict.get('precipitation')).max(0)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
        return ee.Feature(None, {
            'date': date_str,
            'precip_mm': mean_val
        })

    fc = col.map(daily_mean_feature)
    dates = fc.aggregate_array('date').getInfo()
    vals = fc.aggregate_array('precip_mm').getInfo()

    out_dates: list[str] = []
    out_vals: list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

# ===============================
# COPERNICUS Agua (Sentinel-2 + NDWI)
# ===============================

S2_SR = 'COPERNICUS/S2_SR_HARMONIZED'

def build_water_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    """
    GIF de cuerpos de agua (NDWI > 0.3) usando Sentinel-2 SR,
    con suavizado espacial y eliminación de parches pequeños.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 4.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande para Sentinel-2. Reduce el área.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection(S2_SR)
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 60))
           .select(['B3', 'B8', 'QA60']))

    def apply_cloud_mask(img):
        qa = img.select('QA60')
        cloud_bit = 1 << 10
        cirrus_bit = 1 << 11
        cloud_mask = qa.bitwiseAnd(cloud_bit).eq(0).And(
                     qa.bitwiseAnd(cirrus_bit).eq(0))
        return img.updateMask(cloud_mask)

    col = col.map(apply_cloud_mask)

    def ndwi_water(img):
        green = img.select('B3').multiply(0.0001)
        nir = img.select('B8').multiply(0.0001)
        ndwi = green.subtract(nir).divide(green.add(nir)).rename('NDWI')

        # 1) Umbral estricto
        water = ndwi.gt(0.15)

        # 2) Suavizado espacial: rellena huecos de 1 píxel
        water = water.focal_mode(radius=1, units='pixels')

        # 3) Eliminar parches muy pequeños (por ejemplo < 9 píxeles)
        water = water.selfMask()
        connected = water.connectedPixelCount(maxSize=100, eightConnected=True)
        water = water.updateMask(connected.gte(9)).rename('water')

        return water.copyProperties(img, ['system:time_start'])

    col_water = col.map(ndwi_water)

    size = col_water.size()
    n_frames = int(size.getInfo())
    if n_frames == 0:
        return None

    vis_params = {
        'min': 0,
        'max': 1,
        'palette': ['00000000', '0000ff']
    }

    max_total_pixels = 26_000_000
    base_max_pixels_per_frame = 512 * 512
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

    gif_url = col_water.getVideoThumbURL({
        'region': region,
        'dimensions': dims,
        'framesPerSecond': 2,
        'format': 'gif',
        'bands': ['water'],
        'crs': 'EPSG:3857',
        **vis_params
    })
    return gif_url

def build_water_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float]
):
    min_lon, min_lat, max_lon, max_lat = bbox
    max_span_deg = 4.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande para Sentinel-2. Reduce el área.")

    start_date = ee.Date(start)
    end_date = ee.Date(end)
    region = ee.Geometry.Rectangle(bbox)

    col = (ee.ImageCollection(S2_SR)
           .filterDate(start_date, end_date)
           .filterBounds(region)
           .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 60))
           .select(['B3', 'B8', 'QA60']))

    def apply_cloud_mask(img):
        qa = img.select('QA60')
        cloud_bit = 1 << 10
        cirrus_bit = 1 << 11
        cloud_mask = qa.bitwiseAnd(cloud_bit).eq(0).And(
                     qa.bitwiseAnd(cirrus_bit).eq(0))
        return img.updateMask(cloud_mask)

    col = col.map(apply_cloud_mask)

    size = col.size()
    if size.eq(0).getInfo():
        return [], []

    def water_fraction(img):
        green = img.select('B3').multiply(0.0001)
        nir = img.select('B8').multiply(0.0001)
        ndwi = green.subtract(nir).divide(green.add(nir)).rename('NDWI')
        water = ndwi.gt(0.2).rename('water')

        area_img = ee.Image.pixelArea().multiply(water.unmask(0)).rename('area')
        stats = area_img.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=region,
            scale=60,
            maxPixels=5e7,
            bestEffort=True
        )

        area_m2 = ee.Number(stats.get('area'))
        area_ha = area_m2.divide(10000)

        date_str = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')

        return ee.Feature(None, {
            'date': date_str,
            'water_ha': area_ha
        })

    fc = col.map(water_fraction)

    dates = fc.aggregate_array('date').getInfo()
    vals = fc.aggregate_array('water_ha').getInfo()

    out_dates: list[str] = []
    out_vals: list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals

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
# Endpoints ERA5-Land Temperatura
# =====================

def check_max_10_years(start: str, end: str) -> Optional[str]:
    try:
        d_start = datetime.strptime(start, '%Y-%m-%d')
        d_end = datetime.strptime(end, '%Y-%m-%d')
    except ValueError:
        return 'Formato de fecha inválido. Usa YYYY-MM-DD.'

    if d_end <= d_start:
        return 'La fecha fin debe ser posterior a la fecha inicio.'

    years_span = (d_end - d_start).days / 365.25
    if years_span > 10.0:
        return 'El rango de fechas excede el límite de 10 años. Reduce el intervalo.'
    return None

@app.get('/api/era5-temp-gif-bbox')
def era5_temp_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

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
        return jsonify({'error': 'No hay datos de temperatura ERA5-Land para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})

@app.get('/api/era5-temp-timeseries-bbox')
def era5_temp_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

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
        return jsonify({'error': 'No hay datos de temperatura ERA5-Land para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'temp': temps,
        'bbox': bbox
    })

# =====================
# Endpoints ERA5-Land Humedad del suelo
# =====================

@app.get('/api/era5-soil-gif-bbox')
def era5_soil_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

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
        gif_url = build_era5_soil_gif_bbox(start, end, bbox, ratio)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not gif_url:
        return jsonify({'error': 'No hay datos de humedad del suelo ERA5-Land para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})

@app.get('/api/era5-soil-timeseries-bbox')
def era5_soil_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, vals = build_era5_soil_timeseries_bbox(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': 'No hay datos de humedad del suelo ERA5-Land para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'soil_pct': vals,
        'bbox': bbox
    })

# =====================
# Endpoints CHIRPS Precipitación diaria
# =====================

@app.get('/api/imerg-precip-gif-bbox')
def imerg_precip_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

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
        gif_url = build_chirps_precip_gif_bbox(start, end, bbox, ratio)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not gif_url:
        return jsonify({'error': 'No hay datos de precipitación CHIRPS para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})


@app.get('/api/imerg-precip-timeseries-bbox')
def imerg_precip_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, vals = build_chirps_precip_timeseries_bbox(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': 'No hay datos de precipitación CHIRPS para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'precip_mm': vals,
        'bbox': bbox
    })

# =====================
# Endpoints Agua (Sentinel-2 + NDWI, hectáreas)
# =====================

@app.get('/api/water-gif-bbox')
def water_gif_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')
    ratio_str = request.args.get('ratio')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

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
        gif_url = build_water_gif_bbox(start, end, bbox, ratio)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not gif_url:
        return jsonify({'error': 'No hay observaciones de agua (Sentinel-2) para ese rango / región.'}), 400

    return jsonify({'gifUrl': gif_url, 'bbox': bbox})


@app.get('/api/water-timeseries-bbox')
def water_timeseries_bbox():
    start = request.args.get('start')
    end = request.args.get('end')
    bbox_str = request.args.get('bbox')

    if not start or not end or not bbox_str:
        return jsonify({'error': 'Parámetros start, end y bbox son requeridos.'}), 400

    err = check_max_10_years(start, end)
    if err:
        return jsonify({'error': err}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        dates, vals = build_water_timeseries_bbox(start, end, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not dates:
        return jsonify({'error': 'No hay observaciones de agua (Sentinel-2) para ese rango / región.'}), 400

    return jsonify({
        'dates': dates,
        'water_ha': vals,
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