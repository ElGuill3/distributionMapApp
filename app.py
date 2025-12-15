from flask import Flask, request, jsonify, render_template, send_from_directory
import ee
import os
import json
from typing import Optional


ee.Initialize(project='inundaciones-proyecto')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_FOLDER = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, static_folder=STATIC_FOLDER, template_folder='templates')


def build_ndvi_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: Optional[float] = None
):
    """
    Genera un GIF NDVI (MODIS 061) recortado al bbox.
    bbox: [minLon, minLat, maxLon, maxLat] en EPSG:4326.
    ratio: ancho/alto en píxeles, calculado en el front.
    Devuelve: gif_url (str) o None.
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

    size = col.size().getInfo()
    if size == 0:
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

    # Definir dimensiones respetando el ratio (si viene)
    if ratio is not None and ratio > 0:
        max_pixels = 768
        if ratio >= 1.0:
            width_px = max_pixels
            height_px = int(max_pixels / ratio)
        else:
            height_px = max_pixels
            width_px = int(max_pixels * ratio)
        dims = f'{width_px}x{height_px}'
    else:
        dims = 768

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


def build_ndvi_png_bbox(date: str, bbox: list[float]):
    """
    Genera un PNG NDVI (MODIS 061) para una sola fecha y bbox.
    Devuelve: (png_url, vmin, vmax) o (None, None, None).
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    max_span_deg = 8.0
    if (max_lon - min_lon) > max_span_deg or (max_lat - min_lat) > max_span_deg:
        raise ValueError("El bounding box es demasiado grande. Reduce el área seleccionada.")

    region = ee.Geometry.Rectangle(bbox)
    d = ee.Date(date)

    col = (ee.ImageCollection('MODIS/061/MOD13Q1')
           .select(['NDVI'])
           .filterDate(d, d.advance(1, 'day'))
           .filterBounds(region)
           .sort('system:time_start'))

    size = col.size().getInfo()
    if size == 0:
        return None, None, None

    img = col.first()

    def scale_and_mask(i):
        ndvi = i.multiply(0.0001)
        mask = ndvi.gte(-0.1).And(ndvi.lte(1.0))
        return ndvi.updateMask(mask)

    img_scaled = scale_and_mask(img)

    # 1) Calcular min/max dinámicos en el bbox
    stats = img_scaled.reduceRegion(
        reducer=ee.Reducer.minMax(),
        geometry=region,
        scale=250,      # resolución MOD13Q1
        maxPixels=1e7
    )

    ndvi_min = ee.Number(stats.get('NDVI_min'))
    ndvi_max = ee.Number(stats.get('NDVI_max'))

    # Recorte de seguridad
    ndvi_min = ndvi_min.max(0.0)
    ndvi_max = ndvi_max.min(0.8)

    vmin = float(ndvi_min.getInfo())
    vmax = float(ndvi_max.getInfo())

    vis_params = {
        'min': vmin,
        'max': vmax,
        'palette': ['000000', 'f0e68c', '7fff00', '006400']
    }

    png_url = img_scaled.getThumbURL({
        'region': region,
        'dimensions': 768,
        'format': 'png',
        'bands': ['NDVI'],
        'crs': 'EPSG:3857',
        **vis_params
    })

    return png_url, vmin, vmax


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


@app.get('/api/ndvi-png-bbox')
def ndvi_png_bbox():
    date = request.args.get('date')
    bbox_str = request.args.get('bbox')

    if not date or not bbox_str:
        return jsonify({'error': 'Parámetros date y bbox son requeridos.'}), 400

    try:
        bbox = json.loads(bbox_str)
        if not (isinstance(bbox, list) and len(bbox) == 4):
            raise ValueError
        bbox = [float(v) for v in bbox]
    except Exception:
        return jsonify({'error': 'bbox debe ser un JSON [minLon,minLat,maxLon,maxLat].'}), 400

    try:
        png_url, vmin, vmax = build_ndvi_png_bbox(date, bbox)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if not png_url:
        return jsonify({'error': 'No hay imagen NDVI para esa fecha / región.'}), 400

    return jsonify({
        'pngUrl': png_url,
        'bbox': bbox,
        'ndviMin': vmin,
        'ndviMax': vmax
    })


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


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_FOLDER, filename)


if __name__ == '__main__':
    app.run(debug=True)
