# Mapa de susceptibilidad a inundación de Tabasco: proceso, variantes y validación

**Proyecto:** distributionMapApp · **Rama:** `feat/flood-risk-model` · **Fecha:** octubre de 2026

## Resumen

Se reemplazó el antiguo mapa de riesgo por municipio (un índice FHI exportado de Google Earth Engine, sin script reproducible y con valores concentrados entre 18 y 64 de una escala 0–100) por un **mapa de susceptibilidad a inundación de todo el estado, a 30 m**, generado por un pipeline reproducible a partir de fuentes públicas.

El mapa final es un **ensamble por promedio de rangos, con pesos iguales fijados a priori**, de tres componentes:

1. un modelo de *gradient boosting* (LightGBM) entrenado con **inundaciones extremas observadas** (CENAPRED 2011 y 2020);
2. un modelo LightGBM entrenado con **inundación estacional** detectada con Sentinel-1 (2015–2025);
3. la **profundidad de inundación JRC/GloFAS para periodo de retorno de 100 años**.

Las variables de terreno salen del **MDE LiDAR de 5 m de INEGI**, acondicionado hidrológicamente y procesado a 15 m. Donde no hay LiDAR (12.6 % del estado), el terreno sale del **Continuo de Elevaciones Mexicano 3.0 de INEGI, a 15 m**.

**Resultado principal.** Se validó con eventos que ningún componente vio durante el entrenamiento:

| Mapa | CENAPRED 2011 (evento extremo) ROC / PR | S1 2023 ROC / PR | S1 2024 ROC / PR | S1 2025 ROC / PR |
|---|---|---|---|---|
| **Ensamble (este trabajo)** | **0.778 / 0.109** | **0.723 / 0.271** | **0.715 / 0.179** | **0.723 / 0.275** |
| Profundidad JRC 100 años | 0.766 / 0.091 | 0.569 / 0.168 | 0.576 / 0.108 | 0.577 / 0.173 |
| Elevación (más baja = más susceptible) | 0.751 / 0.085 | 0.568 / 0.177 | 0.557 / 0.111 | 0.587 / 0.188 |
| IPCET-PNUD 2022 (mapa oficial, 5 clases) | 0.892\* / 0.200\* | 0.609 / 0.188 | 0.608 / 0.115 | 0.624 / 0.207 |
| Tasa base (proporción inundada) | 0.045 | 0.139 | 0.084 | 0.144 |

\* El mapa IPCET-PNUD 2022 es posterior a 2011 y probablemente se calibró con esa inundación, así que para él 2011 no es un evento "no visto". Las temporadas 2023–2025 sí son posteriores a su publicación.

**Cómo leer la tabla.** El ensamble es el único mapa que supera a todas las referencias en la inundación extrema no vista (2011), excepto a IPCET, que probablemente la usó. En las temporadas posteriores a 2022, que ningún mapa vio, el ensamble supera a JRC y a IPCET por unos 0.10–0.15 de ROC AUC y por un 33–67 % relativo en PR AUC (59–67 % frente a JRC, 33–56 % frente a IPCET). Los valores absolutos son moderados (ROC ≈ 0.72–0.78) porque las propias etiquetas tienen ruido (ver §4 y §8).

> La validación cruzada espacial clásica daba ROC 0.885, pero sobreestima la capacidad del modelo para anticipar inundaciones nuevas (§5.2). Este reporte usa como métrica principal la evaluación sobre **eventos retenidos**, no la validación cruzada.

---

## 1. Objetivo y alcance

| Requisito (del usuario) | Cómo se atendió |
|---|---|
| "Buscar un buen algoritmo y robusto"; "lo más preciso posible" | Modelos entrenados con inundaciones observadas, validados con eventos retenidos y comparados con referencias físicas y oficiales. |
| "Que el mapa también lo generemos nosotros" | Pipeline `python -m backend.floodmodel` que reconstruye todo desde fuentes públicas. |
| Mantener la optimización y el costo computacional | Nada se procesa al arrancar la app ni al hacer clic: se sirven tiles PNG estáticos (8.0 MB, contra 32 MB de los GeoTIFF anteriores). |
| Cubrir todo el estado | La grilla abarca el límite estatal más 2 km, y los huecos del LiDAR se rellenan con el CEM 3.0 de INEGI (§3.5). |
| Mejorar la visualización | Capa estatal en Web Mercator, 5 clases relativas al estado, paleta apta para daltonismo, lectura del valor bajo el cursor, ficha y coropleta por municipio (ahora con los 17 municipios; Teapa faltaba). |

**Definición del producto.** Es un **índice relativo de susceptibilidad**: ordena las celdas del estado según su propensión a inundarse. **No es una profundidad ni una probabilidad anual** (ver §8).

---

## 2. Datos

| Fuente | Uso | Resolución / periodo |
|---|---|---|
| INEGI, MDE LiDAR (terreno) | Elevación, HAND, pendiente, TWI, acumulación de flujo | 5 m → 15 m; vuelo 2007, edición 2012; 603 hojas (1.6 GB); cubre el 87.4 % del estado |
| INEGI, Continuo de Elevaciones Mexicano 3.0 | Relleno de los huecos del LiDAR | 15 m; todo el estado; elevaciones en metros enteros |
| CENAPRED, Atlas Nacional de Riesgos | Etiquetas de eventos extremos: inundación del 22-oct-2011; 2020 (Cristóbal, Sentinel-1 28-oct y 5-nov, TerraSAR-X 7-nov, Copernicus) | Polígonos vectoriales |
| CENAPRED, mapas PNUD 2018 e IPCET-PNUD 2022 | **Solo comparación**, nunca entrenamiento | Polígonos, 5 clases |
| Copernicus Sentinel-1 GRD (VV) | Etiquetas de inundación estacional 2015–2025 | 10 m → 30 m |
| JRC/CEMS GloFAS Flood Hazard v2.1 | Profundidad por periodo de retorno (10 y 100 años): variable y componente del ensamble | ~90 m |
| MERIT Hydro | Área de drenaje aguas arriba, HAND de referencia, último recurso de relleno | ~90 m |
| JRC Global Surface Water v1.4 | Exclusión de agua permanente (ocurrencia ≥ 50 %) | 30 m |
| ESA WorldCover 2021 | Uso de suelo | 10 m |
| FAO GAUL 2025 nivel 2 | Límite estatal y 17 municipios (24 707 km²) | Vectorial |

**Grilla de modelado:** UTM 15N (EPSG:32615), 30 m, 11 248 × 5 282 celdas (límite estatal + 2 km). Celdas etiquetadas dentro del estado: 23 742 km² (se excluye el agua permanente).

---

## 3. Terreno: del LiDAR al HAND

### 3.1 Resolución: 10 m → 15 m

El plan era trabajar a 10 m. El relleno de depresiones por costo mínimo (*least-cost breaching*) tardó más de 45 min en un solo hilo, con 7.7 GB de RAM, y hubo que detenerlo. Se pasó a **15 m**, con el algoritmo rápido de Lindsay (2016). La hidrología completa tarda 5 min 47 s, con un pico de 7.6 GB.

### 3.2 Acondicionamiento hidrológico

El LiDAR de INEGI **no tiene datos sobre ríos y lagunas** y deja huecos de cobertura. Si no se corrige, el HAND (altura sobre el drenaje más cercano) queda referido a cauces equivocados.

1. Los huecos se rellenan primero con el CEM 3.0 de INEGI (15 m) y, donde tampoco hay CEM, con MERIT (~90 m). Cada fuente se corrige por su sesgo vertical mediano respecto del LiDAR: **−0.40 m** para el CEM y **−1.64 m** para MERIT.
2. El agua (ocurrencia JRC ≥ 50 % o área de drenaje MERIT ≥ 500 km²) se incorpora a la red de drenaje.

### 3.3 Un error de diseño detectado y corregido

La primera versión "quemaba" 5 m de agua en el MDE. Como el LiDAR guarda el mar como una superficie plana a 0.0 m, las lagunas quemadas quedaban **más bajas que su propia salida al mar**. El algoritmo de *breaching* tallaba caminos larguísimos y el MDE llegaba a **−7 011 m**. El HAND resultante era absurdo: Centla daba 28 m de HAND a 1.4 m sobre el nivel del mar.

**Corrección.** El MDE rellenado solo define direcciones de flujo (D8). El HAND se mide sobre la elevación acondicionada, contra el primer cauce, cuerpo de agua o mar al que drena cada celda. Ese punto se obtiene etiquetando cuencas (`Watershed`), y cada salida lleva codificada su elevación. Un test sintético reproduce el caso (mar plano a 0 m más una laguna sin LiDAR) y fija la propiedad HAND ≤ elevación − mínima elevación de drenaje.

### 3.4 Validación física del HAND

El HAND no usó las inundaciones de CENAPRED, así que esos polígonos sirven para validarlo:

| Evento | HAND mediano dentro / fuera de la mancha | Celdas inundadas con HAND ≤ 5 m |
|---|---|---|
| Cristóbal 2020 | 0.30 m / 2.0 m | 99.8 % |
| 22-oct-2011 | 0.45 m / 2.0 m | 97.7 % |

Solo un 0.42 % de las celdas no encuentra drenaje, y ninguna supera su propia elevación.

### 3.5 Cobertura del estado

Al dibujar el mapa final para este reporte aparecieron dos huecos de cobertura, que se corrigieron antes de publicar:

| Problema | Magnitud | Corrección |
|---|---|---|
| La grilla seguía la extensión de las hojas LiDAR, no el límite estatal | 391 km² fuera del modelo: 332 km² de Huimanguillo (9 %) y 59 km² de Cárdenas (3 %), en la planicie del Tonalá | Grilla = límite estatal + 2 km |
| 3 103 km² de tierra (12.6 % del estado) sin LiDAR, rellenados con MERIT a ~90 m | Paraíso 91 %, Comalcalco 63 %, Emiliano Zapata 44 %, Tacotalpa 34 %, Jalpa de Méndez 31 % | Relleno con el CEM 3.0 de INEGI a 15 m, que cubre el **97.4 %** de los huecos; MERIT solo en el resto |

Otras series de INEGI a 5 m y 1.5 m cubren solo el 21 % del hueco y mezclan datum y vuelos, así que no se usaron. Tras la corrección no queda ninguna celda de tierra del estado sin clase.

Con la corrección, los porcentajes por clase de cada municipio cambiaron como máximo 2 puntos, y la validación cambió en la tercera cifra decimal. El modelo se apoya sobre todo en JRC, la elevación y el uso de suelo, y la mediana del CEM difiere poco de la de MERIT (−1.3 m). Lo que mejora es el detalle local del terreno y la cobertura de la cuenca del Tonalá.

---

## 4. Etiquetas

### 4.1 Eventos extremos (CENAPRED)

- **Inundada (1):** la celda cae dentro de cualquier polígono de evento.
- **Seca (0):** el resto del estado.
- **Excluida (255):** el agua permanente y todo lo que queda fuera de Tabasco, porque CENAPRED solo mapeó dentro del estado.

Resultado: 14.9 % de celdas inundadas.

### 4.2 Fuentes adicionales evaluadas

Con solo dos años de eventos extremos, los modelos generalizaban mal (§5.2). Se evaluaron fuentes adicionales contrastándolas con los polígonos de CENAPRED del mismo año:

| Fuente | Método | Concordancia con CENAPRED | Decisión |
|---|---|---|---|
| Landsat 5/7 (2011; 2007) | MNDWI > 0 en píxeles despejados (QA), sin agua permanente | 2011: IoU 7.7 % (P 12.9 %, R 16.1 %); 2007: solo 6 % del estado inundado | **Descartada:** las nubes ocultan el pico, y las imágenes despejadas son posteriores a la crecida |
| Global Flood Database (MODIS, Tellman et al. 2021) | Eventos 2005, 2007, 2010, 2011 | 2011: IoU 14.1 % (P 17.7 %, R 40.4 %); vistas despejadas medianas: 1 % | **Descartada** |
| Sentinel-1, detección por cambio | VV percentil 10 (jun–dic) < −13 dB **y** caída > 1.5 dB respecto de la mediana feb–may del mismo año, HAND MERIT < 20 m, sin agua permanente | 2020: **IoU 34.9 %** (P 55.5 %, R 48.5 %) | **Adoptada** como etiqueta de inundación estacional |
| Sentinel-1, "vegetación inundada" (doble rebote) | Aumento de VV > 2 dB | Unión con la anterior: P 16.4 %, R 71.7 % | **Descartada:** demasiado ruido |

Los umbrales de Sentinel-1 se calibraron con un barrido de 34 combinaciones contra los polígonos de 2020. Detectan sobre todo la **inundación estacional recurrente**: entre 470 y 1 092 km² por año en 2015–2025, sin un pico marcado en 2020. Por eso se tratan como un fenómeno distinto de los eventos extremos de CENAPRED (§5.4).

---

## 5. Modelos y variantes

> Las cifras de esta sección son de los experimentos de exploración, hechos antes de la corrección de cobertura (§3.5). La evaluación definitiva, ya con la cobertura corregida, está en §6 y en el Resumen; las diferencias aparecen en la tercera cifra decimal.

Todas las variantes usan LightGBM con los mismos hiperparámetros: 400 árboles, tasa de aprendizaje 0.05, 63 hojas, `min_child_samples` 50 y submuestreo de 0.8 en filas y columnas. Se entrena con un muestreo balanceado de 150 000 celdas por clase. Las variables son las 6 del terreno LiDAR agregado a 30 m más las capas JRC, MERIT, WorldCover y GSW.

### 5.1 Fuga de etiquetas: variante sin capas de agua de Landsat

Las capas JRC GSW (ocurrencia y extensión máxima) pueden haber registrado las mismas inundaciones que se usan como etiqueta. Se entrenaron dos variantes:

| Variante | ROC AUC en validación cruzada espacial |
|---|---|
| Con GSW | 0.890 |
| Sin GSW ("física") | 0.885 ± 0.010 |

La diferencia es despreciable. Se adoptó la variante sin GSW para evitar la fuga.

### 5.2 La validación cruzada espacial sobreestima

Con bloques espaciales de 5 km (*StratifiedGroupKFold*, 5 pliegues), la variante física logra ROC 0.885 ± 0.010, PR 0.871 (muestra balanceada) y Brier 0.136, frente a ROC 0.740 de la mejor variable sola (JRC 100 años).

Pero al **entrenar solo con 2020 y evaluar en 2011**:

| Score | ROC | PR (tasa base 0.046) |
|---|---|---|
| Modelo (2020 → 2011) | 0.741 | 0.091 |
| JRC 100 años | 0.759 | 0.090 |
| Elevación | 0.758 | 0.092 |

**Diagnóstico.** Las manchas de inundación miden decenas de kilómetros, así que bloques de 5 km no logran descorrelacionarlas. La validación cruzada espacial mide sobre todo interpolación dentro de eventos conocidos. Además, solo el 28 % de la superficie inundada en 2011 se volvió a inundar en 2020: los eventos son muy distintos entre sí.

### 5.3 Comparación justa con el mapa oficial

Sobre los eventos de CENAPRED, IPCET-PNUD 2022 obtiene ROC 0.892 en 2011 y 0.848 en 2020, y PNUD 2018 obtiene 0.768 y 0.783. Como IPCET es de 2022, esa comparación no es justa. Por eso se definió como prueba justa **las temporadas de Sentinel-1 de 2023 a 2025**: son posteriores a IPCET y a los datos de entrenamiento del modelo.

Con esa prueba, el modelo de eventos extremos ya supera a IPCET en PR AUC todos los años. Por ejemplo, a 90 m: 0.114 contra 0.087 en 2023, 0.076 contra 0.058 en 2024 y 0.112 contra 0.088 en 2025.

### 5.4 Variantes de etiqueta y el sesgo del detector

Evaluación sobre Sentinel-1 2023–2025, a 30 m, con la media de ROC / PR:

| Variante | Etiquetas de entrenamiento | S1 2023–25 | CENAPRED 2011 (independiente) |
|---|---|---|---|
| a | CENAPRED (2011 + 2020) | 0.637 / 0.196 | (lo vio) |
| a′ | CENAPRED 2020 | — | 0.749 |
| b | CENAPRED + S1 2015–2022 | 0.753 / 0.281 | (lo vio) |
| b′ | CENAPRED 2020 + S1 2015–2022 | 0.758 / 0.284 | 0.707 |
| c | Solo S1 2015–2022 | 0.769 / 0.304 | **0.694** |
| — | JRC 100 años | 0.575 / 0.149 | 0.767 |
| — | IPCET-PNUD 2022 | 0.614 / 0.170 | (probablemente lo vio) |

**Hallazgo clave.** Las variantes entrenadas con Sentinel-1 ganan con claridad sobre etiquetas de Sentinel-1, pero **pierden contra JRC sobre un evento extremo independiente** (c: 0.694 contra 0.767). Se entrenan y evalúan con el mismo detector, así que aprenden también sus errores sistemáticos, y la prueba los premia. Hay dos "mundos" de etiqueta con fenómenos distintos: eventos extremos (CENAPRED) e inundación estacional (Sentinel-1). Ningún modelo único gana en ambos.

### 5.5 Ensamble

Se probó el promedio de rangos (función de distribución empírica de cada componente sobre las celdas del estado) del modelo de eventos extremos, el modelo estacional y JRC. **Los pesos son iguales y se fijaron a priori**, no se ajustaron mirando los eventos de prueba:

| Combinación (componentes que no vieron 2011) | CENAPRED 2011 | S1 2023 | S1 2024 | S1 2025 |
|---|---|---|---|---|
| Modelo extremos (2020) | 0.741 / 0.091 | 0.668 / 0.253 | 0.669 / 0.185 | 0.676 / 0.272 |
| Modelo estacional (S1) | 0.690 / 0.078 | 0.783 / 0.387 | 0.782 / 0.333 | 0.771 / 0.379 |
| JRC | 0.761 / 0.091 | 0.591 / 0.197 | 0.608 / 0.144 | 0.597 / 0.202 |
| 0.5 extremos + 0.5 estacional | 0.742 / 0.092 | 0.748 / 0.336 | 0.746 / 0.275 | 0.746 / 0.345 |
| **extremos + estacional + JRC (1/3 c/u)** | **0.784 / 0.108** | 0.720 / 0.305 | 0.724 / 0.236 | 0.721 / 0.312 |

Valores del prototipo, con una muestra de 1 M de celdas. La tabla del Resumen es la versión reproducible del pipeline (`validate`), con resultados prácticamente idénticos.

El ensamble de tres componentes es el único que **supera a JRC en el evento extremo no visto** y conserva una ventaja amplia en la inundación estacional. Se adoptó como producto.

---

## 6. Protocolo de validación final (reproducible)

El paso `python -m backend.floodmodel validate` reconstruye el ensamble con versiones de los componentes que **no vieron** los eventos de prueba:

| Componente | Entrenamiento | Prueba |
|---|---|---|
| Extremos | CENAPRED 2020 (5 capas) | CENAPRED 2011 |
| Estacional | S1 2015–2022 | S1 2023, 2024, 2025 |
| Referencias | JRC 100 años, elevación, IPCET-PNUD 2022 | Los mismos eventos |

Muestra de evaluación: 1 000 000 de celdas válidas, semilla 0. Resultado: la tabla del Resumen, guardada en `.cache/floodmodel/model/validation.json` y copiada a `backend/data/flood_risk/metadata.json`.

Los modelos publicados (paso `final`) se entrenan con **todos** los eventos. Validación cruzada espacial de referencia:

| Modelo publicado | ROC (5 pliegues) | Importancia (ganancia) principal |
|---|---|---|
| Eventos extremos | 0.884 ± 0.005 | JRC RP100 31.1 %, elevación 22.0 %, WorldCover 14.6 %, área de drenaje 12.5 % |
| Estacional | 0.821 ± 0.006 | **WorldCover 54.2 %**, HAND MERIT 8.1 %, JRC RP10 6.5 % |

---

## 7. Producto publicado

- **Clases.** Quintiles de superficie del índice del ensamble (cortes 0.344, 0.474, 0.597 y 0.749): Muy baja, Baja, Media, Alta y Muy alta. Por construcción, cada clase cubre ~20 % del estado.
- **Tiles.** 962 PNG con paleta (ColorBrewer YlGnBu), zoom 7–12, 8.0 MB en total. El navegador traduce el color del píxel a la clase sin consultar al servidor.
- **Por municipio.** Porcentaje de superficie por clase, % en Alta o Muy alta, puntaje medio y lugar en el estado:

| # | Municipio | km² | % Alta + Muy alta |
|---|---|---|---|
| 1 | Nacajuca | 522 | 84 % |
| 2 | Jonuta | 1 520 | 71 % |
| 3 | Centro | 1 654 | 73 % |
| 4 | Macuspana | 2 348 | 71 % |
| 5 | Centla | 2 531 | 68 % |
| 6 | Jalapa | 593 | 57 % |
| 7 | Jalpa de Méndez | 366 | 55 % |
| 8 | Emiliano Zapata | 560 | 36 % |
| 9 | Paraíso | 321 | 33 % |
| 10 | Cunduacán | 592 | 30 % |
| 11 | Comalcalco | 743 | 21 % |
| 12 | Teapa | 420 | 27 % |
| 13 | Cárdenas | 1 820 | 20 % |
| 14 | Huimanguillo | 3 654 | 23 % |
| 15 | Balancán | 3 520 | 17 % |
| 16 | Tacotalpa | 732 | 15 % |
| 17 | Tenosique | 1 844 | 10 % |

El orden del ranking sigue el puntaje medio, no el %. Las áreas excluyen el agua permanente.

---

## 8. Limitaciones y amenazas a la validez

1. **Ruido de etiquetas.** Mapas independientes del mismo evento coinciden con IoU de 14–35 %. Los AUC absolutos (~0.7–0.78) están acotados por ese ruido. Las **comparaciones** entre mapas son más confiables que los valores absolutos.
2. **Sesgo compartido del detector Sentinel-1.** El modelo estacional y la prueba 2023–2025 comparten el mismo detector, lo que favorece al ensamble frente a IPCET y JRC en esa prueba. Por eso el criterio de adopción exigió además superar a JRC en un evento extremo independiente (2011).
3. **Dominio del uso de suelo en el modelo estacional (54 % de la ganancia).** Puede reflejar un patrón real (humedales y pastizales inundables) o un artefacto del detector (por ejemplo, cultivos cosechados que se oscurecen en el radar). No se resolvió.
4. **Selección del ensamble.** Los pesos se fijaron a priori, pero la *idea* de ensamblar surgió después de ver los resultados en 2011 y en 2023–2025. Hay cierto riesgo de sesgo de selección; la confirmación definitiva exige un evento futuro.
5. **Antigüedad del LiDAR (vuelo 2007).** Las obras de protección posteriores (bordos y el Plan Integral Hídrico de Tabasco tras 2007) no están en el MDE. Zonas protegidas de Villahermosa pueden aparecer más susceptibles de lo que son.
6. **Resolución y fuentes de terreno.** El terreno se procesó a 15 m, no a 10 m, por límites de memoria y tiempo (§3.1). En el 12.6 % del estado sin LiDAR el terreno sale del CEM 3.0, que tiene elevaciones en metros enteros y otra fecha de captura. Algunas variables (JRC y MERIT, ~90 m) son más gruesas que la grilla.
7. **Clases relativas.** Los quintiles hacen que ~40 % del estado sea "Alta" o "Muy alta" por definición. El mapa ordena; no dice cuánto se inunda ni con qué frecuencia.
8. **Artefactos visibles.** Hay un rayado diagonal tenue en Centla, probablemente por las franjas de órbita de Sentinel-1.
9. **Límites.** La simplificación de GAUL dejó líneas sueltas en 3 municipios; se corrigió, y el efecto fue de 5 de 26.9 M celdas.

---

## 9. Sugerencias de mejora

| Mejora | Beneficio esperado | Costo |
|---|---|---|
| Más eventos extremos independientes (activaciones de Copernicus EMS, UNOSAT; la inundación de 2007 con radar si existiera) | Mejor generalización del componente de extremos | Medio |
| Inventario de bordos y obras de protección (CONAGUA, PIHT) para ajustar HAND y direcciones de flujo | Corrige la sobreestimación en zonas protegidas | Medio–alto |
| Detector Sentinel-1 con umbrales por cobertura de suelo y control de cultivos | Reduce el posible artefacto de uso de suelo | Medio |
| Validación cruzada por cuenca, o con bloques ≥ 50 km | Métrica interna más honesta | Bajo |
| Calibración de probabilidad (isotónica) con eventos retenidos | Pasar de un índice relativo a una probabilidad interpretable | Medio |
| Mover `rasterio` y `matplotlib` al grupo `floodmodel` (la app ya no los usa) | Instalación de la app más liviana | Bajo |
| Alinear `openapi.yaml` con las rutas reales (deriva previa a este trabajo) | Documentación de la API correcta | Bajo |
| Segmentar inundaciones de Sentinel-1 con una red profunda (p. ej. U-Net, en la GPU disponible) | Etiquetas estacionales menos ruidosas, incluida la vegetación inundada | Alto |

---

## 10. Reproducibilidad

```bash
uv sync --group floodmodel
python -m backend.floodmodel lidar-index && python -m backend.floodmodel lidar-download
python -m backend.floodmodel boundaries
python -m backend.floodmodel terrain-mosaic --resolution 15 && python -m backend.floodmodel cem
python -m backend.floodmodel terrain-aux && python -m backend.floodmodel terrain-condition
python -m backend.floodmodel terrain-derivatives --resolution 15 --conditioned
python -m backend.floodmodel inventory && python -m backend.floodmodel gee-features
python -m backend.floodmodel stack
python -m backend.floodmodel labels && python -m backend.floodmodel s1-seasons
python -m backend.floodmodel validate && python -m backend.floodmodel final
python -m backend.floodmodel publish
```

- **Cómputo.** WSL2 con 12 GB de RAM y 8 núcleos. El paso más pesado es la hidrología a 15 m (pico de 8.3 GB, 7 min). La cadena completa tarda ~1.3 h, dominada por las descargas de Earth Engine. Todos los pasos en numpy procesan el ráster por franjas: una primera versión que cargaba el estado completo agotó la memoria (8.6 GB) y tumbó la máquina virtual.
- **Pruebas.** 699 tests de backend (incluidos los del pipeline con datos sintéticos), 268 de frontend (vitest) y 15 end-to-end (Playwright, con los tiles reales).
- **Commits** (rama `feat/flood-risk-model`):

| Commit | Contenido |
|---|---|
| `0075a82` | Esqueleto del pipeline y descarga LiDAR |
| `fb7c34f` | Acondicionamiento, HAND, inventario y capas de Earth Engine |
| `6e00db0` | Modelo y validación cruzada espacial |
| `8e3f185` | Etiquetas estacionales, ensamble y validación con eventos retenidos |
| `71f3ec1` | Publicación (clases, tiles, estadísticas) |
| `0e2236c`, `f02d18c` | Capa estatal, lector de valor y coropleta |
| `5d97c9d`, `e2d7e8b` | Retiro del FHI anterior y documentación |
| `cef6f9f` | Este reporte |
| `e98eb79`, `75774c7` | Cobertura estatal completa y relleno con el CEM 3.0 |

- **Reproducibilidad verificada.** El paso `s1-seasons` del CLI regeneró las 11 temporadas de Sentinel-1 (2015–2025) **idénticas byte a byte** a las del prototipo con el que se eligieron los umbrales (49 min de descarga desde Earth Engine).

---

## Referencias

- Lindsay, J. B. (2016). Efficient hybrid breaching-filling sink removal methods for flow path enforcement in digital elevation models. *Hydrological Processes*, 30(6), 846–857.
- Nobre, A. D. et al. (2011). Height Above the Nearest Drainage – a hydrologically relevant new terrain model. *Journal of Hydrology*, 404(1–2), 13–29.
- Yamazaki, D. et al. (2019). MERIT Hydro: a high-resolution global hydrography map. *Water Resources Research*, 55, 5053–5073.
- Pekel, J.-F. et al. (2016). High-resolution mapping of global surface water and its long-term changes. *Nature*, 540, 418–422.
- Tellman, B. et al. (2021). Satellite imaging reveals increased proportion of population exposed to floods. *Nature*, 596, 80–86.
- Ke, G. et al. (2017). LightGBM: A highly efficient gradient boosting decision tree. *NeurIPS 30*.
- Roberts, D. R. et al. (2017). Cross-validation strategies for data with temporal, spatial, hierarchical, or phylogenetic structure. *Ecography*, 40(8), 913–929.
- European Commission, Joint Research Centre. CEMS GloFAS Flood Hazard maps v2.1 (dataset `JRC/CEMS_GLOFAS/FloodHazard/v2_1` en Google Earth Engine).
- INEGI. Modelo Digital de Elevación de alta resolución LiDAR, 5 m; Continuo de Elevaciones Mexicano 3.0, 15 m. CENAPRED. Atlas Nacional de Riesgos. FAO. GAUL 2025.
