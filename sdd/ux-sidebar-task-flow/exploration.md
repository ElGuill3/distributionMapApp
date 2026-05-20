# Exploration: ux-sidebar-task-flow

## 1. Problemas concretos del sidebar actual

### Jerarquía y composición
- **Jerarquía plana**: Los 5 acordiones de variable (NDVI, Temp, Soil, Precip, Water) están al mismo nivel que los toggles de modo y las estaciones. El ojo no tiene un punto de aterrizaje claro.
- **Sin progresión visual**: No hay indicación de qué viene primero, segundo, tercero. Todo compite por la misma atención.

### Repetición
- **5 hints idénticos**: Cada `<details>` repite exactamente el mismo texto: *"1) Dibuja un rectángulo en el mapa. 2) Elige año y temporada. 3) Pulsa 'Generar animación'."* — 5 veces, ~75 palabras duplicadas.
- **5 Selectores año/temporada idénticos**: Misma estructura HTML (`<select>` año → `<select>` temporada → `<button>` generar) replicada 5 veces con IDs distintos pero lógica idéntica.

### Densidad
- **~300px de sidebar contiene**: 5 acordiones completos + 16 checkboxes de municipios + 2 selectores de estación + 3 botones de modo + 1 botón limpiar + 1 status bar + hints → exceso de información en espacio insuficiente.
- **Scroll obligatorio**: En pantallas <900px el sidebar requiere scroll para ver todas las variables.

### Flujo confuso
- **El primer paso (dibujar bbox) NO se destaca**: La barra de estado dice "Dibuja un rectángulo en el mapa" pero está enterrada entre controles. El Leaflet Draw toolbar (arriba-izquierda del mapa) es un icono genérico sin label.
- **No hay guía de progresión**: Después de dibujar el bbox, no hay señal visual de "ahora elige variable". El usuario tiene que saber que debe abrir un accordion.
- **Compare/Flood Risk desactivan controles sin contexto**: Botones que desactivan secciones enteras con `opacity: 0.45` y `pointer-events: none` — sin transición ni explicación de QUÉ cambió.

### Peso del CTA
- **Botones "Generar" son visualmente débiles**: Son `.primary-action` pero compiten con los selectores de año/temporada por atención. No transmiten "este es el paso final".
- **"Limpiar" es destructive-btn inline**: Está en la toolbar de modo, no vinculado al flujo que limpia.

### Separación de pasos
- **Configuración vs análisis vs herramientas secundarias — todo mezclado**: Variables (config), modos (análisis alternativo), estaciones (suplementario) y limpiar (acción) comparten la misma columna sin distinción visual.

---

## 2. Estructura de sidebar que mejor encaja

**Recomendación: Pasos numerados + chips de variable**

```
┌─────────────────────────┐
│ ✕ (collapse)            │  ← header mínimo
├─────────────────────────┤
│ PASO 1: Seleccionar área│  ← step container, estado visual
│ ● Área seleccionada     │  ← chip verde si bbox existe
│   [Limpiar área]        │  ← solo aparece después de selección
├─────────────────────────┤
│ PASO 2: Configurar      │  ← step container
│ [NDVI] [Temp] [Soil]   │  ← chip/tab selector (1 activo)
│ [Precip] [Water]        │
│ Año: [▼ 2024]          │  ← solo visible si paso 1 completo
│ Temporada: [▼ Verano]   │  ← solo visible si paso 1 completo
│ [▸ Generar animación]   │  ← CTA primario, solo habilitado si todo lleno
├─────────────────────────┤
│ PASO 3: Explorar        │  ← estaciones y exportación
│ ☐ San Pedro (SPTTB)    │
│ ☐ Boca del Cerro (BDCTB)│
│ 💾 Exportar análisis     │  ← enlace a resultados/export
│ 📄 Exportar PDF         │
├─────────────────────────┤
│ MODO                    │  ← sección separada, visualmente distinta
│ [🔲 Comparar años]      │  ← toggle chip
│ [🌊 Mapa de riesgo]     │  ← toggle chip
└─────────────────────────┘
```

**Por qué pasos numerados y no acordiones**:
- El flujo del usuario SIEMPRE es: seleccionar área → configurar → generar. Es lineal y predecible.
- Los acordiones son para contenido condicional y paralelo, no para guiar una secuencia.
- Los chips (ej: `[NDVI] [Temp] [Soil]`) eliminan la necesidad de 5 acordiones abiertos/cerrados y reducen la altura del sidebar en ~60%.

**Comportamiento de apertura/cierre**:
- Paso 1: Siempre visible. Chip de estado (gris=vacío, verde=seleccionado).
- Paso 2: Visible siempre, pero los selects año/temporada aparecen solo si bbox existe (progressive disclosure). Botón "Generar" deshabilitado hasta que los 3 campos estén completos.
- Paso 3: Visible siempre. Estaciones y exportación no dependen del flujo anterior pero se habilitan/deshabilitan según haya datos.
- Sección MODO: Siempre visible en la base, separada por un delimiter visual.

---

## 3. Flujo del task principal dentro del sidebar

### Estados de los pasos

**Paso 1 — Seleccionar área**:
- ⬜ Pendiente: Muestra "Dibuja un rectángulo en el mapa" como hint
- ✅ Completado: Muestra "Área seleccionada" + coordenadas truncadas + botón "Limpiar área"
- 🔄 Generando: Muestra "Generando…" con animación de pulso
- ❌ Error: Muestra error inline

**Paso 2 — Configurar**:
- 🟡 Parcial: Los chips de variable son clicables, pero los selectores año/temporada están visibles con año habilitado y temporada disabled. Botón "Generar" deshabilitado.
- ✅ Listo: Año seleccionado → temporada se habilita → temporada seleccionada → botón "Generar" se habilita.

**Paso 3 — Explorar**:
- ⬜ Sin datos: Botones de exportación deshabilitados.
- ✅ Con datos: Botones habilitados.

### Transiciones clave
1. **bbox dibujado** → Paso 1 cambia de pendiente a completado.
2. **Variable seleccionada (chip clic)** → Se actualizan año/temporada según la API, se marca variable activa.
3. **Año seleccionado** → Temporada se habilita.
4. **Temporada seleccionada** → Botón "Generar" se habilita.
5. **Botón "Generar" → clic** → Estado cambia a "Generando…", luego a completado con overlay.

### Modo comparativa / riesgo
- Al activar un modo especial, los pasos 1-2 se desactivan visualmente y aparece un banner INLINE en el sidebar.
- Los controles de comparativa se muestran dentro del sidebar como bloque contextual bajo el toggle activo.
- Los controles de municipios de Flood Risk se despliegan debajo del toggle "Mapa de riesgo".

---

## 4. Elementos a simplificar o eliminar

### Simplificar
| Elemento actual | Transformación |
|---|---|
| 5 `<details>` de variable con hint repetido | → 1 selector de chips + 1 bloque de selects año/temporada |
| 5 hints "1) Dibuja… 2) Elige… 3) Pulsa…" | → 1 hint en Paso 1, nunca más repetido |
| Status bar de texto plano | → Chip visual con icono y color de estado |
| Botón "Limpiar" como destructive-btn en toolbar | → Botón contextual "Limpiar área" solo cuando hay bbox |
| `compare-toolbar` como div separado | → Integrado en sección MODO del sidebar |

### Eliminar (absorbidos por nueva estructura)
| Elemento | Destino |
|---|---|
| `<details id="ndvi-controls">` | → Absorbido por chip selector |
| `<details id="temp-controls">` | → Absorbido por chip selector |
| `<details id="soil-controls">` | → Absorbido por chip selector |
| `<details id="precip-controls">` | → Absorbido por chip selector |
| `<details id="water-controls">` | → Absorbido por chip selector |
| `.compare-toolbar` (div con 3 botones) | → Absorbido por sección MODO |
| `5 × <p class="hint">` repetidos | → Un solo hint en Paso 1 |

---

## 5. Patrón visual del sidebar

**Patrón: Step container con estado visual + chip selector**

- Cada paso es un `.step-container` con `border-left` accent que cambia de color según estado.
- Los chips de variable son `.var-chip` — buttons con `border-radius: var(--radius-md)`, padding compacto.
- El chip activo tiene `transition: background 0.15s ease`.
- La sección MODO tiene fondo distinto (`--sidebar-group-header-bg`) para separarla visualmente.

**Token mapping** (usando tokens existentes + extensiones):
- Paso pendiente: `border-left: var(--sidebar-group-border)`, text `--gray-400`
- Paso activo: `border-left: var(--details-active-accent-width) solid var(--details-active-accent)`, text `--surface-fg`
- Paso completado: `border-left: var(--status-bar-accent)`, text `--surface-fg`, icono checkmark
- Chip inactivo: `bg: var(--surface-bg)`, `border: 1px solid var(--sidebar-border)`, `color: var(--sidebar-fg)`
- Chip activo: `bg: var(--btn-primary-bg)`, `border: 1px solid var(--btn-primary-bg)`, `color: var(--btn-primary-fg)`
- Sección MODO: `bg: var(--sidebar-group-header-bg)`, `border-top: 1px solid var(--sidebar-group-border)`

No se necesitan frameworks nuevos — HTML semántico + CSS con tokens existentes.

---

## 6. Cómo manejar variables y herramientas secundarias

### Variables (principal)
- **Chip/tab selector**: 5 chips en una fila wrap (`flex-wrap: wrap`), uno seleccionado a la vez.
- Al seleccionar un chip, se actualiza `currentVariable` en `mapState` y se refrescan los selectores de año/temporada.
- **Los 5 acordiones se ELIMINAN**. La lógica de `variableConfigs` se adapta para alimentar un solo par de selectores dinámico.
- El hint de 3 pasos se muestra UNA VEZ en Paso 1.

### Compare mode
- Toggle en sección MODO del sidebar.
- Al activarse, Pasos 1-2 se desactivan visualmente.
- Los controles de comparativa permanecen en el chart container en este cambio. Moverlos es Change B.

### Flood Risk
- Toggle en sección MODO del sidebar.
- Al activarse, Pasos 1-2 se desactivan visualmente.
- El grid de municipios se despliega debajo del toggle.

### Botón Limpiar
- Se mueve al Paso 1 (como "Limpiar área" contextual, solo cuando hay bbox).

### Estaciones locales
- Se mueven al Paso 3 bajo "Explorar".
- Misma lógica, nueva posición en el DOM.

---

## 7. Quick wins de mayor impacto (MVP)

| # | Quick win | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | Reemplazar 5 acordiones por chips + selects únicos | 🔴 Muy alto | Medio |
| 2 | Pasos numerados con estados visuales | 🔴 Alto | Medio |
| 3 | Eliminar hints duplicados → 1 hint en Paso 1 | 🟡 Alto | Bajo |
| 4 | Status bar → chip de estado con icono | 🟡 Medio | Bajo |
| 5 | Sección MODO separada | 🟡 Medio | Bajo |
| 6 | Botón "Limpiar" contextual | 🟢 Bajo | Bajo |

---

## 8. Qué queda FUERA de este SDD

| Exclusión | Razón |
|---|---|
| Topbar (nuevo componente) | Pertenece a Change B (`ux-topbar-and-map-overlays`) |
| Fecha/label sobre el mapa durante animación | Pertenece a Change B |
| Chart panel collapsible/expandible | Pertenece a Change C (`ux-chart-panel-and-darkmode`) |
| Dark mode completo/contraste | Pertenece a Change C |
| Rediseño de controles de comparativa en chart | Requiere cambios mayores en compareMode.ts, Change B |
| Leaflet Draw toolbar styling | Cosmético, pertenece a Change B |
| Refactor FSM de modos | Fuera de alcance — este cambio adapta callers existentes |
| Nuevos endpoints API | No se necesitan |
| i18n | Fuera de alcance |
| Alpha slider para overlays | No impacta el sidebar |

---

## 9. Archivos frontend afectados

| Archivo | Tipo de cambio | Lines estimados |
|---|---|---|
| `templates/index.html` | Mayor: reescribir sidebar (5 acordiones → pasos + chips), reubicar controles de modo | ~120-150 |
| `static/styles.css` | Mayor: nuevos estilos (`.step-container`, `.var-chip`, `.mode-section`), eliminar estilos viejos | ~150-200 |
| `src/ts/main.ts` | Moderado: re-cablear listeners, selects dinámicos, step flow | ~80-100 |
| `src/ts/listeners/variableListeners.ts` | Moderado: adaptar para selects dinámicos basados en variable activa | ~30-40 |
| `src/ts/modes/normalMode.ts` | Menor: adaptar llamada a generate para usar variable activa | ~20-30 |
| `src/ts/modes/compareMode.ts` | Menor: ajustes de visibilidad del sidebar | ~10-15 |
| `src/ts/modes/floodRiskMode.ts` | Menor: toggle se mueve dentro de sección MODO | ~10-15 |
| `src/ts/state/mapState.ts` | Menor: posiblemente agregar `activeStep` o `sidebarStep` | ~5-10 |
| `src/ts/config.ts` | Ninguno | 0 |
| `src/ts/types.ts` | Ninguno | 0 |

**Total estimado**: ~425-575 líneas. Puede requerir 2 PRs encadenados.

---

## 10. ¿Un solo cambio SDD o dividir más?

**Recomendación: Un solo cambio SDD (`ux-sidebar-task-flow`) con posibilidad de 2 PRs encadenados.**

**Razón**: El sidebar es una unidad cohesiva — separar chips de pasos crearía un estado intermedio roto. Si el conteo de líneas supera las 400 del presupuesto de revisión, se divide en:
- **PR 1**: HTML + CSS del sidebar reestructurado (steps, chips, mode section, tokens). Listeners viejos puenteando nuevos elementos.
- **PR 2**: JS wiring completo — variable listeners dinámicos, step flow states, mode toggle relocation, eliminar listeners viejos.

**Riesgos**:
1. **Re-cableado de listeners**: Reducir de 5 pares estáticos a 1 par dinámico cambia el patrón de `variableListeners.ts`.
2. **Modos especiales**: Las reglas CSS que desactivan `#ndvi-controls` etc. deben actualizarse a selectores de clase en los step containers.
3. **Dependencia con Change B**: La sección MODO queda en el sidebar. Se debe diseñar para que sea movable потом.

---

## Approaches

### Approach 1: Chip selector + numbered steps (RECOMENDADO)
- Elimina repetición, guía al usuario, reduce altura ~60%
- Esfuerzo: Medium (~425-575 líneas)

### Approach 2: Mantener acordiones con estados progresivos
- Refinar existentes con estados visuales, sin cambiar a chips
- No resuelve repetición ni jerarquía plana
- Esfuerzo: Low-Medium (~200-300 líneas)

### Approach 3: Wizard multi-página
- Sidebar con vistas, 1 paso a la vez con Siguiente/Anterior
- Over-engineering para 3 pasos, dificulta ajustar config
- Esfuerzo: High (~500-700 líneas)

## Recommendation

**Approach 1** — Resuelve el problema raíz con el menor costo de complejidad.

## Risks

1. Re-cableado de listeners puede romper generación de animaciones (core functionality)
2. Reglas CSS de modos especiales deben actualizarse por selectores de clase
3. Sección MODO debe diseñarse como movable para Change B
4. Controles de comparativa permanecen en chart container — UX coherente pero no óptima hasta Change B

## Ready for Proposal

**Sí**. El alcance está claro y los archivos son identificables.