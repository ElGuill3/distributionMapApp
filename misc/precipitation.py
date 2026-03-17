import ee
ee.Initialize(project='inundaciones-proyecto')

imerg = (ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07')
         .select('precipitation')
         .filterDate('2019-01-01', '2019-12-31'))

precip = imerg.sum()

vis_params = {
    'min': 0.3,
    'max': 12.0,
    'palette': [
        'ffffff',  # más seco
        'ccebc5',
        '7bccc4',
        '43a2ca',
        '0868ac',
        '081d58'   # más húmedo
    ]
}

url = precip.getMapId(vis_params)['tile_fetcher'].url_format
print(url)
