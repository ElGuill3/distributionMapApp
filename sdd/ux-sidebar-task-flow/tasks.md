# Tasks: ux-sidebar-task-flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~750-850 (PR1: ~450-500, PR2: ~300-350) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 (feature-branch-chain) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Estructura HTML/CSS del sidebar + modules JS + bridge legacy | PR 1 | Base: main; estructura nueva + convivencia con wiring viejo |
| 2 | Rewiring completo + cleanup legacy + validación e2e | PR 2 | Base: PR 1; nueva UI cableada, listeners viejos eliminados |

---

## PR 1: Estructura + compatibility bridge

### Fase 1: HTML — nueva estructura del sidebar

- [ ] 1.1 Reescribir `#app-sidebar` en `templates/index.html`: crear 4 step-containers (`.tflow-step`) con IDs `#tflow-area`, `#tflow-variable`, `#tflow-config`, `#tflow-explore`
- [ ] 1.2 Agregar `.tflow-step-indicator` en cada paso con número y label
- [ ] 1.3 Crear `#tflow-modo-section` al final del sidebar con `.modo-toggle` chips para Comparar/Mapa riesgo
- [ ] 1.4 Agregar `#tflow-hint` (hint único) dentro de `#tflow-area` — sin duplicados
- [ ] 1.5 Mover `#btnClearNormal` → `#tflow-area` como `#tflow-clear-btn` (visibilidad controlada por JS)
- [ ] 1.6 Crear `#tflow-chip-container` en `#tflow-variable` con 5 botones `.tflow-chip` [NDVI, Temp, Soil, Precip, Water]
- [ ] 1.7 Agregar selects compartidos `#tflow-year-select`, `#tflow-season-select` y botón `#tflow-generate-btn` en `#tflow-config`
- [ ] 1.8 Mover controles de estación y exportación → `#tflow-explore`
- [ ] 1.9 Mantener los 5 `<details>` originales ocultos (`display: none`) para bridge de compatibilidad

**Archivos**: `templates/index.html`
**Esfuerzo**: alto
**Validación**: El sidebar renderiza la nueva estructura HTML sin JS cableado; old accordion DOM presente pero oculto

### Fase 2: CSS — estilos con prefijo `.tflow-`

- [ ] 2.1 Agregar en `static/styles.css`: `.tflow-step`, `.tflow-step-indicator`, `.tflow-step.pending/active/complete`, `.tflow-hint`
- [ ] 2.2 Agregar `.tflow-chip`, `.tflow-chip.active`, `.tflow-chip-container`
- [ ] 2.3 Agregar `.tflow-modo-section`, `.modo-toggle`, `.modo-toggle.active`
- [ ] 2.4 Agregar `.tflow-clear-btn`, `.tflow-year-select`, `.tflow-season-select`, `.tflow-generate-btn`
- [ ] 2.5 Definir tokens `.tflow-` para border-left states (pending: gray-400, active: accent, complete: green)
- [ ] 2.6 Actualizar selectores CSS de modos especiales (`compareMode`/`floodRiskMode`) para targetear `.tflow-step` en lugar de `<details>` IDs
- [ ] 2.7 Agregar `.tflow-step.disabled` con `opacity: 0.45; pointer-events: none`

**Archivos**: `static/styles.css`
**Esfuerzo**: alto
**Validación**: `grep -r "tflow-" static/styles.css` muestra todas las reglas;旧的`<details>` ocultos no reciben estilos de nuevos selectores

### Fase 3: Módulos JS nuevos

- [ ] 3.1 Crear `static/sidebar/taskFlow.js` — exporta `TaskFlowController` con métodos `init()`, `transitionTo(step)`, `updateStepStatus(step, status)`, `setStepsDisabled(bool)`
- [ ] 3.2 Crear `static/sidebar/variableSelector.js` — exporta `VariableSelector` con `init_chip_container()`, `setActiveChip(variable)`, `getActiveVariable()`
- [ ] 3.3 Crear `static/sidebar/configPanel.js` — exporta `ConfigPanel` con `populateYearSelect(variable)`, `populateSeasonSelect(variable, year)`, `updateGenerateButton()`
- [ ] 3.4 Crear `static/sidebar/modoSection.js` — exporta `ModoSection` con `init()`, `activateModo(modo)`, `deactivateAll()`
- [ ] 3.5 Exportar las funciones bridge desde cada módulo para acceso desde legacy listeners

**Archivos**: `static/sidebar/taskFlow.js`, `static/sidebar/variableSelector.js`, `static/sidebar/configPanel.js`, `static/sidebar/modoSection.js`
**Esfuerzo**: medio
**Validación**: `ls static/sidebar/` muestra los 4 archivos; cada módulo tiene `export { ... }`

### Fase 4: mapState — estado del flujo

- [ ] 4.1 Agregar a `src/ts/state/mapState.ts`: `TaskFlowState` interface con `currentStep`, `steps[step].status`, `steps[step].isValid`
- [ ] 4.2 Agregar `taskFlow: TaskFlowState` al `MapState` y exportarlo
- [ ] 4.3 Agregar helper functions: `getTaskFlowState()`, `setTaskFlowStep(step)`, `updateStepValidity(step, isValid)`

**Archivos**: `src/ts/state/mapState.ts`
**Esfuerzo**: bajo
**Validación**: `tsc --noEmit` sin errores en mapState.ts

### Fase 5: Bridge legacy wiring

- [ ] 5.1 En `src/ts/main.ts`: importar y llamar `TaskFlowController.init()` y `VariableSelector.init_chip_container()` en init
- [ ] 5.2 Crear bridge function `bridgeOldDetailsToNewChips()` que conecta clicks en `<details>` legacy → `VariableSelector.setActiveChip()`
- [ ] 5.3 En `variableListeners.ts`: agregar `if (newUIActive) return` early exit cuando los nuevos chips existen
- [ ] 5.4 En `normalMode.ts`: modificar `generateAnimation()` para leer `VariableSelector.getActiveVariable()` en lugar de iterar `<details>`
- [ ] 5.5 En `compareMode.ts` y `floodRiskMode.ts`: asegurar que `ModoSection` se inicializa y que `.tflow-step` se desactiva

**Archivos**: `src/ts/main.ts`, `src/ts/listeners/variableListeners.ts`, `src/ts/modes/normalMode.ts`, `src/ts/modes/compareMode.ts`, `src/ts/modes/floodRiskMode.ts`
**Esfuerzo**: medio
**Validación**: App carga sin errores en consola; compare/flood modes se activan sin romper UI

### Done criteria PR 1

- [ ] Sidebar renderiza 4 pasos visibles con indicator visual
- [ ] Chips son clicables y muestran estado activo
- [ ] Selectores año/temporada se pueblan al hacer clic en chip (datos desde variableConfigs)
- [ ] Modos compare/flood activan/desactivan `.tflow-step` correctamente
- [ ] App es 100% usable en modo normal
- [ ] No hay regression funcional en compare/flood modes
- [ ] `tsc --noEmit` sin errores

---

## PR 2: Full rewiring + cleanup legacy

### Phase 1: Rewiring JS — nueva UI como fuente oficial

- [x] 1.1 En `src/ts/main.ts`: quitar bridge functions y cablear `VariableSelector` directamente a los listeners de año/temporada
- [x] 1.2 En `src/ts/listeners/variableListeners.ts`: DELETE the file — all logic migrated to modules
- [x] 1.3 Conectar `#tflow-generate-btn` → `normalMode.generateAnimation()` directamente sin pasar por viejo `generate-btn` en details
- [x] 1.4 Conectar `#tflow-clear-btn` → lógica de clear existente (`clearBbox()` + `resetMapState()`)
- [x] 1.5 Quitar `bboxChanged` event dispatcher de main.ts (taskFlow lee mapState.getBbox() directamente)

**Archivos**: `src/ts/main.ts`, `src/ts/listeners/variableListeners.ts`
**Esfuerzo**: alto
**Validación**: Generación de animación funciona con chip selector; clear button limpia bbox y resetea pasos

### Fase 2: Dynamic listeners y single source of truth

- [x] 2.1 En `src/ts/state/mapState.ts`: agregar `currentVariable` y `bboxCoords` como parte de `TaskFlowState`
- [x] 2.2 Crear `TaskFlowController.transitionTo(step)` que actualiza `currentStep` en mapState y actualiza UI
- [x] 2.3 Hacer que `VariableSelector.setActiveChip(variable)` llame `TaskFlowController.transitionTo('config')` y actualice `currentVariable`
- [x] 2.4 Hacer que `#tflow-year-select onChange` llame `ConfigPanel.populateSeasonSelect()` y `TaskFlowController.updateStepValidity('config', true)` cuando año+temporada llenos
- [x] 2.5 Hacer que `#tflow-generate-btn` verifique `TaskFlowState.steps['config'].isValid` antes de invocar generación

**Archivos**: `src/ts/state/mapState.ts`, `static/sidebar/taskFlow.js`, `static/sidebar/configPanel.js`
**Esfuerzo**: medio
**Validación**: Estado de pasos se refleja en UI correctamente; botón generar deshabilitado si falta config

### Fase 3: Legacy wiring removal

- [x] 3.1 Eliminar `static/sidebar/bridge.js` — compatibility bridge eliminado
- [x] 3.2 Eliminar `src/ts/listeners/variableListeners.ts` — toda la lógica migrada a módulos
- [x] 3.3 En `templates/index.html`: eliminar `<details id="ndvi-controls">`, `<details id="temp-controls">`, etc. — ya no existen
- [x] 3.4 En `static/styles.css`: reemplazar selectores legacy `#ndvi-controls` etc. con `.tflow-step.disabled`
- [x] 3.5 En `src/ts/main.ts`: quitar imports de `variableListeners.ts` y limpiar `init()` de referencias legacy

**Archivos**: `templates/index.html`, `static/styles.css`, `src/ts/main.ts`, `src/ts/listeners/variableListeners.ts`
**Esfuerzo**: medio
**Validación**: `variableListeners.ts` no existe en el repo; ningún DOM element `<details>` para variables

### Fase 4: HTML/CSS cleanup

- [x] 4.1 Limpiar `templates/index.html`: quitar IDs y classes legacy de elementos eliminados; comments que ya no aplican
- [x] 4.2 En `static/styles.css`: reemplazar selectores `#ndvi-controls` etc. con `.tflow-step.disabled` equivalentes
- [x] 4.3 Eliminar cualquier `display: none` residual para `<details>` — el HTML ya no los contiene

**Archivos**: `templates/index.html`, `static/styles.css`
**Esfuerzo**: bajo
**Validación**: `grep "display.*none.*details\|#ndvi-controls\|#temp-controls" static/styles.css templates/index.html` returns empty

### Fase 5: Final compare/flood compatibility

- [x] 5.1 Verificar que `compareMode.ts` y `floodRiskMode.ts` usan `ModoSection.activateModo()` correctamente
- [x] 5.2 Verificar que `.tflow-step.disabled` se aplica en ambos modos sin regresión visual
- [x] 5.3 Probar transición normal → compare → flood → normal sin errores de estado (ModoSection activa los toggles correctamente)

**Archivos**: `src/ts/modes/compareMode.ts`, `src/ts/modes/floodRiskMode.ts`, `static/sidebar/modoSection.js`
**Esfuerzo**: bajo
**Validación**: Las 4 transiciones de modo funcionan; sidebar no se rompe

### Fase 6: Validación e2e

- [x] 6.1 Test manual completo: dibujar bbox → seleccionar chip → elegir año → elegir temporada → generar animación
- [x] 6.2 Test: compare mode activa, seleccionar área sigue deshabilitada, generar es posible
- [x] 6.3 Test: flood risk mode activa, grid de municipios visible, bbox deshabilitado
- [x] 6.4 Test: clear button limpia área y resetea a paso 1
- [x] 6.5 Verificar `tsc --noEmit` sin errores (solo TS7016 para sidebar modules — esperado)
- [x] 6.6 Verificar que no hay `console.error` o `console.warn` en flujo normal

**Validación**: Flujo completo funciona sin regresiones

### Done criteria PR 2

- [x] Todos los `<details>` de variable eliminados del DOM
- [x] `variableListeners.ts` eliminado
- [x] `bridge.js` eliminado
- [ ] Flujo completo 4 pasos funciona end-to-end
- [x] No hay elementos DOM legacy duplicados
- [x] Export/estaciones funcionan desde `#tflow-explore`
- [x] `tsc --noEmit` limpio (solo TS7016 para sidebar JS modules)
- [x] No hay regression en compare/flood modes

---

## Cleanup tasks (ambos PRs)

- [ ] CR1: Antes de merge de PR1, verificar que no hay `console.log` leftover de debug en los nuevos módulos
- [ ] CR2: Antes de merge de PR2, eliminar comments `// TODO legacy remove` que ya no aplican
- [ ] CR3: После PR2, verificar que `static/sidebar/` no contiene archivos bridge/temp no utilizados
- [ ] CR4: Asegurar que `.tflow-` prefix es consistente en todos los nuevos selectors (sin mezclas con old naming)

---

## Notas de implementación

1. **CSS prefix `.tflow-`**: TODOS los nuevos selectores CSS deben usar este prefijo para evitar conflictos con código existente
2. **Bridge en PR1**: El bridge permite que old listeners + new UI coexistan durante PR1; PR2 lo elimina
3. **mapState no cambia interfaz pública**: Solo se agrega `taskFlow` al estado; consumers existentes no se rompen
4. **Modo toggles no se reescriben internamente**: `compareMode.ts` y `floodRiskMode.ts` no se modifican en su lógica interna — solo se reubican en DOM y se conectan a `ModoSection`