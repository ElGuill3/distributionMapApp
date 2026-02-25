import ee
ee.Initialize(project='inundaciones-proyecto')

era = (ee.ImageCollection('ECMWF/ERA5/DAILY')
       .filterDate('2019-01-01', '2019-12-31')
       .mean())

u = era.select('u_component_of_wind_10m')
v = era.select('v_component_of_wind_10m')

# velocidad = sqrt(u^2 + v^2)
wind_speed = u.hypot(v)

vis_params = {
    'min': 0,
    'max': 15,  # ajustable
    'palette': ['ffffff', 'ccebc5', '7bccc4', '43a2ca', '0868ac', '081d58']
}

url = wind_speed.getMapId(vis_params)['tile_fetcher'].url_format
print(url)
