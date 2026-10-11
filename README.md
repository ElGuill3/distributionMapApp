# Visor Hidrometeorológico — distributionMapApp

*Read this in [English](README.en.md).*

Aplicación web interactiva para visualizar animaciones y series temporales de variables hidrometeorológicas sobre el estado de Tabasco, México, usando Google Earth Engine como principal fuente de datos satelitales.

## Inicio rápido local (solo aplicación)

Sincronice primero el proyecto de la aplicación y, desde la raíz de este
repositorio, ejecute el comando público:

```bash
uv sync
uv run distribution-map
```

`uv sync` instala las dependencias y registra el comando del proyecto. El
comando público es solo-aplicación: compila el frontend TypeScript con el
driver limpio determinista (`scripts/build-typescript.mjs`, expuesto también
como `npm run build:ts`), que compila TypeScript y copia el CSS fuente
`src/styles/styles.css` a la misma URL pública `/static/styles.css`, valida el límite de dependencias de la aplicación y
sirve Flask en primer plano en `http://127.0.0.1:5000`. Nunca requiere el
repositorio hermano del modelo y nunca inicia la API de pronóstico ni el
worker automático.

Antes de ejecutarlo, prepare:

- `.venv/` y `node_modules/` de esta aplicación, además de un runtime de
  Node.js; el lanzador no ejecuta instalaciones.
- `GEE_PROJECT` y una fuente de autorización local de Earth Engine: credenciales
  persistentes (normalmente `~/.config/earthengine/credentials`), un archivo
  seleccionado mediante `GOOGLE_APPLICATION_CREDENTIALS` o las credenciales
  predeterminadas de aplicación de gcloud (normalmente
  `~/.config/gcloud/application_default_credentials.json`).

El comando valida primero esos requisitos, ejecuta una descarga inicial de las
estaciones CONAGUA configuradas en `CONAGUA_HIDROS_STATIONS` y
`CONAGUA_CLIMAS_STATIONS`, compila el frontend y después sirve la aplicación en
primer plano. No hace falta ejecutar otro comando para descargar las estaciones.
La descarga termina antes de que Flask cargue el catálogo; no inicia el
planificador periódico de scrapers. Las respuestas se descargan en una carpeta
temporal. Los CSV Latin-1 y los errores reversibles de UTF-8 interpretado como
Latin-1 se normalizan a UTF-8 antes de validar, sin alterar las observaciones
ni el texto correctamente acentuado. Solo se reemplazan los CSV locales si contienen metadatos de una
estación con coordenadas conocidas y al menos una fecha con una medición válida.
Si alguna descarga falla, el comando advierte y usa los datos locales utilizables.
Si no hay ninguna estación utilizable, termina con código 2 sin iniciar Flask.
Los datos permanecen en `data/stations/` (fuera de Git); el arranque puede tardar
mientras CONAGUA responde o el descargador intenta su alternativa FTP.
El arranque muestra el progreso del descargador y el motivo de rechazo de cada
estación en stderr: archivo no descargado, metadatos inválidos, columna de
medición no reconocida (revisar codificación) o filas malformadas. Así se
distinguen los fallos de descarga de los rechazos de validación; el resumen
final permanece en stdout. Pulse `Ctrl+C` para terminar el backend; los
registros permanecen en `.cache/bdctb-local-app/logs/`, con el mismo esquema
privado del supervisor general (`0600` por archivo, `0700` para el directorio,
tres archivos de hasta 1 MiB cada uno).

Sin la pila del modelo no existe caché de pronóstico válida: la aplicación
sigue funcionando, pero sus rutas de pronóstico no deben presentarse como
predicción operativa.

## Ruta diferida: pila local con pronóstico automático (compatibilidad)

La pila completa con modelo, API de pronóstico y worker se conserva en
`scripts/run_local_forecast_stack.py` para uso diferido; ya no es el destino
del comando público:

```bash
.venv/bin/python scripts/run_local_forecast_stack.py
.venv/bin/python scripts/run_local_forecast_stack.py --model-repo /ruta/al/repositorio
```

El modelo es una dependencia local explícita y permanece en un repositorio
separado. De forma predeterminada, el script espera el checkout hermano
`../distributionMapApp-model-research`. No descarga el modelo automáticamente.

El repositorio del modelo selecciona sus rutas canónicas mediante
`configs/model/bdctb_runtime_paths_v1.json`. Actualmente, ese descriptor resuelve
el bundle calibrado en
`runs/bdctb-exogenous-qgb-real-v1-calibrated-20260730`. El supervisor también
descubre allí los pesos GEFS versionados; no modifica credenciales ni instala
dependencias del modelo.

Para un diseño no estándar, `BDCTB_MODEL_BUNDLE` y `BDCTB_GEFS_WEIGHTS` siguen
siendo reemplazos opcionales explícitos. También se pueden reemplazar
`BDCTB_MODEL_CONFIG`, `BDCTB_STATE_ROOT` y `BDCTB_CACHE_PATH`. Exporte esas
variables en el proceso del supervisor; el archivo `.env` de esta aplicación no
es una fuente de configuración para el lanzador.

Antes de ejecutarlo, prepare:

- `.venv/` y `node_modules/` de esta aplicación, sin ejecutar instalaciones
  desde el supervisor.
- `.venv/` del repositorio del modelo con sus dependencias de modelo, GEFS y
  GloFAS.
- `GEE_PROJECT` y una fuente de autorización local de Earth Engine: credenciales
  persistentes (normalmente `~/.config/earthengine/credentials`), un archivo
  seleccionado mediante `GOOGLE_APPLICATION_CREDENTIALS` o las credenciales
  predeterminadas de aplicación de gcloud (normalmente
  `~/.config/gcloud/application_default_credentials.json`).
- Una configuración externa de credenciales GloFAS/EWDS: `CDSAPI_RC` apuntando
  a un archivo de credenciales (o el archivo predeterminado `~/.cdsapirc`), o
  ambas variables `CDSAPI_URL` y `CDSAPI_KEY` en el entorno del supervisor.

El script valida primero esos requisitos y compila la aplicación TypeScript
currente directamente con el compilador TypeScript local
(`node_modules/.bin/tsc`). Después inicia tres procesos en
primer plano: la aplicación en
`http://127.0.0.1:5000`, la API de pronóstico en
`http://127.0.0.1:8765` y el worker automático independiente. La aplicación
configura internamente su proxy hacia esa API. Pulse `Ctrl+C` para terminar solo
esos tres procesos; los registros permanecen en
`.cache/bdctb-local-stack/logs/`.
Cada proceso conserva como máximo tres archivos de registro privados (`0600`),
de hasta 1 MiB cada uno. El directorio es privado (`0700`) y el archivo actual
conserva la evidencia de diagnóstico más reciente.

Después de pulsar `Ctrl+C`, la limpieza opcional se limita a los diagnósticos
del supervisor:

```bash
rm -rf .cache/bdctb-local-stack
```

No incluya en la limpieza habitual el estado
`var/operational/bdctb/` ni la caché
`var/forecasts/bdctb/latest-v1.json` del modelo. El estado protege la
recuperación de entregas y la caché sirve el último pronóstico válido; eliminar
cualquiera de ellos restablece intencionalmente esas garantías y puede volver a
producir respuestas HTTP 503.

El navegador y el proxy solo consultan la caché. Nunca ejecutan el worker. El
worker comprueba disponibilidad normalmente cada 15 minutos y conserva su
política acotada de ciclo común 00Z, estabilidad GEFS, costo GloFAS exacto menor
o igual a 6 y una sola entrega sin reenvío automático. En el primer inicio, una
respuesta HTTP 503 es normal hasta que exista una caché válida. Si el comando
falla antes de iniciar, revise que las rutas, entornos, autorización de Earth
Engine, credenciales del proveedor y puertos 5000/8765 estén disponibles; el
supervisor nunca imprime valores secretos.

Systemd, usuarios del host, aprovisionamiento e instalación quedan
explícitamente fuera de este flujo local.

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
- La API municipal también acepta nombres de paletas registradas en Matplotlib (por ejemplo, `palette=viridis`), resueltos mediante el registro actual; los colores FHI predeterminados y las URLs de PNG cacheados se conservan.

### Estaciones hidrológicas locales

- **San Pedro — SPTTB** (lat 17.79°, lon −91.16°): estación del río San Pedro, Balancán.
- **Boca del Cerro — BDCTB** (lat 17.43°, lon −91.48°): estación del río Usumacinta, Tenosique.
- Los datos se actualizan dinámicamente mediante el servicio daemon de scrapers o se leen desde archivos CSV locales. Se aplica interpolación temporal para huecos de hasta 7 días.
- Sus marcadores aparecen en el mapa cuando no hay animación activa; al pulsar sobre ellos se puede cargar su serie completa (2000–2024).

### Servicio Daemon de Scrapers

El proyecto incluye un módulo para automatizar la obtención de datos locales directamente de los servidores de CONAGUA y SMN:
- **Descargas FTP automáticas**: Se conecta al servidor FTP de CONAGUA (`sih.conagua.gob.mx`) para descargar los datos de nivel de las estaciones configuradas en formato CSV.
- **Planificador de Tareas**: Utiliza `APScheduler` para ejecutar descargas automáticas:
  - Datos de CONAGUA Hidros: Todos los lunes a las 02:00 AM.
  - Datos de CONAGUA Climas: Todos los lunes a las 02:30 AM.
  - Datos del SMN (Stub): Cada hora.
- **Ejecución al inicio (Bootstrap)**: Corre inmediatamente todos los scrapers configurados al iniciar el contenedor para asegurar que los datos estén al día.
- **Escritura Atómica**: Las descargas FTP se guardan de forma atómica para evitar corrupción de datos si la conexión se interrumpe.

### Renderizado seguro de texto en el navegador

Los nombres de estaciones, municipios, identificadores y valores de la leyenda de inundaciones se muestran como datos, nunca como HTML enviado por el servidor. Ambos mapas comparten el renderizador de popups; los iconos y las acciones de pronóstico conservan su comportamiento.

### Exportación de Datos

Para facilitar el análisis fuera de la plataforma, el sistema ofrece:
- **ZIP de Análisis**: Exporta un paquete ZIP con los datos de las series temporales activas en formato CSV, junto a los GIFs de animación y metadatos del análisis.
  Las rutas deben permanecer dentro de `static/gifs/` y terminar en `.gif`; se aceptan `gifs/nombre.gif` y `/static/gifs/nombre.gif`. Rutas con traversal, absolutas, otros archivos y enlaces simbólicos que escapen del directorio devuelven HTTP 400; un GIF permitido ausente devuelve HTTP 404.

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
┌────────────────────────────────────────────────────────────────────────┐
│                               Navegador                                │
│    TypeScript + Leaflet  │  Plotly.js  │  gifuct-js  │  Scalar UI      │
│    (mapa, controles UI, animación frame a frame, documentación API)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                       Backend Flask (Python 3)                         │
│    routes/  →  gee/  →  services/                                       │
└─────────────┬──────────────────────────────────────────┬───────────────┘
              │ earthengine-api                          │ Shared Volume
┌─────────────▼─────────────┐              ┌─────────────▼───────────────┐
│ Google Earth Engine (nube)│              │  Servicio Daemon de Scraper │
│ MODIS · ERA5 · Sentinel-2 │              │  (APScheduler + FTP)        │
└───────────────────────────┘              └─────────────────────────────┘
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

El progreso de generación usa **Server-Sent Events (SSE)** en `/api/gif-progress/<task_id>`. El registro es **local al proceso**: usar un proceso de aplicación con hilos concurrentes permite que la generación y SSE accedan al mismo registro.

| Configuración | Por defecto | Comportamiento |
| --- | --- | --- |
| `SSE_TASK_QUEUE_TIMEOUT_S` | 60 segundos | Espera entre comentarios keep-alive. |
| `SSE_PROGRESS_RETENTION_S` | 3600 segundos, mínimo 1 | El progreso terminado/fallido caduca desde el fin del productor; las tareas activas no caducan. |
| `SSE_MAX_PROGRESS_TASKS` | 1024, mínimo 1 | Desaloja primero registros terminados y luego el más antiguo si todos están activos. |
| `SSE_MAX_PROGRESS_MESSAGES` | 128, mínimo 2 | Descarta progreso antiguo sin bloquear la generación y conserva el par terminal más reciente. |

- Cerrar un stream limpia su cola al terminar, fallar o desconectarse el cliente. Un productor o stream antiguo nunca elimina un registro más nuevo con el mismo ID.
- Se comprueba la caducidad al acceder al registro y en cada ciclo del daemon (`GIF_CLEANUP_INTERVAL_S`). Un ID desalojado/caducado emite el mensaje SSE existente de tarea no encontrada; los streams conectados conservan su cola.
- Varios procesos o réplicas necesitan un backend de progreso compartido; la aplicación no configura ninguno. Un balanceador por sí solo no comparte el registro.

### Arquitectura del frontend

El código TypeScript en `src/ts/` está organizado por responsabilidad:

```
src/ts/
├── main.ts               # Composition root — orquesta inicialización y wiring de módulos
├── apiClient.ts          # Cliente HTTP tipado — todas las peticiones al backend
├── config.ts             # URLs de endpoints, años disponibles, temporadas
├── types.ts              # Interfaces de la API (GifResponse, TimeseriesResponse, etc.)
├── state/
│   └── mapState.ts       # Store de estado global — bbox, modo, variable, series, players
└── modes/
    ├── normalMode.ts     # Lógica del modo normal (generación de GIF + gráfica panel A)
    ├── compareMode.ts     # Lógica del modo comparativa (paneles A/B, sync, mapB)
    └── floodRiskMode.ts  # Lógica del modo riesgo (overlays FHI por municipio)
```

- **`main.ts`** inicializa el mapa Leaflet, los módulos de modo y el sistema de listeners. No contiene lógica de negocio de ningún modo.
- **`apiClient.ts`** encapsula todos los `fetch()` al backend, incluyendo SSE de progreso y manejo de errores tipados.
- **`mapState.ts`** mantiene el estado de la sesión: bbox seleccionado, modo activo, series temporales cargadas y referencias a los players de animación (GifPlayer, SyncPlayer, SoloPlayer). `GifPlayer` es dueño de las URLs blob de sus frames: recargar libera los frames reemplazados, disponer invalida cargas pendientes y una carga fallida u obsoleta libera sus frames candidatos sin reemplazar la animación actual.
- **`normalMode.ts`** asigna un ciclo de vida a cada generación: respuestas, decodificaciones y callbacks SSE obsoletos no pueden reemplazar ni limpiar el estado más nuevo. Limpiar/reinicializar el modo invalida generaciones pendientes; la animación existente conserva sus recursos hasta que se decodifica correctamente un reemplazo vigente. Las estaciones y los años de los frames usan las fechas calendario UTC de la API, independientemente de la zona horaria del navegador. `normalGeneration.ts` reutiliza esa comprobación de propiedad para informar errores y emitir el evento sin datos `generationComplete`: las finalizaciones obsoletas no desbloquean una solicitud más nueva, incluso si se limpia/cambia el modo entre resolver la promesa y ejecutar su continuación.
- **`compareMode.ts`** administra las generaciones por panel para que A y B terminen independientemente. El progreso compartido pertenece a la última solicitud pendiente; limpiar un panel o salir/reinicializar la comparación invalida trabajo obsoleto. Las decodificaciones fallidas/obsoletas liberan sus candidatos sin reemplazar los frames vigentes, y los callbacks tardíos de sincronización de B no restauran el estado limpiado.
- **`modes/*.ts`** contienen el comportamiento específico de cada modo de operación y acceden al estado exclusivamente a través de `mapState`.

---

## Requisitos previos

| Componente | Versión mínima recomendada |
|---|---|
| Python | 3.11 |
| Node.js | 18 |
| npm | 9 |
| uv | Última versión — gestor de paquetes Python recomendado |

**Cuenta de Google Earth Engine:**
- Necesitás una cuenta GEE aprobada y un proyecto de Google Cloud con la API de Earth Engine habilitada.
- Más información: [earthengine.google.com](https://earthengine.google.com/)

**Dependencias Python** (ver `pyproject.toml`):
- Administradas y sincronizadas automáticamente mediante `uv`.

**Dependencias Node** (ver `package.json`):

```
vitest           # tests unitarios e integración (TypeScript)
playwright       # tests E2E en navegador
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

---

### 2. Configurar el entorno virtual y dependencias Python

Recomendamos usar **[uv](https://github.com/astral-sh/uv)** para gestionar el entorno y las dependencias de forma extremadamente veloz.

```bash
# Sincronizar dependencias y crear el entorno virtual automáticamente
uv sync
```

Esto creará un entorno virtual en la carpeta `.venv/` en la raíz del proyecto e instalará todas las dependencias del proyecto y de desarrollo de forma óptima.

Para activar el entorno virtual en tu terminal:

```bash
# Linux / macOS:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate
# Windows (CMD):
.venv\Scripts\activate.bat
```

O podés ejecutar directamente cualquier comando usando `uv run`:
```bash
uv run app.py
```


---

### 3. Configurar variables de entorno

Copiá el archivo `.env.example` a `.env` en la raíz del proyecto y configurá las variables según tus necesidades:

```bash
cp .env.example .env
```

> [!IMPORTANT]
> Debés configurar `GEE_PROJECT` con el ID real de tu proyecto de Google Cloud. Para ver la lista de tus proyectos y obtener el ID correcto, podés ejecutar:
> ```bash
> gcloud projects list
> ```

| Variable de Entorno | Valor por Defecto | Descripción |
|---|---|---|
| `GEE_PROJECT` | `inundaciones-proyecto` | ID del proyecto de Google Cloud con la API de Earth Engine habilitada. |
| `FLASK_DEBUG` | `false` | Activa el modo debug de Flask si se establece en `true`. |
| `CONAGUA_HIDROS_STATIONS` | `BDCTB,SPTTB` | Claves de las estaciones hidrométricas a scrapear (separadas por comas). |
| `CONAGUA_CLIMAS_STATIONS` | *(vacío)* | Claves de las estaciones climatológicas a scrapear (separadas por comas). |
| `MAX_SPAN_DEG` | `8.0` | Extensión espacial máxima permitida en grados para peticiones GEE. |
| `MAX_YEARS_RANGE` | `10.0` | Rango de fechas máximo permitido en años para peticiones GEE. |
| `MAX_SPAN_DEG_S2` | `4.0` | Límite restrictivo en grados para Sentinel-2 (debido a alta resolución). |
| `MAX_TOTAL_PIXELS` | `26000000` | Límite máximo de píxeles para procesamiento GEE. |
| `BASE_PIXELS_PER_FRAME` | `589824` | Tamaño base de píxeles por frame de animación (768x768). |
| `BASE_PIXELS_S2` | `262144` | Tamaño base de píxeles por frame para Sentinel-2 (512x512). |
| `MIN_GIF_DIM` | `256` | Dimensión mínima en píxeles permitida para el GIF generado. |
| `GIF_MAX_AGE_MINUTES` | `60` | Edad máxima en minutos de los GIFs en caché antes de ser eliminados. |
| `GIF_CLEANUP_INTERVAL_S` | `600` | Intervalo del daemon de limpieza en segundos (por defecto 10 minutos). |
| `GEE_MODIS_NDVI` | `MODIS/061/MOD13Q1` | ID del dataset de NDVI en Google Earth Engine. |
| `GEE_ERA5_LAND_DAILY` | `ECMWF/ERA5_LAND/DAILY_AGGR` | ID del dataset de temperatura y humedad del suelo de ERA5-Land. |
| `GEE_CHIRPS_DAILY` | `UCSB-CHG/CHIRPS/DAILY` | ID del dataset de precipitación CHIRPS. |
| `GEE_S2_SR` | `COPERNICUS/S2_SR_HARMONIZED` | ID del dataset de Sentinel-2 SR Harmonized. |
| `RATE_LIMIT_ENABLED` | `true` | Habilita o deshabilita el limitador de peticiones (rate limiter). |
| `RATE_LIMIT_GIF` | `30/minute` | Cada endpoint GIF, por IP. |
| `RATE_LIMIT_TIMESERIES` | `60/minute` | Cada endpoint de series, por IP. |
| `RATE_LIMIT_EXPORT` | `10/minute` | Exportaciones ZIP, por IP. |
| `RATE_LIMIT_FLOOD` | `60/minute` | Mapas/detección, independientes por endpoint e IP. |
| `RATE_LIMIT_FLOOD_STATS` | `30/minute` | Estadísticas de inundación, por IP. |
| `RATE_LIMIT_STATION` | `60/minute` | Cada endpoint de estaciones, por IP. |
| `RATE_LIMIT_FORECAST` | `60/minute` | Proxy de pronóstico, por IP. |

Los límites `MAX_SPAN_DEG`, `MAX_YEARS_RANGE` y `MAX_SPAN_DEG_S2` deben ser números finitos positivos (se permiten fracciones). Valores vacíos, malformados, cero, negativos, NaN o infinitos impiden el arranque con `<ENV_KEY> must be a finite number greater than zero.`, sin mostrar el valor. Los valores predeterminados siguen siendo 8°, 10 años y 4°, respectivamente.

La página HTML incorpora solo estos tres límites numéricos como JSON antes de cargar los módulos del cliente. El dibujo de áreas usa la extensión configurada y conserva la exportación `MAX_SPAN_DEG`; un contexto ausente o malformado usa los valores predeterminados. Los pedidos normales y de comparación verifican la extensión y el rango de años UTC antes de cambiar la animación o el progreso. La detección de inundaciones verifica `MAX_SPAN_DEG_S2` para ambos satélites antes de limpiar capas o deshabilitar el botón. Los pedidos rechazados conservan la vista y no envían solicitudes HTTP/SSE. La validación del servidor sigue siendo la autoridad; recargá la página después de cambiar la configuración.

Las cuotas usan la notación de Flask-Limiter (por ejemplo, `1/minute` o `10/minute;100/hour`). Todos los conteos deben ser positivos. Valores vacíos o inválidos impiden el arranque con `<ENV_KEY> must specify positive request rates.`, sin mostrar el valor, incluso con el limitador desactivado. Las cuotas son independientes por endpoint/IP, locales al proceso y cuentan también solicitudes HTTP rechazadas. Exceder la cuota devuelve el JSON HTTP 429 existente con `Cache-Control: no-store`.
| `RATE_LIMIT_GIF` | `30/minute` | Límite de peticiones para generación de GIFs. |
| `RATE_LIMIT_TIMESERIES` | `60/minute` | Límite de peticiones para descarga de series temporales. |
| `RATE_LIMIT_EXPORT` | `10/minute` | Límite de peticiones para exportación de ZIPs. |
| `RATE_LIMIT_FLOOD` | `60/minute` | Límite de peticiones para mapas de riesgo. |
| `RATE_LIMIT_STATION` | `60/minute` | Límite de peticiones para datos de estaciones locales. |
| `GIF_DOWNLOAD_TIMEOUT_S` | `120` | Timeout para la descarga de GIFs desde Earth Engine. |
| `SSE_TASK_QUEUE_TIMEOUT_S` | `60` | Timeout de la cola SSE para el canal de progreso. |
| `SSE_WAIT_ATTEMPTS` | `100` | Intentos de espera para registrar la cola en el progress endpoint. |

---

### 4. Autenticar Google Earth Engine

```bash
earthengine authenticate
```

Seguí las instrucciones en pantalla. Tras autenticarte, verificá que funcione:

```bash
python -c "import ee; ee.Initialize(); print('GEE OK')"
```

Editá `.env` o `config.py` y configurá el nombre de tu proyecto de Google Cloud (`GEE_PROJECT`).

> **¿No tenés proyecto GEE?** Ve a [console.cloud.google.com](https://console.cloud.google.com), creá un proyecto, habilitá la API *Earth Engine* y anotá el ID del proyecto.

---

### 5. Datos de estaciones locales

Los archivos `SPTTB.csv` y `BDCTB.csv` deben estar en la carpeta `data/stations/`. El formato esperado:

```
<línea 1–6: metadatos (se omiten automáticamente)>
Fecha,Nivel(m),...
YYYY-MM-DD,valor,...
```

Si necesitás agregar nuevas estaciones, registralas en `config.py` bajo `LOCAL_STATIONS`.

---

### 6. Verificar datos de riesgo de inundación

Los GeoTIFFs del índice FHI deben estar en `data/mapa_riesgo/municipios/` con el nombre `fhi_<municipio>_100m.tif`. El repositorio ya incluye los 16 municipios de Tabasco.

---

### 7. Instalar dependencias de Node y compilar TypeScript

> [!IMPORTANT]
> Compilar el código TypeScript es **obligatorio** antes de iniciar la aplicación por primera vez. Si no lo hacés, la interfaz se mostrará en blanco con errores 404 al intentar cargar el archivo compilado `main.js`.

```bash
npm install
npm run build:ts
```

Para desarrollo con recompilación automática al guardar:

```bash
npm run watch:ts
```

---

### 8. Ejecutar tests (opcional pero recomendado)

```bash
# Tests unitarios y de integración (Vitest)
npm test

# Tests de unidad con modo watch
npm run test:watch

# Tests E2E: compilar primero; Playwright inicia el frontend renderizado
npm run build:ts
npm run test:e2e

# Tests E2E con interfaz visual
npm run test:e2e:ui
```

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
├── pyproject.toml            # Dependencias y metadata del proyecto Python (gestionado por uv)
├── uv.lock                   # Lockfile de dependencias Python (gestionado por uv)
├── package.json              # Dependencias Node y scripts de compilación TS
├── tsconfig.json             # Configuración del compilador TypeScript
├── openapi.yaml              # Especificación OpenAPI 3.1.0 de la API REST
│
├── tests/                    # Suite de pruebas unitarias, integración (Vitest/pytest) y E2E (Playwright)
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
├── scrapers/                 # Módulo de scrapers automáticos para datos locales
│   ├── base.py               # Clase base abstracta de Scraper
│   ├── conagua.py            # Scraper FTP para estaciones climatológicas e hidrométricas de CONAGUA
│   ├── smn.py                # Scraper stub para datos de SMN
│   └── runner.py             # Daemon planificador de tareas (APScheduler)
│
├── routes/                   # Blueprints Flask — endpoints de la API REST
│   ├── gif_routes.py         # GET /api/<var>-gif-bbox
│   ├── timeseries_routes.py  # GET /api/<var>-timeseries-bbox
│   ├── flood_routes.py       # GET /api/flood-risk-municipio
│   ├── station_routes.py     # GET /api/local-station-level-range
│   ├── progress_routes.py    # GET /api/gif-progress/<task_id>  (SSE)
│   └── export_routes.py      # POST /api/export/bundle
│
├── services/
│   ├── gif_service.py        # Descarga GIF desde GEE, anotación con PIL, caché, limpieza
│   ├── station_service.py    # Lectura y preprocesado de CSV de estaciones locales
│   └── export_service.py     # Generación de exportación ZIP (CSV + GIFs + metadatos)
│
├── data/
│   ├── mapa_riesgo/
│   │   └── municipios/       # GeoTIFFs FHI por municipio (fhi_<municipio>_100m.tif)
│   └── stations/             # Series de nivel locales (descargadas por los scrapers)
│
├── static/                   # Archivos servidos directamente al navegador
│   ├── main.js               # JavaScript compilado desde TypeScript
│   ├── styles.css            # Copia publicada de src/styles/styles.css
│   ├── gifs/                 # GIFs generados (caché temporal, se limpian automáticamente)
│   └── flood_maps/           # PNGs de mapas de riesgo renderizados
│
├── src/styles/              # Estilos fuente (build:ts los copia a static/)
│   └── styles.css            # Hoja de estilos principal fuente
│
├── src/ts/                   # Código fuente TypeScript (se compila a static/)
│   ├── main.ts               # Composition root — orquestador, inicializa módulos y wiring
│   ├── apiClient.ts          # Cliente HTTP tipado — todas las llamadas al backend
│   ├── config.ts             # URLs de endpoints, años disponibles, temporadas, constantes UI
│   ├── types.ts              # Tipos TypeScript e interfaces de la API
│   ├── state/
│   │   └── mapState.ts       # Store de estado global (bbox, modo, variable, series, players)
│   ├── modes/                # Lógica de cada modo de operación
│   │   ├── normalMode.ts     # Modo normal: generación de GIF y gráfica para panel A
│   │   ├── compareMode.ts    # Modo comparativa: paneles A/B, sincronización, mapB
│   │   └── floodRiskMode.ts  # Modo riesgo de inundación: overlays FHI por municipio
│   ├── map/
│   │   └── overlays.ts       # Control de overlays Leaflet y barras de colores (colorbars)
│   ├── ui/
│   │   ├── gifPlayer.ts      # Decodificación y reproducción de GIFs frame a frame
│   │   ├── chart.ts          # Renderizado de gráficas con Plotly
│   │   └── progress.ts       # Indicador de progreso (modal overlay)
│   └── listeners/
│       └── variableListeners.ts  # Factory de listeners para controles de variables
│
└── templates/
    ├── index.html            # Template HTML principal
    └── scalar.html           # Plantilla interactiva de documentación interactiva API (Scalar UI)
```

---

## Endpoints de la API

| Endpoint | Método | Parámetros principales | Respuesta |
|---|---|---|---|
| `GET /api/ndvi-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, ndvi[] }` |
| `GET /api/era5-temp-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, temp[] }` |
| `GET /api/era5-soil-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, soil_pct[] }` |
| `GET /api/imerg-precip-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, precip_mm[] }` |
| `GET /api/water-gif-bbox` | `GET` | `start`, `end`, `bbox`, `task_id` | `{ gifUrl, bbox, dates, water_ha[] }` |
| `GET /api/<var>-timeseries-bbox` | `GET` | `start`, `end`, `bbox` | `{ dates, bbox, <valores>[] }` |
| `GET /api/gif-progress/<task_id>` | `GET` | — | SSE: `{ progress: 0–100, message }` |
| `GET /api/flood-risk-municipio` | `GET` | `muni` | `{ mapUrl, bbox }` |
| `GET /api/local-station-level-range` | `GET` | `station`, `start`, `end` | `{ station, dates, level_m[] }` |
| `POST /api/export/bundle` | `POST` | `gifPaths`, `seriesData`, `bbox`, `metadata` | Archivo ZIP (datos CSV + GIFs + metadatos) |
| `GET /api/docs` | `GET` | — | Interfaz de Scalar UI con la documentación interactiva de la API |
| `GET /api/docs/openapi.yaml` | `GET` | — | Especificación OpenAPI 3.1.0 del sistema en formato YAML |

**Parámetros comunes:**
- `start` / `end`: fechas en formato `YYYY-MM-DD`. Todas las rutas GIF y de series temporales, incluyendo NDVI, también aceptan `year` + `season`; el par explícito completo tiene prioridad, de lo contrario el modo estacional reemplaza el par.
- `bbox`: arreglo JSON `[minLon, minLat, maxLon, maxLat]` en grados decimales (WGS-84). Se exige `minLon < maxLon`, `minLat < maxLat`, lon dentro de `[-180, 180]`, lat dentro de `[-90, 90]` y valores finitos; lo contrario se rechaza con 400.
- `ratio`: relación ancho/alto del GIF; debe ser un número positivo y finito.
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

### Stack de testing

La aplicación cuenta con un stack de testing bipartito:

**Vitest** — tests unitarios y de integración en TypeScript:
Los tests importan directamente el TypeScript fuente y funcionan sin JavaScript generado en `static/`. La aplicación sigue necesitando la compilación para servirse.
```bash
npm test              # todos los tests
npm run test:watch   # modo watch (reacciona a cambios)
```

**Playwright** — tests E2E en navegador real:
```bash
npm run build:ts
npm run test:e2e
# O con interfaz visual (para debug):
npm run test:e2e:ui
```

El runner inicia `tests/e2e/server.py --port 8080` en loopback, renderiza Jinja y los límites validados sin importar proveedores de la aplicación. Las APIs responden HTTP 503 salvo que la prueba las simule en el navegador. Las dependencias CDN siguen necesitando red. Nunca se reutiliza silenciosamente un servidor existente.

Para un navegador portable compatible ya preparado, usá `PLAYWRIGHT_EXECUTABLE_PATH=/ruta/absoluta/a/chromium npm run test:e2e`, o la instalación Chromium predeterminada de Playwright. Para un servidor en ejecución elegido explícitamente: `BASE_URL=http://127.0.0.1:5000 SKIP_WEB_SERVER=1 npm run test:e2e`; esto abandona el límite de APIs sintéticas.

Los tests E2E verifican que ningún flujo de usuario dispara `window.alert` sin reemplazarlo por feedback accesible.

### Comandos de calidad

Además del stack de testing, el proyecto ahora incluye comandos de calidad para Python y TypeScript. 

**Python** — coverage, lint y format check con `pytest-cov` y Ruff. Al usar `uv sync`, las dependencias de desarrollo ya están instaladas en el entorno.

```bash
# Ejecutar los scripts a través de uv run:
uv run scripts/python/quality/coverage.sh  # Ejecuta pytest con coverage
uv run scripts/python/quality/lint.sh      # Ejecuta ruff check
uv run scripts/python/quality/format.sh    # Ejecuta ruff format --check
```

Notas:
- Estos comandos están pensados como **guardrails** iniciales: reportan baseline, no corrigen el repo automáticamente.
- La primera pasada excluye `static/`, `scripts/` y tests Python para evitar ruido de revisión.
- Si usás `uv run`, `uv` se asegura de que el entorno esté levantado correctamente antes de correr el script.

**TypeScript** — lint y format check con ESLint + Prettier:

```bash
npm run lint:ts      # Ejecuta ESLint sobre src/ts y tests TS permitidos
npm run format:ts    # Ejecuta Prettier en modo check
npm run quality:ts   # Corre lint + format check
```

Notas:
- La configuración excluye `static/` y otros artefactos generados para no mezclar código fuente con build output.
- Esta etapa no hace auto-fix ni reformateo masivo; primero expone la baseline del proyecto.

### Límites de la API de Google Earth Engine

- **Rango de fechas máximo por petición:** 10 años.
- **Tamaño máximo del bounding box:** 8°×8° para todas las variables excepto Sentinel-2, que se limita a 4°×4° debido a su resolución de 10 m.
- **Píxeles máximos totales:** 26,000,000 (el sistema ajusta automáticamente las dimensiones del GIF).
- El tiempo de respuesta de GEE varía entre 15 segundos y varios minutos dependiendo del tamaño de la región, la variable y el período.

### Caché de GIFs

Los GIFs generados se almacenan en `static/gifs/` con el nombre `<variable>_<start>_<end>_<hash>.gif`. Se eliminan automáticamente cuando superan los **60 minutos de antigüedad** (configurable en `config.py` mediante `GIF_MAX_AGE_MINUTES`).

### Despliegue en producción

Importar `app` construye las rutas Flask sin iniciar Earth Engine, crear directorios de ejecución ni lanzar la limpieza de GIFs. `uv run distribution-map` y `python app.py` inicializan antes de servir; WSGI `app:app` inicializa en la primera solicitud. `initialize_runtime()` es local al proceso y seguro entre hilos: llamadas repetidas no duplican la limpieza, y un fallo de EE impide iniciarla. El preflight de dependencias nunca inicia el runtime.

Los tests sintéticos usan `app.config["INITIALIZE_RUNTIME"] = False` para desactivar el arranque por solicitud. Las llamadas explícitas al inicializador siguen necesitando proveedores simulados y archivos aislados.

Para un entorno de producción se recomienda:

```bash
pip install gunicorn
gunicorn --workers 1 --threads 4 -b 0.0.0.0:8000 app:app
```

Mantener un worker para el registro SSE local al proceso; los hilos permiten atender SSE mientras se genera el GIF. No escalar este comando a varios workers/réplicas sin implementar antes un backend de progreso compartido. Configurar los timeouts del servidor/proxy para solicitudes de generación que pueden tardar varios minutos.

Junto con un servidor proxy inverso (Nginx o Apache) que sirva los archivos estáticos directamente.

---

## Notas de diseño

La reorganización del código frontend siguió un ciclo de **Spec-Driven Development (SDD)**. El archivo `main.ts`, que originalmente contenía toda la lógica de aplicación (~1334 líneas), se dividió en módulos con responsabilidades claras:

- **`main.ts`** actúa como *composition root*: solo inicializa los módulos, mantiene referencias DOM de infraestructura y delega todo comportamiento de negocio a los módulos de modo.

- **`apiClient.ts`** centraliza el acceso HTTP al backend Flask, tipando todas las respuestas y absorbiendo el manejo de errores y SSE.

- **`state/mapState.ts`** provee un store de estado mutable tipado con funciones de lectura/escritura para bbox, modo de operación, variables, series temporales, players de animación y overlays de mapa.

- **`modes/`** encapsula la lógica de cada modo de operación (`normalMode`, `compareMode`, `floodRiskMode`) de forma que agregar un nuevo modo no requiere modificar `main.ts`, solo crear un nuevo archivo en este directorio.

El refactor no cambió el comportamiento visible de la aplicación ni los contratos de la API con el backend.

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
