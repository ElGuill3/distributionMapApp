# Guion Detallado para la Presentación
## Aplicación Web para Visualización de Datos Meteorológicos y de Vegetación

---

## PORTADA (Diapositiva 1)

**Tiempo estimado: 30 segundos**

"Buenos días/tardes. Mi nombre es [Tu nombre] y hoy les presentaré mi proyecto de residencia profesional: 'Aplicación Web para Visualización de Datos Meteorológicos y de Vegetación', que integra Google Earth Engine con Flask y Leaflet."

---

## ÍNDICE (Diapositiva 2)

**Tiempo estimado: 15 segundos**

"La presentación estará estructurada en las siguientes secciones: introducción, problemática, tecnologías utilizadas, funcionalidades, arquitectura, fuentes de datos, interfaz de usuario, resultados, desafíos y trabajo futuro."

---

## SECCIÓN 1: INTRODUCCIÓN

### Diapositiva 3: ¿Qué es el proyecto?

**Tiempo estimado: 1 minuto**

"Como pueden ver en esta captura de pantalla, he desarrollado una aplicación web interactiva que permite visualizar y analizar datos geoespaciales. La aplicación combina tres componentes principales: un mapa interactivo, controles para seleccionar variables y áreas de interés, y visualizaciones tanto animadas como gráficas de series temporales."

"La aplicación está diseñada para ser intuitiva. El usuario puede ver el mapa principal a la derecha, donde se visualizan los datos, y un panel de control a la izquierda donde se configuran los parámetros de análisis."

### Diapositiva 4: Objetivo Principal

**Tiempo estimado: 1 minuto 30 segundos**

"El objetivo principal de este proyecto es desarrollar una plataforma web que permita visualizar y analizar datos meteorológicos y de vegetación mediante la integración de tecnologías de procesamiento geoespacial en la nube."

"Como muestra este diagrama, el flujo es el siguiente: el usuario interactúa con la aplicación web, que se comunica con nuestro backend desarrollado en Flask. Flask a su vez se conecta con Google Earth Engine, que procesa los datos satelitales y genera las visualizaciones. Finalmente, los resultados se muestran al usuario en el navegador."

"Esta arquitectura nos permite aprovechar el poder de procesamiento de Google Earth Engine sin necesidad de descargar o almacenar grandes volúmenes de datos localmente."

---

## SECCIÓN 2: PROBLEMÁTICA

### Diapositiva 5: Necesidad Identificada

**Tiempo estimado: 1 minuto 30 segundos**

"Antes de desarrollar esta solución, identifiqué varias limitaciones en las herramientas existentes para análisis geoespacial."

"Primero, el acceso a datos geoespaciales es limitado. Muchas plataformas requieren suscripciones costosas o tienen restricciones de uso. Segundo, el procesamiento de estos datos es complejo y computacionalmente costoso, requiriendo hardware especializado. Tercero, existe una falta de herramientas integradas que combinen múltiples fuentes de datos en una sola plataforma. Y finalmente, la mayoría de las visualizaciones son estáticas, sin capacidad de generar animaciones temporales fácilmente."

"Nuestra solución aborda todos estos problemas al proporcionar acceso gratuito a datos satelitales, procesamiento en la nube sin necesidad de hardware especializado, integración de múltiples variables en una sola plataforma, y generación automática de animaciones temporales."

---

## SECCIÓN 3: TECNOLOGÍAS UTILIZADAS

### Diapositiva 6: Stack Tecnológico

**Tiempo estimado: 1 minuto**

"El proyecto utiliza un stack tecnológico moderno y robusto. En el backend tenemos Python con Flask como framework web. Para el procesamiento de datos geoespaciales utilizamos Google Earth Engine, que nos da acceso a petabytes de datos satelitales. En el frontend, utilizamos Leaflet para los mapas interactivos, TypeScript para el desarrollo con tipado estático, y HTML5 y CSS3 para la estructura y estilos."

"Cada tecnología fue seleccionada por su capacidad específica: Flask por su simplicidad y flexibilidad, Earth Engine por su poder de procesamiento, Leaflet por su facilidad de uso y extensibilidad, y TypeScript por la seguridad de tipos que proporciona."

### Diapositiva 7: Backend - Flask

**Tiempo estimado: 1 minuto**

"Flask es un framework web minimalista para Python que elegí por su simplicidad y flexibilidad. En nuestro proyecto, Flask actúa como intermediario entre el frontend y Google Earth Engine."

"Las principales funciones que implementé en Flask incluyen: endpoints de API REST para recibir las peticiones del frontend, funciones para construir las consultas a Earth Engine, procesamiento de los parámetros de entrada como fechas y bounding boxes, generación de URLs para los GIFs animados, y cálculo de series temporales mediante reducción de regiones."

"Flask también maneja la validación de datos de entrada, el manejo de errores, y la comunicación asíncrona con Earth Engine."

### Diapositiva 8: Procesamiento - Google Earth Engine

**Tiempo estimado: 1 minuto 30 segundos**

"Google Earth Engine es la tecnología clave que hace posible este proyecto. Es una plataforma de procesamiento geoespacial en la nube que proporciona acceso a más de 40 años de datos satelitales históricos y datos en tiempo casi real."

"Las capacidades que aprovechamos incluyen: acceso a colecciones de imágenes como MODIS y ERA5, filtrado temporal y espacial de datos, procesamiento de grandes volúmenes de datos sin necesidad de descargarlos, generación de animaciones GIF mediante la función getVideoThumbURL, y cálculo de estadísticas espaciales mediante reducción de regiones."

"Lo más importante es que todo este procesamiento ocurre en la nube de Google, lo que significa que no necesitamos servidores potentes ni almacenamiento masivo local."

### Diapositiva 9: Frontend - Leaflet + TypeScript

**Tiempo estimado: 1 minuto 30 segundos**

"En el frontend, Leaflet es la biblioteca que maneja toda la visualización de mapas. Es una biblioteca JavaScript de código abierto, ligera y muy flexible."

"Las funcionalidades que implementé incluyen: visualización de mapas base usando OpenStreetMap, herramientas de dibujo para seleccionar áreas mediante Leaflet.draw, superposición de imágenes GIF animadas sobre el mapa, controles personalizados como barras de colores, y gestión de eventos de usuario."

"TypeScript me permitió desarrollar con tipado estático, lo que redujo significativamente los errores durante el desarrollo. Además, utilicé Plotly.js para generar las gráficas interactivas de series temporales, que permiten zoom, pan y hover con información detallada."

---

## SECCIÓN 4: FUNCIONALIDADES

### Diapositiva 10: Variables Disponibles

**Tiempo estimado: 1 minuto 30 segundos**

"La aplicación actualmente soporta dos variables principales: NDVI y Temperatura a 2 metros."

"NDVI, o Índice de Vegetación Normalizado, es una medida que indica la salud y densidad de la vegetación. Los valores van de -1 a 1, donde valores cercanos a 1 indican vegetación densa y saludable, y valores cercanos a 0 o negativos indican suelo desnudo, agua o áreas sin vegetación. Utilizamos datos del sensor MODIS con resolución de 250 metros y frecuencia de 16 días."

"Para temperatura, utilizamos datos del reanálisis ERA5, que proporciona temperatura del aire a 2 metros sobre el suelo. Estos datos tienen una resolución de aproximadamente 28 kilómetros y están disponibles diariamente. Los datos vienen en Kelvin, pero los convertimos automáticamente a grados Celsius para facilitar la interpretación."

### Diapositiva 11: Flujo de Uso

**Tiempo estimado: 2 minutos**

"El flujo de uso de la aplicación es muy intuitivo y consta de cinco pasos principales."

"Primero, el usuario abre la aplicación y ve el mapa inicial centrado en una región predeterminada, en este caso el sureste de México."

"Segundo, el usuario dibuja un rectángulo en el mapa usando la herramienta de dibujo integrada. El sistema valida automáticamente que el área no exceda los límites permitidos y convierte el rectángulo en un cuadrado para optimizar el procesamiento."

"Tercero, el usuario selecciona la variable que desea analizar - NDVI o Temperatura - y elige las fechas de inicio y fin del período de análisis."

"Cuarto, al hacer clic en el botón 'Generar GIF', la aplicación envía una petición al backend, que consulta Earth Engine, procesa los datos y genera tanto la animación GIF como la serie temporal."

"Quinto, los resultados se muestran simultáneamente: el GIF animado se superpone en el mapa y la gráfica de serie temporal aparece debajo del mapa, permitiendo al usuario ver tanto la evolución espacial como temporal de la variable seleccionada."

### Diapositiva 12: Selección de Área

**Tiempo estimado: 1 minuto**

"La selección de área es una funcionalidad clave de la aplicación. Utilizando Leaflet.draw, el usuario puede dibujar rectángulos directamente en el mapa."

"El sistema implementa varias validaciones: primero, verifica que el área seleccionada no exceda 8 grados por lado, que es un límite establecido por Earth Engine para evitar tiempos de procesamiento excesivos. Segundo, convierte automáticamente el rectángulo dibujado en un cuadrado centrado en el área seleccionada, lo que optimiza el procesamiento y mantiene la relación de aspecto consistente."

"Una vez dibujado el rectángulo, el usuario puede editarlo o eliminarlo antes de generar la visualización, lo que proporciona flexibilidad en la selección del área de interés."

### Diapositiva 13: Generación de Animaciones

**Tiempo estimado: 1 minuto 30 segundos**

"La generación de animaciones GIF es una de las funcionalidades más impresionantes de la aplicación. Cuando el usuario solicita una visualización, el sistema calcula automáticamente las dimensiones óptimas de la imagen basándose en el número de frames disponibles y los límites de píxeles de Earth Engine."

"El proceso incluye: filtrado de la colección de imágenes por fecha y área, escalado y normalización de los valores, aplicación de máscaras para validar los datos, selección de paletas de colores apropiadas - verdes y marrones para NDVI, azules y rojos para temperatura -, y generación del GIF con 2 frames por segundo."

"El resultado es una animación que muestra la evolución temporal de la variable seleccionada en el área de interés, superpuesta directamente en el mapa base."

### Diapositiva 14: Series Temporales

**Tiempo estimado: 1 minuto 30 segundos**

"Además de las animaciones, la aplicación genera automáticamente gráficas de series temporales utilizando Plotly.js. Estas gráficas son completamente interactivas."

"Las características incluyen: capacidad de zoom para examinar períodos específicos, pan para navegar a lo largo del tiempo, hover que muestra valores exactos en cada punto, y diseño responsive que se adapta al tamaño de la pantalla."

"Para NDVI, la gráfica muestra el valor promedio del índice en el área seleccionada a lo largo del tiempo. Para temperatura, muestra la temperatura media en grados Celsius. Esto permite identificar tendencias, estacionalidad y eventos anómalos en los datos."

---

## SECCIÓN 5: ARQUITECTURA

### Diapositiva 15: Arquitectura del Sistema

**Tiempo estimado: 1 minuto 30 segundos**

"La arquitectura del sistema sigue un modelo cliente-servidor con tres componentes principales."

"El cliente es el navegador web del usuario, que ejecuta el código JavaScript compilado desde TypeScript. Este código maneja toda la interacción del usuario, la visualización de mapas y gráficas, y la comunicación con el backend."

"El servidor backend está implementado en Flask y corre en Python. Recibe las peticiones HTTP del cliente, valida los parámetros, construye las consultas a Earth Engine, y devuelve las respuestas en formato JSON."

"Google Earth Engine es el tercer componente, que actúa como servicio de procesamiento. Recibe las consultas del backend, procesa los datos satelitales, y genera los GIFs y cálculos estadísticos."

"Esta arquitectura separa claramente las responsabilidades: el frontend maneja la presentación, el backend maneja la lógica de negocio, y Earth Engine maneja el procesamiento pesado de datos."

### Diapositiva 16: Flujo de Datos

**Tiempo estimado: 2 minutos**

"El flujo de datos es el siguiente: cuando el usuario hace clic en 'Generar GIF', el frontend captura los parámetros - área seleccionada, fechas, y variable - y construye una petición HTTP GET al endpoint correspondiente del backend."

"El backend Flask recibe esta petición y valida los parámetros. Luego construye una consulta a Earth Engine usando la API de Python. Esta consulta incluye: la colección de imágenes a usar - MODIS para NDVI o ERA5 para temperatura -, el filtrado por fecha y área, y las operaciones de procesamiento necesarias."

"Earth Engine procesa la consulta en la nube. Para los GIFs, utiliza la función getVideoThumbURL que genera una URL pública del GIF. Para las series temporales, realiza reducciones de región que calculan el promedio de valores en el área seleccionada para cada fecha."

"Una vez completado el procesamiento, Earth Engine devuelve los resultados al backend, que los formatea en JSON y los envía de vuelta al frontend."

"Finalmente, el frontend recibe la respuesta, extrae la URL del GIF y los datos de la serie temporal, y actualiza la interfaz: muestra el GIF superpuesto en el mapa y genera la gráfica interactiva."

### Diapositiva 17: Endpoints API

**Tiempo estimado: 1 minuto**

"La API REST implementada en Flask expone cuatro endpoints principales."

"Para NDVI, tenemos dos endpoints: '/api/ndvi-gif-bbox' que genera el GIF animado, y '/api/ndvi-timeseries-bbox' que calcula la serie temporal. Ambos reciben los mismos parámetros: start (fecha inicio), end (fecha fin), y bbox (bounding box como JSON array)."

"Para temperatura, tenemos endpoints equivalentes: '/api/era5-temp-gif-bbox' y '/api/era5-temp-timeseries-bbox' con los mismos parámetros."

"Todos los endpoints devuelven respuestas en formato JSON. Los endpoints de GIF devuelven la URL del GIF generado y el bounding box utilizado. Los endpoints de series temporales devuelven arrays de fechas y valores correspondientes."

"Esta estructura de API permite fácil extensión para agregar más variables en el futuro."

---

## SECCIÓN 6: FUENTES DE DATOS

### Diapositiva 18: Datos Satelitales

**Tiempo estimado: 1 minuto 30 segundos**

"La aplicación utiliza dos fuentes principales de datos satelitales."

"Para NDVI, utilizamos el producto MODIS MOD13Q1, que es parte del sistema de sensores MODIS a bordo de los satélites Terra y Aqua de la NASA. Este producto proporciona datos de NDVI con resolución espacial de 250 metros y frecuencia temporal de 16 días. Los datos están disponibles desde el año 2000 hasta la actualidad, lo que permite análisis de largo plazo."

"Para temperatura, utilizamos el reanálisis ERA5 del Centro Europeo de Pronósticos Meteorológicos de Medio Alcance. ERA5 es considerado uno de los reanálisis climáticos más precisos disponibles, con resolución espacial de aproximadamente 28 kilómetros y frecuencia diaria. Los datos están disponibles desde 1940, proporcionando una serie histórica muy extensa."

"Ambas fuentes de datos son accesibles gratuitamente a través de Google Earth Engine, lo que elimina la necesidad de descargar y almacenar terabytes de datos localmente."

---

## SECCIÓN 7: INTERFAZ DE USUARIO

### Diapositiva 19: Diseño de la Interfaz

**Tiempo estimado: 1 minuto**

"El diseño de la interfaz sigue principios de usabilidad y accesibilidad. La aplicación utiliza un layout de dos columnas: un sidebar a la izquierda con todos los controles, y el área principal a la derecha con el mapa y las gráficas."

"El sidebar es colapsable, lo que permite maximizar el espacio del mapa cuando es necesario. Cuando está expandido, muestra claramente el selector de variables, los controles de fecha, y los botones de acción."

"El mapa ocupa la mayor parte del espacio visual, ya que es el componente principal de la aplicación. Las gráficas aparecen debajo del mapa solo cuando hay datos disponibles, manteniendo la interfaz limpia cuando no se ha realizado ningún análisis."

### Diapositiva 20: Características de la UI

**Tiempo estimado: 1 minuto 30 segundos**

"Las características de la interfaz incluyen varios elementos de diseño cuidadosamente implementados."

"El sidebar es completamente colapsable mediante un botón, lo que mejora la experiencia en pantallas pequeñas. El selector de variables permite cambiar fácilmente entre NDVI y temperatura, mostrando u ocultando los controles específicos de cada variable."

"Los controles de fecha utilizan el input type='date' nativo del navegador, que proporciona un calendario visual para seleccionar fechas fácilmente. Los botones de acción tienen un estilo destacado que los hace fácilmente identificables."

"Las barras de colores son controles personalizados que aparecen en el mapa cuando hay una visualización activa. Proporcionan información sobre la escala de colores y los rangos de valores, ayudando a los usuarios a interpretar los datos correctamente."

### Diapositiva 21: Responsive Design

**Tiempo estimado: 1 minuto**

"La aplicación está diseñada para ser responsive, aunque actualmente está optimizada principalmente para pantallas de escritorio. El diseño utiliza CSS Grid y Flexbox para crear layouts flexibles que se adaptan a diferentes tamaños de pantalla."

"En pantallas más pequeñas, el sidebar se puede colapsar completamente para maximizar el espacio del mapa. Las gráficas también se ajustan automáticamente al ancho disponible, manteniendo su interactividad."

"Si bien la aplicación funciona en dispositivos móviles, la experiencia óptima se obtiene en tablets y computadoras de escritorio debido a la naturaleza interactiva de los mapas y las herramientas de dibujo."

---

## SECCIÓN 8: RESULTADOS

### Diapositiva 22: Ejemplo - Análisis NDVI

**Tiempo estimado: 2 minutos**

"Permítanme mostrarles un ejemplo de análisis NDVI. En esta captura podemos ver un análisis completo realizado para una región del sureste de México."

"El GIF animado muestra la evolución del NDVI a lo largo de varios meses. Los colores verdes oscuros indican áreas con vegetación densa y saludable, mientras que los tonos marrones y rojos indican áreas con menos vegetación o suelo desnudo. La animación permite identificar claramente los cambios estacionales y áreas que mantienen vegetación constante versus áreas que experimentan cambios significativos."

"La gráfica de serie temporal muestra el valor promedio de NDVI en el área seleccionada a lo largo del tiempo. Podemos observar la tendencia general, identificar períodos de crecimiento y declive de la vegetación, y detectar eventos anómalos como sequías o cambios abruptos."

"Este tipo de análisis es valioso para aplicaciones agrícolas, monitoreo de ecosistemas, y gestión de recursos naturales."

### Diapositiva 23: Ejemplo - Análisis de Temperatura

**Tiempo estimado: 2 minutos**

"Para el análisis de temperatura, podemos ver cómo la aplicación visualiza datos del reanálisis ERA5."

"El GIF de temperatura muestra la distribución espacial de la temperatura en el área seleccionada. Los colores azules representan temperaturas más bajas, mientras que los rojos y naranjas representan temperaturas más altas. La animación temporal permite observar cómo se mueven las masas de aire y cómo cambian los patrones de temperatura a lo largo del tiempo."

"La gráfica de serie temporal muestra la temperatura media diaria en grados Celsius. Esto permite identificar patrones estacionales, tendencias a largo plazo, y eventos extremos como olas de calor o períodos fríos."

"Este análisis es útil para estudios climáticos, planificación agrícola basada en condiciones térmicas, y análisis de impacto del cambio climático."

### Diapositiva 24: Casos de Uso Potenciales

**Tiempo estimado: 1 minuto 30 segundos**

"La aplicación tiene múltiples casos de uso potenciales en diferentes sectores."

"En agricultura, los agricultores pueden monitorear la salud de sus cultivos mediante NDVI, identificar áreas que necesitan atención, y planificar el riego basándose en datos de temperatura y precipitación."

"En gestión ambiental, los investigadores pueden analizar cambios en la vegetación a lo largo del tiempo, identificar áreas de degradación, y monitorear la recuperación de ecosistemas después de eventos como incendios o sequías."

"En investigación climática, los científicos pueden analizar tendencias de temperatura, correlacionar variables climáticas, y estudiar patrones espaciales y temporales de fenómenos meteorológicos."

"En planificación urbana, los planificadores pueden analizar el impacto de la urbanización en la vegetación, estudiar islas de calor urbano mediante datos de temperatura, y planificar espacios verdes basándose en datos objetivos."

---

## SECCIÓN 9: DESAFÍOS Y SOLUCIONES

### Diapositiva 25: Desafíos Enfrentados

**Tiempo estimado: 1 minuto 30 segundos**

"Durante el desarrollo del proyecto, enfrenté varios desafíos técnicos importantes."

"El primer desafío fueron los límites de procesamiento de Earth Engine. La plataforma tiene límites estrictos en el número total de píxeles que se pueden procesar en una sola solicitud, especialmente para animaciones. Esto requería calcular cuidadosamente las dimensiones de las imágenes para no exceder estos límites."

"El segundo desafío fue la optimización de la resolución de imágenes. Necesitaba balancear entre calidad visual y tiempo de procesamiento, especialmente cuando se generan animaciones con muchos frames."

"El tercer desafío fue el manejo de grandes volúmenes de datos. Aunque Earth Engine maneja el almacenamiento, necesitaba optimizar las consultas para que fueran eficientes y rápidas."

"Finalmente, la validación de entrada del usuario fue crucial para prevenir errores y proporcionar retroalimentación clara cuando los parámetros no eran válidos."

### Diapositiva 26: Soluciones Implementadas

**Tiempo estimado: 1 minuto 30 segundos**

"Para abordar estos desafíos, implementé varias soluciones técnicas."

"Para los límites de procesamiento, desarrollé un algoritmo que calcula dinámicamente las dimensiones óptimas de las imágenes basándose en el número de frames disponibles y el límite total de píxeles. El sistema divide el límite total entre el número de frames para determinar la resolución máxima por frame, asegurando que nunca se excedan los límites."

"Para la optimización de resolución, implementé un sistema que ajusta automáticamente las dimensiones basándose en el tamaño del área seleccionada y el número de frames, manteniendo siempre una resolución mínima de 256x256 píxeles para garantizar calidad visual."

"Para el manejo eficiente de datos, optimicé las consultas a Earth Engine utilizando filtros tempranos, selección específica de bandas necesarias, y uso eficiente de reducciones de región. También implementé procesamiento asíncrono para que las peticiones de GIF y serie temporal se ejecuten en paralelo."

"Para la validación, implementé validaciones tanto en el frontend como en el backend. El frontend valida el tamaño del bounding box antes de enviar la petición, y el backend valida todos los parámetros y proporciona mensajes de error claros y específicos."

---

## SECCIÓN 10: TRABAJO FUTURO

### Diapositiva 27: Mejoras Planificadas

**Tiempo estimado: 1 minuto 30 segundos**

"Aunque la aplicación está funcional, hay varias mejoras que planeo implementar en el futuro."

"Primero, agregar más variables meteorológicas como precipitación, velocidad del viento, humedad, y presión atmosférica. Esto ampliaría significativamente las capacidades de análisis de la aplicación."

"Segundo, implementar funcionalidades de exportación de datos. Los usuarios podrían descargar los datos de las series temporales en formatos como CSV o JSON, y exportar las imágenes GIF o frames individuales."

"Tercero, agregar capacidad de comparación de períodos. Los usuarios podrían comparar el mismo período en diferentes años, o diferentes períodos en el mismo año, lo que sería muy útil para análisis de tendencias."

"Cuarto, implementar análisis estadísticos avanzados como cálculo de promedios, desviaciones estándar, valores máximos y mínimos, y detección de anomalías."

"Finalmente, mejorar la interfaz de usuario con más opciones de personalización, como selección de paletas de colores, ajuste de rangos de visualización, y más opciones de visualización."

---

## CONCLUSIÓN

### Diapositiva 28: Logros Alcanzados

**Tiempo estimado: 1 minuto 30 segundos**

"En resumen, he logrado desarrollar una plataforma web completamente funcional que integra exitosamente múltiples tecnologías modernas."

"La aplicación proporciona acceso fácil a datos satelitales que de otra manera serían difíciles de obtener y procesar. La integración con Google Earth Engine permite aprovechar el poder de procesamiento en la nube sin necesidad de infraestructura costosa."

"La visualización interactiva de datos, tanto en forma de animaciones como de gráficas, proporciona una forma intuitiva de analizar información geoespacial compleja."

"La interfaz de usuario es intuitiva y accesible, permitiendo que usuarios sin conocimientos técnicos avanzados puedan realizar análisis geoespaciales complejos."

"El proyecto demuestra cómo las tecnologías web modernas pueden ser utilizadas para crear herramientas poderosas de análisis científico que son accesibles y fáciles de usar."

### Diapositiva 29: Impacto y Aplicaciones

**Tiempo estimado: 1 minuto**

"El impacto potencial de esta aplicación es significativo. Al proporcionar acceso fácil a datos satelitales y herramientas de análisis, la aplicación puede ser utilizada por investigadores, estudiantes, agricultores, planificadores urbanos, y gestores ambientales."

"Las aplicaciones prácticas incluyen monitoreo agrícola, gestión de recursos naturales, investigación climática, planificación urbana, y educación ambiental."

"La naturaleza web de la aplicación significa que está disponible para cualquier persona con acceso a internet, eliminando barreras de acceso a herramientas de análisis geoespacial."

"El código está estructurado de manera que facilita la extensión y mejora continua, permitiendo agregar nuevas funcionalidades y variables en el futuro."

---

## PREGUNTAS (Diapositiva 30)

**Tiempo estimado: Variable**

"Muchas gracias por su atención. Estoy abierto a responder cualquier pregunta que tengan sobre el proyecto, las tecnologías utilizadas, los desafíos enfrentados, o las aplicaciones potenciales."

---

## NOTAS ADICIONALES PARA LA PRESENTACIÓN

### Consejos de Presentación:

1. **Ritmo**: Mantén un ritmo constante, pero no tengas miedo de pausar para enfatizar puntos importantes.

2. **Contacto visual**: Mantén contacto visual con la audiencia, no solo mires las diapositivas.

3. **Gestos**: Usa gestos naturales para señalar elementos en las imágenes cuando sea relevante.

4. **Pausas**: Usa pausas estratégicas después de puntos importantes para dar tiempo a la audiencia de procesar la información.

5. **Tono**: Mantén un tono profesional pero entusiasta. Tu pasión por el proyecto debe ser evidente.

6. **Preparación**: Practica la presentación varias veces antes del día real. Esto te ayudará a sentirte más cómodo y a ajustar el tiempo.

7. **Backup**: Ten un plan de respaldo en caso de problemas técnicos. Considera tener capturas de pantalla adicionales o una versión simplificada de la presentación.

8. **Demostración en vivo**: Si es posible, considera hacer una demostración en vivo de la aplicación funcionando. Esto siempre impresiona más que solo mostrar capturas de pantalla.

### Tiempo Total Estimado:

- Presentación completa: aproximadamente 25-30 minutos
- Con preguntas: 35-40 minutos
- Ajusta el tiempo según las necesidades de tu presentación
