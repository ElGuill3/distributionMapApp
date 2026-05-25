"""
Módulo GEE para Cuerpos de Agua e Inundaciones.
Soporta dos satélites:
  1. Landsat (óptico, 30m, 2000-2024): compuesto mediano estacional y MNDWI dinámico.
  2. Sentinel-1 (radar, 10m, 2015-2024): compuesto de retrodispersión y umbral VH dinámico.
"""

import ee

from config import BASE_PIXELS_S2, MAX_SPAN_DEG_S2
from gee.utils import compute_gif_dims, validate_bbox

_FRAMES_PER_SECOND = 2
_CLOUD_FILTER = 60  # máximo % nubosidad permitido para Landsat
_MIN_CONNECTED_PX = 9  # para eliminar agua espúrea
_REDUCE_SCALE_TS = 60

_VIS_PARAMS: dict = {
    "min": 0,
    "max": 1,
    "palette": ["00000000", "0000ff"],
}


def _get_landsat_collection(bbox: list[float], start: str, end: str) -> ee.ImageCollection:
    """Obtiene y une las colecciones de Landsat 5, 7, 8 y 9 harmonizando nombres de bandas."""
    region = ee.Geometry.Rectangle(bbox)

    l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filterBounds(region).filterDate(start, end)
    l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filterBounds(region).filterDate(start, end)
    l7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filterBounds(region).filterDate(start, end)
    l5 = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2").filterBounds(region).filterDate(start, end)

    def prep_l89(img: ee.Image) -> ee.Image:
        qa = img.select("QA_PIXEL")
        cloud_shadow_bit = 1 << 3
        cloud_bit = 1 << 4
        mask = qa.bitwiseAnd(cloud_shadow_bit).eq(0).And(qa.bitwiseAnd(cloud_bit).eq(0))

        green = img.select("SR_B3").rename("Green")
        nir = img.select("SR_B5").rename("NIR")
        swir1 = img.select("SR_B6").rename("SWIR1")
        swir2 = img.select("SR_B7").rename("SWIR2")

        return img.select([]).addBands([green, nir, swir1, swir2]).updateMask(mask)

    def prep_l57(img: ee.Image) -> ee.Image:
        qa = img.select("QA_PIXEL")
        cloud_shadow_bit = 1 << 3
        cloud_bit = 1 << 4
        mask = qa.bitwiseAnd(cloud_shadow_bit).eq(0).And(qa.bitwiseAnd(cloud_bit).eq(0))

        green = img.select("SR_B2").rename("Green")
        nir = img.select("SR_B4").rename("NIR")
        swir1 = img.select("SR_B5").rename("SWIR1")
        swir2 = img.select("SR_B7").rename("SWIR2")

        return img.select([]).addBands([green, nir, swir1, swir2]).updateMask(mask)

    l9_prep = l9.map(prep_l89)
    l8_prep = l8.map(prep_l89)
    l7_prep = l7.map(prep_l57)
    l5_prep = l5.map(prep_l57)

    return l9_prep.merge(l8_prep).merge(l7_prep).merge(l5_prep)


def _scale_landsat(img: ee.Image) -> ee.Image:
    """Escala las bandas de reflectancia de Landsat Collection 2 Level 2 a rango 0-1."""
    scaled = img.select(["Green", "NIR", "SWIR1", "SWIR2"]).multiply(0.0000275).subtract(0.2)
    return img.addBands(scaled, overwrite=True)


def _compute_mndwi(img: ee.Image) -> ee.Image:
    """Calcula el índice MNDWI (Modified Normalized Difference Water Index)."""
    green = img.select("Green")
    swir1 = img.select("SWIR1")
    mndwi = green.subtract(swir1).divide(green.add(swir1)).rename("MNDWI")
    return img.addBands(mndwi)


def _get_s1_collection(bbox: list[float], start: str, end: str) -> ee.ImageCollection:
    """Filtra la colección de Sentinel-1 SAR (Radar) para el área y fechas indicadas."""
    region = ee.Geometry.Rectangle(bbox)
    return (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(region)
        .filterDate(ee.Date(start), ee.Date(end))
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
        .filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING"))
    )


def build_water_gif_bbox(
    start: str,
    end: str,
    bbox: list[float],
    ratio: float | None = None,
    satellite: str = "landsat",
) -> str | None:
    """
    Genera la URL de una sola imagen estática (como un GIF de 1 fotograma) de detección de agua.
    Usa el satélite indicado ('landsat' o 'sentinel1') con umbralización dinámica en la región.
    """
    validate_bbox(bbox, max_span=MAX_SPAN_DEG_S2)

    region = ee.Geometry.Rectangle(bbox)

    # Capa de pendientes para evitar sombras de montañas
    dem = ee.Image("USGS/SRTMGL1_003").clip(region)
    slope_mask = ee.Terrain.slope(dem).lt(5)

    if satellite == "sentinel1":
        col = _get_s1_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return None

        # Reducir a mediana temporal y aplicar filtro focal para suavizar speckle
        s1_img = col.median().select(["VV", "VH"]).focalMedian(50, "circle", "meters")

        # Calcular percentil 15 de VH en la región (umbral dinámico)
        stats = s1_img.select("VH").reduceRegion(
            reducer=ee.Reducer.percentile([15]),
            geometry=region,
            scale=60,
            maxPixels=1e9,
            bestEffort=True,
        )
        vh_val = ee.Number(ee.Algorithms.If(stats.get("VH"), stats.get("VH"), -18.0))
        thresh_num = vh_val

        # Detección: reflectancia de radar baja (agua es oscura) y pendiente plana
        water = s1_img.select("VH").lt(thresh_num).updateMask(slope_mask)
        water = water.focal_mode(radius=1, units="pixels").selfMask()

    else:
        col = _get_landsat_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return None

        img = col.median()
        img = _scale_landsat(img)
        img = _compute_mndwi(img)

        mndwi = img.select("MNDWI")
        nir = img.select("NIR")

        # Calcular percentil 85 de MNDWI (umbral dinámico)
        stats = mndwi.reduceRegion(
            reducer=ee.Reducer.percentile([85]),
            geometry=region,
            scale=60,
            maxPixels=1e9,
            bestEffort=True,
        )
        # Asegurar piso de 0.0 para evitar clasificar tierra seca
        mndwi_val = ee.Number(ee.Algorithms.If(stats.get("MNDWI"), stats.get("MNDWI"), 0.0))
        thresh_num = mndwi_val.max(0.0)

        # Detección: MNDWI alto, NIR bajo y pendiente plana
        water = mndwi.gt(thresh_num).And(nir.lt(0.15)).updateMask(slope_mask)
        water = water.focal_mode(radius=1, units="pixels").selfMask()

    # Filtro de conectividad
    connected = water.connectedPixelCount(maxSize=100, eightConnected=True)
    water_clean = water.updateMask(connected.gte(_MIN_CONNECTED_PX)).rename("water")

    # Crear una colección de un único frame temporal para el GIF estático
    # y así mantener compatibilidad con el frontend
    single_frame = water_clean.set("system:time_start", ee.Date(start).millis())
    col_water = ee.ImageCollection([single_frame])

    dims = compute_gif_dims(1, ratio, BASE_PIXELS_S2)

    return col_water.getVideoThumbURL(
        {
            "region": region,
            "dimensions": dims,
            "framesPerSecond": _FRAMES_PER_SECOND,
            "format": "gif",
            "bands": ["water"],
            "crs": "EPSG:3857",
            **_VIS_PARAMS,
        }
    )


def build_water_timeseries_bbox(
    start: str,
    end: str,
    bbox: list[float],
    satellite: str = "landsat",
) -> tuple[list[str], list[float]]:
    """Estima el área de agua superficial (ha) por día/imagen en el bbox."""
    validate_bbox(bbox, max_span=MAX_SPAN_DEG_S2)

    region = ee.Geometry.Rectangle(bbox)

    dem = ee.Image("USGS/SRTMGL1_003").clip(region)
    slope_mask = ee.Terrain.slope(dem).lt(5)

    if satellite == "sentinel1":
        col = _get_s1_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return [], []

        # Agrupar y mosaicar Sentinel-1 por día usando Join para evitar duplicados
        def _add_date(img: ee.Image) -> ee.Image:
            return img.set("date", img.date().format("YYYY-MM-dd"))

        col_with_date = col.map(_add_date)
        distinct_dates_col = col_with_date.distinct("date")
        join = ee.Join.saveAll(matchesKey="images")
        join_filter = ee.Filter.equals(leftField="date", rightField="date")
        joined = join.apply(distinct_dates_col, col_with_date, join_filter)

        def _make_daily_mosaic_s1(img: ee.Element) -> ee.Image:
            img = ee.Image(img)
            image_list = ee.List(img.get("images"))
            image_col = ee.ImageCollection(image_list)
            return ee.Image(image_col.mosaic()).copyProperties(
                img, ["system:time_start", "date"]
            )

        mosaiced_col = ee.ImageCollection(joined.map(_make_daily_mosaic_s1))

        def _water_fraction_s1(img: ee.Image) -> ee.Feature:
            s1_img = img.select(["VV", "VH"]).focalMedian(50, "circle", "meters")

            stats = s1_img.select("VH").reduceRegion(
                reducer=ee.Reducer.percentile([15]),
                geometry=region,
                scale=_REDUCE_SCALE_TS,
                maxPixels=5e7,
                bestEffort=True,
            )
            vh_val = ee.Number(ee.Algorithms.If(stats.get("VH"), stats.get("VH"), -18.0))
            thresh_num = vh_val

            water = s1_img.select("VH").lt(thresh_num).updateMask(slope_mask).rename("water")

            area_img = ee.Image.pixelArea().multiply(water.unmask(0)).rename("area")
            stats_area = area_img.reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=region,
                scale=_REDUCE_SCALE_TS,
                maxPixels=5e7,
                bestEffort=True,
            )
            area_ha = ee.Number(stats_area.get("area")).divide(10_000)
            date_str = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
            return ee.Feature(None, {"date": date_str, "water_ha": area_ha})

        fc = mosaiced_col.map(_water_fraction_s1)

    else:  # landsat
        col = _get_landsat_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return [], []

        # Agrupar y mosaicar Landsat por día usando Join para evitar duplicados
        def _add_date(img: ee.Image) -> ee.Image:
            return img.set("date", img.date().format("YYYY-MM-dd"))

        col_with_date = col.map(_add_date)
        distinct_dates_col = col_with_date.distinct("date")
        join = ee.Join.saveAll(matchesKey="images")
        join_filter = ee.Filter.equals(leftField="date", rightField="date")
        joined = join.apply(distinct_dates_col, col_with_date, join_filter)

        def _make_daily_mosaic_landsat(img: ee.Element) -> ee.Image:
            img = ee.Image(img)
            image_list = ee.List(img.get("images"))
            image_col = ee.ImageCollection(image_list)
            return ee.Image(image_col.mosaic()).copyProperties(
                img, ["system:time_start", "date"]
            )

        mosaiced_col = ee.ImageCollection(joined.map(_make_daily_mosaic_landsat))

        def _water_fraction_landsat(img: ee.Image) -> ee.Feature:
            scaled_img = _scale_landsat(img)
            mndwi_img = _compute_mndwi(scaled_img)

            mndwi = mndwi_img.select("MNDWI")
            nir = mndwi_img.select("NIR")

            stats = mndwi.reduceRegion(
                reducer=ee.Reducer.percentile([85]),
                geometry=region,
                scale=_REDUCE_SCALE_TS,
                maxPixels=5e7,
                bestEffort=True,
            )
            mndwi_val = ee.Number(ee.Algorithms.If(stats.get("MNDWI"), stats.get("MNDWI"), 0.0))
            thresh_num = mndwi_val.max(0.0)

            water = mndwi.gt(thresh_num).And(nir.lt(0.15)).updateMask(slope_mask).rename("water")

            area_img = ee.Image.pixelArea().multiply(water.unmask(0)).rename("area")
            stats_area = area_img.reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=region,
                scale=_REDUCE_SCALE_TS,
                maxPixels=5e7,
                bestEffort=True,
            )
            area_ha = ee.Number(stats_area.get("area")).divide(10_000)
            date_str = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
            return ee.Feature(None, {"date": date_str, "water_ha": area_ha})

        fc = mosaiced_col.map(_water_fraction_landsat)

    dates = fc.aggregate_array("date").getInfo()
    vals = fc.aggregate_array("water_ha").getInfo()

    out_dates: list[str] = []
    out_vals: list[float] = []
    for d, v in zip(dates, vals):
        if d is not None and v is not None:
            out_dates.append(d)
            out_vals.append(float(v))

    return out_dates, out_vals


def _get_flood_mask_and_visualizations(
    start: str,
    end: str,
    bbox: list[float],
    satellite: str = "sentinel1",
    use_auto_threshold: bool = True,
    threshold: float = -18.0,
) -> tuple[ee.Image | None, float, dict | None, ee.Image | None]:
    """
    Helper interno para clasificar la inundación y preparar los parámetros de visualización.
    Retorna (flood_mask, final_thresh, vis_params, background_img).
    """
    validate_bbox(bbox, max_span=MAX_SPAN_DEG_S2)
    region = ee.Geometry.Rectangle(bbox)

    # Máscara de pendientes (evita sombras de montañas)
    dem = ee.Image("USGS/SRTMGL1_003").clip(region)
    slope_mask = ee.Terrain.slope(dem).lt(5)

    # Máscara de agua permanente (JRC occurrence > 50)
    jrc = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").clip(region)
    perm_water_mask = jrc.select("occurrence").gt(50)

    if satellite == "sentinel1":
        col = _get_s1_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return None, -18.0, None, None

        # Reducir a mediana temporal y aplicar filtro focal
        s1_img = col.median().select(["VV", "VH"]).focalMedian(50, "circle", "meters")

        if use_auto_threshold:
            stats = s1_img.select("VH").reduceRegion(
                reducer=ee.Reducer.percentile([15]),
                geometry=region,
                scale=60,
                maxPixels=1e9,
                bestEffort=True,
            )
            stats_dict = stats.getInfo()
            vh_val = stats_dict.get("VH") if stats_dict else None
            if vh_val is None:
                vh_val = -18.0
            final_thresh = float(vh_val)
        else:
            final_thresh = threshold

        # Detección
        water = s1_img.select("VH").lt(final_thresh).updateMask(slope_mask)
        water = water.focal_mode(radius=1, units="pixels").selfMask()
        connected = water.connectedPixelCount(maxSize=100, eightConnected=True)
        water_clean = water.updateMask(connected.gte(_MIN_CONNECTED_PX))
        flood_mask = water_clean.updateMask(perm_water_mask.Not()).rename("flood")

        sar_vis = {"min": -30, "max": 0, "palette": ["black", "white"]}
        return flood_mask, final_thresh, sar_vis, s1_img.select("VH")

    else:  # landsat
        col = _get_landsat_collection(bbox, start, end)
        if col.size().getInfo() == 0:
            return None, 0.0, None, None

        img = col.median()
        img = _scale_landsat(img)
        img = _compute_mndwi(img)

        mndwi = img.select("MNDWI")
        nir = img.select("NIR")

        if use_auto_threshold:
            stats = mndwi.reduceRegion(
                reducer=ee.Reducer.percentile([85]),
                geometry=region,
                scale=60,
                maxPixels=1e9,
                bestEffort=True,
            )
            stats_dict = stats.getInfo()
            mndwi_val = stats_dict.get("MNDWI") if stats_dict else None
            if mndwi_val is None:
                mndwi_val = 0.0
            final_thresh = max(0.0, float(mndwi_val))
        else:
            final_thresh = threshold

        # Detección
        water = mndwi.gt(final_thresh).And(nir.lt(0.15)).updateMask(slope_mask)
        water = water.focal_mode(radius=1, units="pixels").selfMask()
        connected = water.connectedPixelCount(maxSize=100, eightConnected=True)
        water_clean = water.updateMask(connected.gte(_MIN_CONNECTED_PX))
        flood_mask = water_clean.updateMask(perm_water_mask.Not()).rename("flood")

        landsat_vis_params = {"bands": ["SWIR1", "NIR", "Green"], "min": 0.0, "max": 0.4}
        return flood_mask, final_thresh, landsat_vis_params, img


def detect_floods_bbox(
    start: str,
    end: str,
    bbox: list[float],
    satellite: str = "sentinel1",
    use_auto_threshold: bool = True,
    threshold: float = -18.0,
) -> dict | None:
    """
    Detecta áreas inundadas en un bbox y un rango de fechas.
    Retorna la URL de teselas de la inundación, imagen de fondo y umbral.
    """
    flood_mask, final_thresh, vis_params, bg_img = _get_flood_mask_and_visualizations(
        start, end, bbox, satellite, use_auto_threshold, threshold
    )

    if flood_mask is None or vis_params is None or bg_img is None:
        return None

    flood_vis = {"palette": ["00FFFF"]}  # Cian

    # Retorna las URLs de mapa para Leaflet
    return {
        "satellite": satellite,
        "computed_threshold": round(final_thresh, 4),
        "background_layer": bg_img.getMapId(vis_params)["tile_fetcher"].url_format,
        "water_layer": flood_mask.updateMask(flood_mask).getMapId(flood_vis)["tile_fetcher"].url_format,
    }


def calculate_flood_area(
    start: str,
    end: str,
    bbox: list[float],
    satellite: str = "sentinel1",
    use_auto_threshold: bool = True,
    threshold: float = -18.0,
) -> float:
    """
    Calculates the flooded area in hectares.
    """
    region = ee.Geometry.Rectangle(bbox)
    flood_mask, _, _, _ = _get_flood_mask_and_visualizations(
        start, end, bbox, satellite, use_auto_threshold, threshold
    )

    if flood_mask is None:
        return 0.0

    area_img = ee.Image.pixelArea().multiply(flood_mask.unmask(0)).rename("area")
    stats_area = area_img.reduceRegion(
        reducer=ee.Reducer.sum(),
        geometry=region,
        scale=30,  # 30m para calcular área
        maxPixels=1e10,
        bestEffort=True,
    )
    area_info = stats_area.getInfo()
    total_ha = (area_info.get("area", 0.0) or 0.0) / 10000.0
    return float(total_ha)

