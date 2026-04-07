import ee
ee.Initialize(project='inundaciones-proyecto')

# 1. MERRA‑2 T2M 2019, en Kelvin
t2m_k = (ee.ImageCollection('NASA/GSFC/MERRA/slv/2')
         .select('T2M')
         .filterDate('2019-01-01', '2019-12-31')
         .mean())

# 2. Pasar a °C
t2m_c = t2m_k.subtract(273.15)

# 3. Tu bounding box “Ríos”
rios = ee.Geometry.Rectangle(
    [-91.755066, 17.209017, -90.906372, 18.171950]
)

# 4. Min y max en esa zona
stats = t2m_c.reduceRegion(
    reducer=ee.Reducer.minMax(),
    geometry=rios,
    scale=50000,
    bestEffort=True
)

print(stats.getInfo())
