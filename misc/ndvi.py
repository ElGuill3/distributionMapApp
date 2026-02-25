import ee
ee.Initialize(project='inundaciones-proyecto')

ndvi = (ee.ImageCollection('NOAA/CDR/AVHRR/NDVI/V5')
        .select('NDVI')
        .filterDate('2010-01-01', '2010-12-31')
        .mean())

vis_params = {
    'min': 0,
    'max': 8000,
    'palette': [
        '0000ff',  # agua / nubes
        'f0e68c',  # suelos
        'ffd700',
        'adff2f',
        '7fff00',
        '006400'   # vegetación densa
    ]
}

url = ndvi.getMapId(vis_params)['tile_fetcher'].url_format
print(url)
