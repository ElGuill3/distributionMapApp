# Visor Hidrometeorológico — distributionMapApp

Aplicación web interactiva para visualizar animaciones y series temporales de variables hidrometeorológicas sobre el estado de Tabasco, México, usando Google Earth Engine como principal fuente de datos satelitales.

---

## Descripción general

El estado de Tabasco presenta una alta variabilidad hidrológica y climática, lo que genera la necesidad de contar con herramientas que permitan explorar y comparar datos ambientales de forma visual, sin requerir conocimientos de programación. Esta aplicación resuelve ese problema ofreciendo un visor cartográfico en el navegador desde el que cualquier persona puede:

- Seleccionar una región de interés dibujando un cuadro sobre el mapa.
- Elegir una variable hidrometeorológica, un año y una temporada.
- Generar automáticamente una animación satelital (GIF) y su gráfica temporal asociada.
- Comparar dos períodos distintos en paralelo gracias al **modo comparativa**.
- Visualizar el mapa de riesgo de inundación por municipio.
- Consultar el nivel hidrométrico de las estaciones locales San Pedro (SPTTB) y Boca del Cerro (BDCTB).

**Área de estudio por defecto:** estado de Tabasco (centro aproximado: 17.84° N, 92.62° O, zoom inicial 8).

---

## Características principales

### Variables satelitales (Google Earth Engine)

| Variable | Fuente GEE | Resolución temporal | Período disponible |
|---|---|---|---|
| NDVI (vegetación) | MODIS MOD13Q1 | Cada 16 días | 2000–2024 |
| Temperatura del aire a 2 m | ERA5-Land (ECMWF) | Diario | 2000–2024 |
| Humedad del suelo (0–7 cm) | ERA5-Land (ECMWF) | Diario | 2000–2024 |
| Precipitación diaria | CHIRPS (UCSB) | Diario | 2000–2024 |
| Cuerpos de agua superficial | Sentinel-2 SR | ~5 días | 2015–2024 |

Cada variable genera:
- Un **GIF animado** superpuesto al mapa, con la fecha de cada imagen.
- Una **gráfica temporal** (media espacial en la región seleccionada) con Plotly.

### Mapa de riesgo de inundación

- Índice de Peligro de Inundación (FHI) por municipio, en escala 0–100.
- 16 municipios de Tabasco disponibles, desde GeoTIFFs locales a 100 m de resolución.
- Paleta de colores: verde (bajo riesgo) → amarillo → naranja → rojo (riesgo crítico).

### Estaciones hidrológicas locales

- **San Pedro — SPTTB** (lat 17.79°, lon −91.16°): estación del río San Pedro, Balancán.
- **Boca del Cerro — BDCTB** (lat 17.43°, lon −91.48°): estación del río Usumacinta, Tenosique.
- Los datos provienen de archivos CSV con frecuencia diaria; la aplicación aplica interpolación temporal para huecos de hasta 7 días.
- Sus marcadores aparecen en el mapa cuando no hay animación activa; al pulsar sobre ellos se puede cargar su serie completa (2000–2024).

### Modos de operación

**Modo normal** (un solo mapa):
- Selección de variable, año y temporada en el panel lateral.
- Generación de animación con barra de progreso en tiempo real.
- Gráfica temporal debajo del mapa, combinable con datos de estaciones.

**Modo comparativa** (dos mapas sincronizados):
- Panel A y Panel B con selección independiente de variable, año y temporada.
- Reproducción sincronizada de ambos GIFs: pausa, avance por frame, control de velocidad.
- Gráficas Plotly independientes por panel.
- Carga de datos de estaciones locales por panel mediante checkboxes.

**Modo mapa de riesgo**:
- Activa el control de municipios en el panel lateral.
- Los controles de animación quedan bloqueados para evitar superposiciones.
- Las capas de riesgo se pueden combinar con múltiples municipios simultáneamente.

### Otras características técnicas

- Selección espacial mediante rectángulo dibujado en el mapa (máx. 8°×8°; 4°×4° para Sentinel-2).
- Temporadas: Invierno (dic–feb), Primavera (mar–may), Verano (jun–ago), Otoño (sep–nov), Año completo.
- Rango máximo por petición: 10 años.
- Caché de GIFs en disco con limpieza automática cada 60 minutos.
- Sidebar colapsable para maximizar el área del mapa.

---

## Arquitectura técnica

```
┌─────────────────────────────────────────────────────┐
│                    Navegador                        │
│  TypeScript + Leaflet  │  Plotly.js  │  gifuct-js  │
│  (mapa, controles UI, animación frame a frame)      │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────┐
│               Backend Flask (Python 3)              │
│  routes/  →  gee/  →  services/                     │
└────────────────────────┬────────────────────────────┘
                         │ earthengine-api
┌────────────────────────▼────────────────────────────┐
│          Google Earth Engine (nube)                 │
│  MODIS · ERA5-Land · CHIRPS · Sentinel-2            │
└─────────────────────────────────────────────────────┘
```

**Flujo de una petición típica:**

1. El usuario dibuja un rectángulo en el mapa y elige variable, año y temporada.
2. El frontend envía dos peticiones en paralelo:
   - `GET /api/<variable>-gif-bbox` — genera el GIF animado.
   - `GET /api/<variable>-timeseries-bbox` — obtiene la serie temporal.
3. El backend consulta la colección GEE correspondiente, filtra por fecha y región, y solicita el GIF a través de `getVideoThumbURL`.
4. El GIF se descarga desde GEE, PIL superpone la fecha en cada frame, y el archivo se guarda en `static/gifs/`.
5. El backend responde con `{ gifUrl, bbox, dates, <valores> }`.
6. El frontend superpone el GIF sobre el mapa Leaflet usando `L.imageOverlay` y renderiza la gráfica con Plotly.

El progreso de generación se comunica en tiempo real mediante **Server-Sent Events (SSE)** a través del endpoint `/api/gif-progress/<task_id>`.

---

## Requisitos previos

| Componente | Versión mínima recomendada |
|---|---|
| Python | 3.11 |
| Node.js | 18 |
| npm | 9 |

**Cuenta de Google Earth Engine:**
- Necesitas una cuenta GEE aprobada y un proyecto de Google Cloud con la API de Earth Engine habilitada.
- Más información: [earthengine.google.com](https://earthengine.google.com/)

**Dependencias Python** (ver `requirements.txt`):

```
Flask
earthengine-api
pandas
numpy
rasterio
matplotlib
Pillow
requests
pytest
```

**Dependencias Node** (ver `package.json`):

```
typescript
@types/leaflet
```

---

## Instalación y configuración

### 1. Clonar el repositorio

```bash
git clone <https://github.com/ElGuill3/distributionMapApp.git>
cd distributionMapApp
```

### 2. Crear el entorno virtual Python e instalar dependencias

```bash
python -m venv venv
source venv/bin/activate        # Linux / macOS
# venv\Scripts\activate         # Windows

pip install -r requirements.txt
```

### 3. Autenticar Google Earth Engine

```bash
earthengine authenticate
```

Sigue las instrucciones en pantalla para autorizar la cuenta. Tras autenticarte, edita `config.py` y ajusta el nombre de tu proyecto GEE:

```python
# config.py
GEE_PROJECT = "tu-proyecto-de-google-cloud"
```

### 4. Instalar dependencias de Node y compilar el TypeScript

```bash
npm install
npm run build:ts
```

> Para desarrollo con recompilación automática al guardar cambios:
> ```bash
> npm run watch:ts
> ```

### 5. Datos de estaciones locales

Los archivos CSV de las estaciones deben estar en la raíz del proyecto con los nombres `SPTTB.csv` y `BDCTB.csv`. El formato esperado es:

```
<línea 1: metadatos>
<línea 2: metadatos>
<línea 3: metadatos>
<línea 4: metadatos>
<línea 5: metadatos>
<línea 6: metadatos>
Fecha,Nivel(m),...
YYYY-MM-DD,valor,...
```

Las primeras 6 líneas son de encabezado y se omiten automáticamente. Las columnas mínimas requeridas son `Fecha` y `Nivel(m)`.

Para añadir nuevas estaciones, regístralas en `config.py` bajo el diccionario `LOCAL_STATIONS`.

### 6. Verificar los datos de riesgo de inundación

Los GeoTIFFs del índice FHI deben estar en `data/mapa_riesgo/municipios/` con el nombre `fhi_<municipio>_100m.tif`. El repositorio ya incluye los 16 municipios de Tabasco.

---

## Uso básico

### Iniciar la aplicación

```bash
python app.py
```

Accede desde el navegador a: **http://127.0.0.1:5000**

---

### Modo normal — animación de una variable

1. **Dibuja un rectángulo** en el mapa para definir la región de interés (máx. ~8°×8°).
2. Despliega la sección de la variable deseada en el panel lateral (p. ej. *NDVI*).
3. Selecciona el **año** y la **temporada**.
4. Pulsa **"Generar animación"**.
5. Una barra de progreso aparecerá mientras se procesa el GIF en GEE (puede tardar 15–60 segundos dependiendo del tamaño de la región y del período).
6. El GIF se superpone automáticamente al mapa. Debajo del mapa aparece la **gráfica temporal** de la media espacial para la región seleccionada.
7. Usa la **barra de controles** en la parte inferior para reproducir, pausar, avanzar por frames y cambiar la velocidad.
8. Para limpiar y comenzar de nuevo, pulsa el botón **"Limpiar"** en la barra de herramientas superior.

> **Nota sobre Sentinel-2 (cuerpos de agua):** el área máxima permitida es 4°×4° debido a la alta resolución (10 m) de este sensor.

---

### Modo comparativa — dos períodos en paralelo

1. Pulsa **"Comparar años"** en el panel lateral. Los controles del sidebar quedan bloqueados y aparecen dos paneles (A y B) con sus propios selectores.
2. En el panel A: elige variable, año y temporada; pulsa **"Generar panel A"**.
3. En el panel B: elige variable, año y temporada; pulsa **"Generar panel B"**.
4. Una vez cargados ambos, la reproducción se **sincroniza automáticamente**.
5. Para añadir datos de estaciones locales a cualquier panel, usa los checkboxes que aparecen bajo los selectores de cada panel (se cargarán con la temporada del panel correspondiente).
6. Para salir, vuelve a pulsar **"Comparar años"**. El estado se limpia completamente.

---

### Modo mapa de riesgo de inundación

1. Pulsa **"Mapa de riesgo"** en el panel lateral. Los controles de animación quedan bloqueados.
2. Activa uno o varios municipios marcando sus casillas. Las capas FHI se superponen al mapa.
3. La barra de colores muestra la escala de riesgo (0 = muy bajo, 100 = crítico).
4. Para desactivar una capa, desmarca la casilla correspondiente.
5. Para salir del modo, vuelve a pulsar **"Mapa de riesgo"** (las capas activas se eliminan).

---

### Estaciones locales (modo normal)

En la sección **"Estaciones locales (nivel)"** del panel lateral:
1. Elige el **año** y la **temporada**.
2. Pulsa **"Cargar serie de nivel"**.
3. La serie se agrega a la gráfica debajo del mapa, junto a cualquier variable GEE ya cargada.

También puedes hacer clic sobre el marcador de una estación en el mapa y pulsar **"Ver datos 2000–2024"** para cargar la serie completa.

---

## Estructura del proyecto

```
distributionMapApp/
│
├── app.py                    # Punto de entrada Flask: inicializa GEE, registra blueprints
├── config.py                 # Constantes globales: rutas, colecciones GEE, límites, estaciones
├── requirements.txt          # Dependencias Python
├── package.json              # Dependencias Node y scripts de compilación TS
├── tsconfig.json             # Configuración del compilador TypeScript
│
├── SPTTB.csv                 # Serie de nivel — estación San Pedro (Balancán)
├── BDCTB.csv                 # Serie de nivel — estación Boca del Cerro (Tenosique)
│
├── tests/                    # Tests de unidad (pytest), p. ej. gee/utils
│
├── gee/                      # Módulos de procesamiento con Google Earth Engine
│   ├── ndvi.py               # NDVI — MODIS MOD13Q1
│   ├── temperature.py        # Temperatura — ERA5-Land (Kelvin → Celsius)
│   ├── soil.py               # Humedad del suelo — ERA5-Land
│   ├── precipitation.py      # Precipitación diaria — CHIRPS
│   ├── water.py              # Cuerpos de agua — Sentinel-2 SR (NDWI)
│   ├── flood_risk.py         # Renderizado de mapas FHI desde GeoTIFFs locales
│   └── utils.py              # Funciones compartidas: validación bbox, temporadas, dims GIF
│
├── routes/                   # Blueprints Flask — endpoints de la API REST
│   ├── gif_routes.py         # GET /api/<var>-gif-bbox
│   ├── timeseries_routes.py  # GET /api/<var>-timeseries-bbox
│   ├── flood_routes.py       # GET /api/flood-risk-municipio
│   ├── station_routes.py     # GET /api/local-station-level-range
│   └── progress_routes.py   # GET /api/gif-progress/<task_id>  (SSE)
│
├── services/
│   ├── gif_service.py        # Descarga GIF desde GEE, anotación con PIL, caché, limpieza
│   └── station_service.py    # Lectura y preprocesado de CSV de estaciones locales
│
├── data/
│   └── mapa_riesgo/
│       └── municipios/       # GeoTIFFs FHI por municipio (fhi_<municipio>_100m.tif)
│
├── static/                   # Archivos servidos directamente al navegador
│   ├── main.js               # JavaScript compilado desde TypeScript
│   ├── styles.css            # Hoja de estilos principal
│   ├── gifs/                 # GIFs generados (caché temporal, se limpian automáticamente)
│   └── flood_maps/           # PNGs de mapas de riesgo renderizados
│
├── src/ts/                   # Código fuente TypeScript (se compila a static/)
│   ├── main.ts               # Lógica principal: mapa Leaflet, modos, listeners, estados
│   ├── config.ts             # URLs de endpoints, años disponibles, temporadas, constantes UI
│   ├── types.ts              # Tipos TypeScript e interfaces de la API
│   ├── map/overlays.ts       # Control de overlays Leaflet y barras de colores (colorbars)
│   ├── ui/
│   │   ├── gifPlayer.ts      # Decodificación y reproducción de GIFs frame a frame
│   │   ├── chart.ts          # Renderizado de gráficas con Plotly
│   │   └── progress.ts       # Indicador de progreso (modal overlay)
│   └── listeners/
│       └── variableListeners.ts  # Factory de listeners para controles de variables
│
└── templates/
    └── index.html            # Template HTML principal (carga JS, CSS y librerías CDN)
```

---

## Endpoints de la API

| Endpoint | Parámetros principales | Respuesta |
|---|---|---|
| `GET /api/ndvi-gif-bbox` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, ndvi[] }` |
| `GET /api/era5-temp-gif-bbox` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, temp[] }` |
| `GET /api/era5-soil-gif-bbox` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, soil_pct[] }` |
| `GET /api/imerg-precip-gif-bbox` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, precip_mm[] }` |
| `GET /api/water-gif-bbox` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, water_ha[] }` |
| `GET /api/<var>-timeseries-bbox` | `start`, `end`, `bbox` | `{ dates, bbox, <valores>[] }` |
| `GET /api/gif-progress/<task_id>` | — | SSE: `{ progress: 0–100, message }` |
| `GET /api/flood-risk-municipio` | `muni` | `{ mapUrl, bbox }` |
| `GET /api/local-station-level-range` | `station`, `start`, `end` | `{ station, dates, level_m[] }` |

**Parámetros comunes:**
- `start` / `end`: fechas en formato `YYYY-MM-DD`.
- `bbox`: arreglo JSON `[minLon, minLat, maxLon, maxLat]` en grados decimales (WGS-84).
- `task_id`: identificador único de tarea para el canal SSE de progreso.
- `muni`: clave del municipio (p. ej. `centla`, `macuspana`, `tenosique`).
- `station`: clave de la estación (`SPTTB` o `BDCTB`).

---

## Notas para desarrollo

### Recompilar el TypeScript

Tras modificar cualquier archivo en `src/ts/`, ejecuta:

```bash
npm run build:ts
```

En modo desarrollo con recompilación automática:

```bash
npm run watch:ts
```

### Ejecutar tests (pytest)

Los tests de unidad viven en `tests/` (por ejemplo `tests/test_utils.py` para utilidades de `gee/utils.py`). No requieren conexión a Google Earth Engine para las pruebas de funciones puras.

```bash
python -m pytest tests/ -v
```

Si `pytest` está en el PATH del entorno virtual:

```bash
pytest tests/ -v
```

### Límites de la API de Google Earth Engine

- **Rango de fechas máximo por petición:** 10 años.
- **Tamaño máximo del bounding box:** 8°×8° para todas las variables excepto Sentinel-2, que se limita a 4°×4° debido a su resolución de 10 m.
- **Píxeles máximos totales:** 26,000,000 (el sistema ajusta automáticamente las dimensiones del GIF).
- El tiempo de respuesta de GEE varía entre 15 segundos y varios minutos dependiendo del tamaño de la región, la variable y el período.

### Caché de GIFs

Los GIFs generados se almacenan en `static/gifs/` con el nombre `<variable>_<start>_<end>_<hash>.gif`. Se eliminan automáticamente cuando superan los **60 minutos de antigüedad** (configurable en `config.py` mediante `GIF_MAX_AGE_MINUTES`).

### Despliegue en producción

Para un entorno de producción se recomienda:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 app:app
```

Junto con un servidor proxy inverso (Nginx o Apache) que sirva los archivos estáticos directamente.

---

## Posibles mejoras futuras

- Exportar series temporales y datos de estaciones a CSV desde la interfaz.
- Incorporar más estaciones hidrológicas o fuentes de datos locales.
- Soporte para selección por polígono irregular (no solo rectángulo).

---

## Créditos y fuentes de datos

| Fuente | Descripción |
|---|---|
| [MODIS MOD13Q1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13Q1) | NDVI, resolución 250 m, cada 16 días |
| [ERA5-Land Daily](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_DAILY_AGGR) | Temperatura del aire y humedad del suelo, ~9 km |
| [CHIRPS Daily](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY) | Precipitación diaria, ~5.5 km |
| [Sentinel-2 SR Harmonized](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) | Cuerpos de agua (NDWI), 10 m |
| [CONAGUA / IMTA](https://www.gob.mx/conagua) | Datos hidrométricos de estaciones locales |
| [Google Earth Engine](https://earthengine.google.com/) | Plataforma de procesamiento satelital en la nube |
