import ee
ee.Initialize(project='inundaciones-proyecto')

# 1. Temperatura media diaria a 2 m, ERA5-DAILY, año 2019
t2m_c = (ee.ImageCollection('ECMWF/ERA5/DAILY')
         .select('mean_2m_air_temperature')         # K
         .filterDate('2019-01-01', '2019-12-31')
         .mean()
         .subtract(273.15))                         # → °C

# 2. Parámetros de visualización (ajustables)
vis_params = {
    'min': 10,                                      # °C
    'max': 35,
    'palette': ['0000ff', '00ffff', 'ffff00', 'ff0000']  # frío → caliente
}

# 3. URL de tiles para Leaflet
url = t2m_c.getMapId(vis_params)['tile_fetcher'].url_format
print(url)
