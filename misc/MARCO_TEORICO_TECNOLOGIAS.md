# Marco Teórico - Herramientas y Tecnologías del Proyecto

## 1. Lenguajes de Programación

### 1.1 Python
- **Versión**: Python 3.x
- **Uso**: Backend del servidor web, procesamiento de datos geoespaciales, integración con Google Earth Engine
- **Características utilizadas**:
  - Tipado estático con `typing` (Optional, list)
  - Manejo de archivos y rutas con `os`
  - Procesamiento JSON con `json`
  - Operaciones matemáticas con `math`

### 1.2 TypeScript
- **Versión**: 5.9.3
- **Uso**: Desarrollo del frontend con tipado estático
- **Configuración**: Compilación a ES2019, módulos ESNext
- **Características**: Tipado estricto, source maps, declaraciones de tipos

### 1.3 JavaScript
- **Versión**: ES2019 (compilado desde TypeScript)
- **Uso**: Código cliente ejecutado en el navegador
- **Características**: Módulos ES6, async/await, Fetch API

### 1.4 HTML5
- **Uso**: Estructura de la interfaz web
- **Características**: Semántica HTML5, accesibilidad (ARIA), meta tags responsive

### 1.5 CSS3
- **Uso**: Estilos y diseño de la interfaz
- **Características**: 
  - CSS Grid Layout
  - CSS Variables (custom properties)
  - Flexbox
  - Transiciones y animaciones
  - Media queries para responsive design
  - Color schemes (light/dark)

## 2. Frameworks y Librerías Backend

### 2.1 Flask
- **Versión**: Última estable
- **Uso**: Framework web minimalista para Python
- **Características utilizadas**:
  - Routing de URLs
  - Renderizado de plantillas (Jinja2)
  - Manejo de peticiones HTTP (GET)
  - Servicio de archivos estáticos
  - Respuestas JSON con `jsonify`
  - Modo debug para desarrollo

### 2.2 Google Earth Engine (earthengine-api)
- **Versión**: Última estable
- **Uso**: Plataforma de procesamiento geoespacial en la nube
- **Características utilizadas**:
  - Inicialización con proyecto de Google Cloud
  - Procesamiento de ImageCollections
  - Filtrado temporal y espacial
  - Generación de GIFs animados (`getVideoThumbURL`)
  - Reducción de regiones (reducers)
  - Visualización con paletas de colores
  - Proyecciones cartográficas (EPSG:3857)

## 3. Librerías Frontend

### 3.1 Leaflet
- **Versión**: 1.9.4
- **Uso**: Biblioteca JavaScript para mapas interactivos
- **Características utilizadas**:
  - Visualización de mapas base (OpenStreetMap)
  - Capas de imágenes (ImageOverlay)
  - Controles de mapa
  - Geometrías (Rectangle, LatLngBounds)
  - Sistema de coordenadas geográficas

### 3.2 Leaflet.draw
- **Versión**: 1.0.4
- **Uso**: Plugin de Leaflet para dibujar formas en el mapa
- **Características utilizadas**:
  - Dibujo de rectángulos (bounding boxes)
  - Edición y eliminación de formas dibujadas
  - FeatureGroup para gestión de capas dibujadas
  - Eventos de creación y edición

### 3.3 Plotly.js
- **Versión**: 2.32.0
- **Uso**: Biblioteca para visualización de datos interactivos
- **Características utilizadas**:
  - Gráficas de líneas temporales (scatter plots)
  - Interactividad (zoom, pan, hover)
  - Responsive design
  - Personalización de ejes y rangos
  - Templates de hover personalizados

## 4. Fuentes de Datos Geoespaciales

### 4.1 MODIS (Moderate Resolution Imaging Spectroradiometer)
- **Colección**: `MODIS/061/MOD13Q1`
- **Uso**: Índice de vegetación NDVI
- **Resolución**: 250m
- **Frecuencia**: 16 días
- **Características**: Datos de vegetación normalizada

### 4.2 ERA5 (ECMWF Reanalysis v5)
- **Colección**: `ECMWF/ERA5/DAILY`
- **Uso**: Datos meteorológicos reanalizados
- **Variables utilizadas**:
  - Temperatura media a 2m (`mean_2m_air_temperature`)
  - Componentes de viento a 10m (`u_component_of_wind_10m`, `v_component_of_wind_10m`)
- **Resolución**: ~28 km
- **Frecuencia**: Diaria
- **Características**: Datos climáticos globales

### 4.3 GPM IMERG (Global Precipitation Measurement)
- **Colección**: `NASA/GPM_L3/IMERG_MONTHLY_V07`
- **Uso**: Datos de precipitación
- **Variable**: `precipitation`
- **Resolución**: 0.1° (~11 km)
- **Frecuencia**: Mensual

### 4.4 MERRA-2 (Modern-Era Retrospective Analysis for Research and Applications)
- **Colección**: `NASA/GSFC/MERRA/slv/2`
- **Uso**: Datos de temperatura
- **Variable**: `T2M` (Temperatura a 2m)
- **Resolución**: ~50 km
- **Características**: Reanálisis atmosférico

### 4.5 AVHRR NDVI (Advanced Very High Resolution Radiometer)
- **Colección**: `NOAA/CDR/AVHRR/NDVI/V5`
- **Uso**: Índice de vegetación histórico
- **Variable**: `NDVI`
- **Características**: Serie temporal de largo plazo

## 5. Herramientas de Desarrollo

### 5.1 Node.js y npm
- **Uso**: Gestión de dependencias de JavaScript/TypeScript
- **Características**: 
  - Instalación de paquetes
  - Scripts de compilación
  - Gestión de versiones

### 5.2 TypeScript Compiler (tsc)
- **Versión**: 5.9.3
- **Uso**: Compilación de TypeScript a JavaScript
- **Características**:
  - Modo watch para desarrollo
  - Generación de source maps
  - Generación de archivos de declaración (.d.ts)
  - Configuración estricta de tipos

### 5.3 @types/leaflet
- **Versión**: 1.9.21
- **Uso**: Definiciones de tipos TypeScript para Leaflet
- **Características**: Soporte de tipos para desarrollo con TypeScript

## 6. Servicios y Plataformas

### 6.1 Google Cloud Platform (GCP)
- **Servicio**: Google Earth Engine
- **Proyecto**: `inundaciones-proyecto`
- **Uso**: Autenticación y acceso a Earth Engine API
- **Características**: Procesamiento en la nube de datos geoespaciales

### 6.2 OpenStreetMap (OSM)
- **Uso**: Capa base de mapas
- **Proveedor**: TileLayer de OpenStreetMap
- **Características**: Mapas de código abierto, zoom máximo 19

### 6.3 CDN (Content Delivery Network)
- **Proveedores utilizados**:
  - unpkg.com (Leaflet, Leaflet.draw)
  - cdn.plot.ly (Plotly.js)
- **Uso**: Distribución de librerías frontend

## 7. Estándares y Protocolos

### 7.1 HTTP/HTTPS
- **Uso**: Comunicación cliente-servidor
- **Métodos**: GET para peticiones de datos
- **Formatos**: JSON para intercambio de datos

### 7.2 JSON (JavaScript Object Notation)
- **Uso**: Formato de datos para API REST
- **Características**: Serialización de bounding boxes, fechas, valores numéricos

### 7.3 Sistema de Coordenadas
- **EPSG:3857** (Web Mercator): Proyección utilizada para visualización de mapas web
- **WGS84** (EPSG:4326): Sistema de coordenadas geográficas para entrada de datos

### 7.4 Formatos de Imagen
- **GIF**: Animaciones temporales de variables geoespaciales
- **PNG/JPEG**: Tiles de mapas base

## 8. Arquitectura y Patrones

### 8.1 Arquitectura Cliente-Servidor
- **Backend**: Flask (Python) - API REST
- **Frontend**: HTML/CSS/JavaScript - Aplicación web SPA-like

### 8.2 API REST
- **Endpoints**:
  - `/api/ndvi-gif-bbox`: Generación de GIF NDVI
  - `/api/ndvi-timeseries-bbox`: Serie temporal NDVI
  - `/api/era5-temp-gif-bbox`: Generación de GIF de temperatura
  - `/api/era5-temp-timeseries-bbox`: Serie temporal de temperatura

### 8.3 Separación de Responsabilidades
- **Backend**: Lógica de negocio, procesamiento de datos, comunicación con Earth Engine
- **Frontend**: Interfaz de usuario, visualización, interacción con el usuario

## 9. Conceptos y Técnicas Aplicadas

### 9.1 Procesamiento de Datos Geoespaciales
- Filtrado temporal (`filterDate`)
- Filtrado espacial (`filterBounds`)
- Reducción de regiones (`reduceRegion`)
- Escalado y normalización de valores
- Aplicación de máscaras para validación de datos

### 9.2 Visualización de Datos
- Paletas de colores personalizadas
- Rangos de visualización (min/max)
- Animaciones temporales (GIF)
- Gráficas de series temporales
- Barras de colores (colorbars) para interpretación

### 9.3 Interfaz de Usuario
- Diseño responsive
- Sidebar colapsable
- Controles de fecha (input type="date")
- Selector de variables
- Validación de entrada del usuario
- Manejo de errores y mensajes de alerta

### 9.4 Optimización
- Control de límites de píxeles de Earth Engine
- Cálculo dinámico de dimensiones de imagen
- Peticiones paralelas (Promise.all)
- Lazy loading de gráficas

## 10. Variables y Métricas Analizadas

### 10.1 NDVI (Normalized Difference Vegetation Index)
- **Rango**: -0.1 a 1.0 (normalizado a 0.0-0.8 para visualización)
- **Interpretación**: 
  - 0.5-0.8: Vegetación densa, salud vegetal alta
  - 0.3-0.5: Vegetación moderada, agricultura
  - 0.2-0.3: Vegetación escasa, pastos secos
  - 0.1-0.2: Poca vegetación, zonas áridas
  - 0.0-0.1: Suelo desnudo, roca, nieve, agua

### 10.2 Temperatura del Aire a 2m
- **Unidad**: Grados Celsius (°C)
- **Conversión**: De Kelvin a Celsius (K - 273.15)
- **Rango de visualización**: 0-35°C
- **Fuente**: ERA5 Daily

## 11. Herramientas de Gestión de Proyecto

### 11.1 Control de Versiones
- **Sistema**: Git (implícito por estructura de proyecto)
- **Archivos de configuración**: `.gitignore` (implícito)

### 11.2 Gestión de Dependencias
- **Python**: `requirements.txt` (archivo presente pero vacío en el proyecto)
- **Node.js**: `package.json`, `package-lock.json`

## 12. Metodologías de Desarrollo

### 12.1 Desarrollo Full-Stack
- Integración de backend Python con frontend JavaScript
- Comunicación asíncrona mediante Fetch API

### 12.2 Programación Orientada a Objetos
- Uso de clases y métodos en librerías (Leaflet, Earth Engine)

### 12.3 Programación Funcional
- Uso de funciones de orden superior (map, filter, reduce)
- Funciones anónimas y arrow functions

### 12.4 Programación Asíncrona
- Uso de async/await para peticiones HTTP
- Manejo de promesas (Promise.all)

## 13. Consideraciones Técnicas

### 13.1 Límites y Restricciones
- Límite de 8 grados por lado para bounding boxes
- Límite de 26,000,000 píxeles totales para animaciones
- Resolución máxima de 768x768 píxeles por frame

### 13.2 Validación de Datos
- Validación de formato de fechas
- Validación de estructura de bounding boxes
- Validación de rangos de valores
- Manejo de casos sin datos disponibles

### 13.3 Accesibilidad
- Uso de atributos ARIA
- Etiquetas semánticas HTML5
- Navegación por teclado (implícita en controles estándar)

---

## Referencias y Documentación

- **Flask**: https://flask.palletsprojects.com/
- **Google Earth Engine**: https://earthengine.google.com/
- **Leaflet**: https://leafletjs.com/
- **Plotly.js**: https://plotly.com/javascript/
- **TypeScript**: https://www.typescriptlang.org/
- **MODIS**: https://modis.gsfc.nasa.gov/
- **ERA5**: https://www.ecmwf.int/en/forecasts/datasets/reanalysis-datasets/era5
- **GPM IMERG**: https://gpm.nasa.gov/data/directory
- **OpenStreetMap**: https://www.openstreetmap.org/
