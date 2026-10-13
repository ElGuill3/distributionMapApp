# Flood risk model and map

Replace the GEE-exported FHI GeoTIFFs with a reproducible, validated flood susceptibility model plus a physical hazard layer, rendered fast for the whole state.
Branch `feat/flood-risk-model`. Pipeline runs offline once; the app only serves precomputed artifacts.

## Specs
- S1 (user): "buscar un buen algoritmo y robusto para el mapa de riesgo" and "la idea es ser lo mas preciso posible" — susceptibility model trained on observed floods (gradient boosting), validated with spatial cross-validation, metrics documented; plus JRC physical river hazard layer (return periods).
- S2 (user): "que el mapa también lo generemos nosotros" — reproducible pipeline scripts in the repo produce every artifact from public sources.
- S3 (user, chose "Incluir el LiDAR desde el principio"; approved "descargar ~4,7 GB de LiDAR de INEGI en .cache (no versionado), procesarlo a 10 m y agregar dependencias solo para el pipeline"): terrain derivatives (HAND, flow accumulation, slope, TWI) from INEGI LiDAR 5 m resampled to 10 m (15 m fallback if memory does not fit, reported to the user); raw data stays out of git; pipeline-only dependency group.
- S4 (user): "mantener la optimización, es decir que no tarde mucho en cargar la app en el primer inicio y el mapa como tal" and "mantener o mejorar el costo computacional" — no pipeline work at app startup; serving cost equal or lower than today (no per-click re-render).
- S5 (user): "mejorar la visualizacion, ya sea colores por regiones u otro enfoque que propongas" — statewide layer in Web Mercator, state-relative classes, colorblind-safe palette, municipality choropleth with stats, value readout.
- S6 (user): "si ves algo mas que se pueda mejorar respecto del mapa de riesgo tambien me lo dices y lo revisamos" — report further improvements found; do not implement unrequested scope without asking.
- S7: credit sources (INEGI LiDAR, MERIT Hydro, JRC, Copernicus/Sentinel-1, CENAPRED) per their terms; legend states it is susceptibility, not depth/probability.

## Tasks
- R1 [S2,S3] inline; done — backend/floodmodel package + CLI, `floodmodel` dependency group (lightgbm, scikit-learn, whitebox, pyproj, shapely, pyogrio; app dependencies unchanged); full Python 662 PASS, ruff clean
- R2 [S3] inline; code done — catalog API index (603 sheets) + resumable ZIP-verified downloader (6 tests RED->GREEN); download running
- R3 [S3] inline; pending — mosaic, resample to 10 m, terrain derivatives
- R4 [S1,S2] inline; pending — GEE layers: JRC hazard, GSW occurrence, Sentinel-1 flood events, land cover; CENAPRED flood inventory
- R5 [S1] inline; pending — training set, gradient boosting, spatial CV, metrics report
- R6 [S2,S4,S5] inline; pending — final classified artifact + precomputed Web Mercator tiles
- R7 [S4,S5] inline; pending — backend serving + frontend statewide layer, legend, palette, readout
- R8 [S5] inline; pending — municipality choropleth and stats
- R9 [S6,S7] inline; pending — docs, credits, retire old FHI TIFFs, findings report

## Log
- L1: "Perfecto, ahora si, viene lo bueno, quiero que revises el mapa de riesgos, lo que encontraras es que se carga a partir de imagenes TIFF, o GeoTIFF no recuerdo bien, el punto es que ese mapa lo hice y descargue de Google Earth Engine, pero sinceramente no se me hace lo mejor, y ademas use un algoritmo sencillo de FHI (Forest Hazard Index, usando elevacion. y otros datos de referencia), entonces lo que quiero es ver si podemos hacer que el mapa también lo generemos nosotros, buscando en la medids de lo posible mantener la optimización, es decir que no tarde mucho en cargar la app en el primer inicio y el mapa como tal, me explico? entonces, seria: buscar un buen algoritmo y robusto para el mapa de riesgo, mejorar la visualizacion, ya sea colores por regiones u otro enfoque que propongas, mantener o mejorar el costo computacional, y si ves algo mas que se pueda mejorar respecto del mapa de riesgo tambien me lo dices y lo revisamos"
- L2: Diagnosis: FHI values span 18–64 of 0–100 (0 px >= 80; 3 of 6 legend classes never shown); no reproducible script; 16 float64 EPSG:4326 TIFFs (32 MB); PNG re-rendered per click (0.85 s for all 16); EPSG:4326 image stretched on Web Mercator.
- L3: "el enfoque me gusta, una cosa solamente, el repo hermano no es del FHI, es del modelo de prediccion que estaba en proceso y no terminamos de integrar, no servira de nada revisarlo, al menos por ahora, respecto al FHI, es un buen enfoque todavia, o hay algún otro algoritmo/modelo mejor para el mapa de riesgo? la idea es ser lo mas preciso posible, igusl manteniendo las consideraciones que te di antes"
- L4: User chose "Incluir el LiDAR desde el principio". INEGI catalog API: 603 Tabasco LiDAR terrain 5 m tiles (2012), ~4.7 GB zipped, direct URLs; license allows use with credit. Machine 11 GB RAM -> 10 m processing.
- L5: User approved: "Sí, adelante" to download ~4.7 GB into .cache, process at 10 m, pipeline-only dependencies.
