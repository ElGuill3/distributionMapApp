# Exploration: Geospatial App UX/UI Overhaul

## Current State

The application is a geospatial environmental/hydrometeorological analysis viewer built with vanilla TypeScript + Leaflet + Plotly on the frontend, and Flask (Python) on the backend. The UI is a single-page layout composed of:

1. **Left sidebar** (~320px): Contains ALL configuration, mode toggles, variable selectors, station controls, and status feedback — 5 `<details>` accordion sections (NDVI, Temp, Soil, Precip, Water), flood risk checkboxes, local station selectors, mode toggle buttons (compare + flood risk), and a "Limpiar" destructive action.
2. **Center map+chart area**: A CSS Grid with `minmax(0, 320px) 1fr` columns. The right area contains a flex column with `#map-and-chart` holding one or two map panels (A/B in compare mode), each split into map (flex:7) + chart container (flex:3).
3. **Chart area**: Plotly chart in a flex:3 container at the bottom of each panel, with export toolbar and compare-mode controls crammed into the chart container.
4. **Overlays**: Colorbars as Leaflet controls (topright), mode banners as fixed position overlays, progress/error modals as fixed-position HTML inserted by JS.

### Architecture (frontend files)

| File | Role |
|------|------|
| `templates/index.html` | Full HTML template — sidebar, map containers, chart containers, player controls |
| `static/styles.css` | Single monolithic CSS file (~1613 lines) with tokens + components + dark mode |
| `src/ts/main.ts` | Orchestrator — DOM bindings, event listeners, sidebar toggle, export logic |
| `src/ts/modes/normalMode.ts` | Normal (single-panel) mode logic |
| `src/ts/modes/compareMode.ts` | Compare mode logic |
| `src/ts/modes/floodRiskMode.ts` | Flood risk mode logic |
| `src/ts/state/mapState.ts` | Centralized state store |
| `src/ts/ui/chart.ts` | Plotly chart rendering |
| `src/ts/ui/progress.ts` | Progress/error modal management |
| `src/ts/ui/gifPlayer.ts` | GIF animation frame player |
| `src/ts/ui/fieldErrors.ts` | Inline field error validation |
| `src/ts/map/overlays.ts` | Leaflet overlay + colorbar management |
| `src/ts/listeners/variableListeners.ts` | Variable selector event wiring |
| `src/ts/apiClient.ts` | Backend API calls |
| `src/ts/config.ts` | Constants (years, seasons, endpoints) |
| `src/ts/types.ts` | TypeScript type definitions |

---

## 1. Current UX/UI Problems (Diagnosis)

### 1.1 Hierarchy and Composition
- **No top bar / app shell**: The app has only a sidebar + map area. There's no persistent topbar identifying the application, showing current state, or providing global navigation. The "Visor meteorológico" title only appears inside the sidebar header — invisible when collapsed.
- **Flat visual hierarchy**: The sidebar treats everything equally: 5 variable accordions sit at the same level as mode toggles, flood risk checkboxes, and station selectors. The eye doesn't know where to land first.
- **No clear "hero" area**: The map fills most space but has no overlay branding, current-variable indicator, or contextual controls — it's just a raw Leaflet canvas with Draw controls and colorbars.

### 1.2 Density and Cognitive Overload
- **Sidebar overload**: The sidebar packs ~5 variable selectors (each with year + season + generate button), 16 flood-municipality checkboxes, 2 station selectors, 3 mode/action buttons, and status text into a single 320px column. Every `<details>` section shows the same "Dibuja un rectángulo..." hint, creating visual noise.
- **Repetitive instruction text**: The same 3-step hint ("1) Dibuja... 2) Elige... 3) Pulsa...") appears 5 times — once per variable. This is a task flow that should be communicated ONCE.
- **No progressive disclosure**: All controls are always visible (just collapsed via `<details>`). There's no guided flow from "select area" → "choose variable" → "view results."

### 1.3 Discoverability and Task Flow
- **Drawing a bbox is the first step but is never prominently cued**: A small status bar says "Dibuja un rectángulo en el mapa" but it's buried among controls. The Leaflet Draw toolbar (top-left) is unstyled and uses default icons.
- **Mode switching is confusing**: Compare and Flood Risk modes are toggled via buttons in the sidebar. When activated, they disable/banish other controls with opacity:0.45 and display:none — no transition, no explanation of what changed, no undo affordance beyond the toggle button.
- **Chart and export actions are hidden**: The export toolbar only appears when data exists (via `.can-export` CSS class), and it's embedded INSIDE the chart container, competing for space with the chart itself and compare-mode controls.

### 1.4 Separation of Concerns (Config vs Analysis vs Export)
- **Configuration, analysis results, and export actions are all mixed**: The sidebar is configuration-only but also contains the Limpiar button (which should be contextual to results). The chart area contains both the chart AND the export toolbar AND compare-mode controls. There is no clear "analysis workspace" concept.

### 1.5 Legend/Overlay Legibility
- **Colorbars are generic Leaflet controls**: They show in the top-right with a tiny toggle button (22px) and no title label. The NDVI colorbar labels include paragraph-long descriptions ("0.5-0.8 Vegetación densa, salud vegetal alta") that are hard to read at 12px font.
- **No date/frame indicator on the map**: When a GIF animation plays, there's no on-map label showing the current date. The only indicator is the player bar at the bottom showing "0/0" frame numbers.
- **Mode banners are fixed-position overlays**: They slide down from top but are disconnected from any persistent navigation.

### 1.6 Spatial Use and Coherence
- **Chart takes fixed flex:3 space**: Regardless of whether the user wants to see more map or more chart, the split is always 7:3. No resize handle, no collapse/expand toggle.
- **Compare mode doubles everything awkwardly**: Two map panels side by side, each with their own chart container, plus compare controls crammed into each chart area. The player controls float absolute at the bottom of the map area.
- **Map/chart/action relationship is implicit**: The user must mentally connect "I selected NDVI in the sidebar" → "the map shows the NDVI animation" → "the bottom chart shows the NDVI timeseries" → "the export button (if visible) exports NDVI data". There are no visual connections or labels reinforcing this pipeline.

---

## 2. What This Product SHOULD Feel Like

This is a **geospatial analytical tool** — its closest cousins are Google Earth Engine, Sentinel Hub, or Copernicus Data Browser. The experience should feel:

- **Professional and purposeful**: Clean surfaces, breathable spacing, clear task progression. Not a "student project with all controls on screen."
- **Map-first**: The map is the primary canvas. Everything else supports what happens ON the map. The sidebar should feel like a tool palette that you consult, not a control panel you're trapped in.
- **Guided but not patronizing**: Step indicators and contextual states (e.g., "Draw an area to begin") should feel like a helpful guide, not a wall of text.
- **Scientific but accessible**: Legible legends, clear units, properly formatted dates, color-coded variables. The "research" feel without the "ugly academia" feel.
- **State-aware**: The UI should visually communicate what mode you're in, what variable is active, what data is loaded, and what the next available action is — through color, iconography, and status indicators, not just text.

---

## 3. Main Screen Reorganization

### Proposed Layout (top to bottom, left to right)

```
┌──────────────────────────────────────────────────────────────┐
│ TOPBAR: Logo | App Title | Active Variable Pill | Mode Pill │
│         | Session Status | [?] Help | [☰ Menu]             │
├──────────┬───────────────────────────────────────────────────┤
│ SIDEBAR  │  MAP CANVAS                                      │
│ (320px,  │  ┌─────────────────────────────────────────┐      │
│ collap-  │  │  Variable Overlay Label (top-left)      │      │
│ sible)   │  │  BBOX outline + date label               │      │
│          │  │                                         │      │
│ ┌──────┐ │  │     [Leaflet Map]                       │      │
│ │Step 1│ │  │                                         │      │
│ │ Area │ │  │              Colorbar (top-right)       │      │
│ ├──────┤ │  │                                         │      │
│ │Step 2│ │  │  Station markers                       │      │
│ │ Var  │ │  │                                         │      │
│ ├──────┤ │  └─────────────────────────────────────────┘      │
│ │Step 3│ │  ┌─────────────────────────────────────────┐    │
│ │ Gen  │ │  │  CHART PANEL (collapsible)               │    │
│ └──────┘ │  │  [Plotly chart]                          │    │
│          │  │  ═══════════════════════════════════════  │    │
│ ┌──────┐ │  │  EXPORT BAR: [Mode: ▼] [Export] [PDF]   │    │
│ │Mode  │ │  └─────────────────────────────────────────┘    │
│ │toggl.│ │                                                 │
│ └──────┘ │  PLAYER CONTROLS (when animation active)         │
│          │                                                 │
│ ┌──────┐ │                                                 │
│ │Statio│ │                                                 │
│ └──────┘ │                                                 │
└──────────┴─────────────────────────────────────────────────┘
```

**Key changes**:
1. **Add a topbar**: Thin (~48px) persistent bar with logo, app title, active variable pill, current mode indicator, help button. This replaces the sidebar header and provides always-visible branding.
2. **Sidebar becomes a task-stepped panel**: Sections are numbered and ordered as Step 1 (Area), Step 2 (Variable), Step 3 (Generate). Not 5 flat accordions.
3. **Chart becomes a resizable bottom panel**: Instead of flex:3, the chart panel becomes a draggable-resizable or toggle-collapse panel. Can be minimized to just the export bar.
4. **Export bar separates from chart**: Move export controls into their own strip between chart and map, or into the topbar as action buttons.
5. **Mode toggles become sidebar section**: Compare and Flood Risk go into a "Mode" section with clear toggle UX, not inline buttons competing with action buttons.

---

## 4. Lateral Panel (Sidebar) Redesign

### Current problems
- 5 variable `<details>` sections at the same level — repetitive, flat
- Mode toggles mixed with variables — no visual grouping
- Station selectors disconnected from the main flow
- "Limpiar" button buried between mode toggles
- Status bar text changes but is hard to notice

### Proposed sidebar structure

```
┌─────────────────────────┐
│ ✕ (collapse)            │  ← sidebar header (minimal)
├─────────────────────────┤
│ ┌─ PASO 1: Área ──────┐ │
│ │ ● Área seleccionada  │ │  ← status chip (green dot = done)
│ │   17.5°, -92.5°…     │ │  ← coordinate preview
│ │   [Limpiar área]      │ │  ← only appears after selection
│ └───────────────────────┘ │
│                           │
│ ┌─ PASO 2: Variable ───┐ │
│ │ [NDVI] [Temp] [Soil] │ │  ← tab/chip selector, not accordions
│ │ [Precip] [Water]      │ │
│ │                       │ │
│ │ Año: [▼ 2024]        │ │  ← only after Step 1
│ │ Temporada: [▼ Verano] │ │
│ │                       │ │
│ │ [▸ Generar animación] │ │  ← primary CTA, prominent
│ └───────────────────────┘ │
│                           │
│ ┌─ PASO 3: Explorar ──┐ │
│ │ ☐ San Pedro (SPTTB)  │ │  ← station checkboxes
│ │ ☐ Boca del Cerro      │ │
│ │                       │ │
│ │ 💾 Exportar análisis   │ │  ← link to results/export
│ │ 📄 Exportar PDF        │ │
│ └───────────────────────┘ │
│                           │
│ ┌─ MODO ───────────────┐ │
│ │ [🔲 Comparar años]   │ │  ← mode toggle chips
│ │ [🌊 Mapa de riesgo]  │ │
│ └───────────────────────┘ │
└─────────────────────────┘
```

**Key principles**:
1. **Numbered steps** with visual state (incomplete → complete → active)
2. **Variable selection as tabs/chips**, not 5 separate accordions — eliminates 80% of sidebar height
3. **Conditional visibility**: Year/season controls only appear after area is selected. Generate button only enables after both are set.
4. **Progressive disclosure**: Hint text appears ONCE in Step 1, not duplicated 5 times.
5. **Separate Mode section**: Mode toggles are clearly labeled and visually distinct from the main workflow.

---

## 5. Map Experience Improvements

### 5.1 Overlays and Legend
- **Colorbar redesign**: Replace the current `topright` Leaflet control with a floating, collapsible legend panel that includes: variable name, unit, current color scale, AND current date/frame label.
- **Alpha control**: Add a small opacity slider next to the colorbar so users can blend the overlay with the base map.
- **BBOX feedback**: After drawing, show the bounding box coordinates as a small label attached to the rectangle (like GeoJSON.io does). Persist the rectangle outline in a highlighted color.

### 5.2 Date/Frame Labels on Map
- **Add a date overlay**: When a GIF animation plays, display the current frame's date on the map itself (top-left, below the variable label). This is critical for understanding temporal data.
- **Sync viewer**: In compare mode, show "Período A: YYYY" and "Período B: YYYY" labels on each map panel.

### 5.3 Hierarchy of Map Base vs Analysis Layer vs Floating UI
- **Base map**: Always visible, never occluded. A clean tile layer (consider switching from default OpenStreetMap to a lighter/muted basemap like CartoDB Positron or Stamen Terrain).
- **Analysis overlay**: GIF animation layer sits above the base map with adjustable opacity. BBOX rectangle sits above the overlay.
- **Floating UI**: Station markers, colorbar, variable label, date label sit above everything. Mode banner sits below the topbar, NOT as a fixed overlay that pushes content.

### 5.4 Leaflet Draw Customization
- Style the Draw toolbar buttons to match the app's visual system (replace default Leaflet icons with custom SVGs or icon font icons).
- Add a tooltip/help on the Draw tool that says "Dibujá un rectángulo para seleccionar un área de análisis".

---

## 6. Temporal Chart Experience Improvements

### 6.1 Persistent vs Expandable
- **Current**: Chart is always flex:3 → fixed height, no resize.
- **Proposed**: Chart panel starts collapsed (just a thin strip with the export bar). When data is loaded, it auto-expands to a comfortable height (~300px). User can drag to resize or click to maximize (overlay mode covering ~70% of the map area).
- **Rationale**: For a geospatial tool, the MAP is primary. Users should have maximum map space until they explicitly want to inspect the time series.

### 6.2 Relation to Map
- **Hover sync**: When hovering over a point on the chart's x-axis, highlight the corresponding date on the map animation (seek to that frame). This creates a tangible connection between chart and map.
- **Chart header**: Add a small header strip above the chart showing: active variable name, active period, station names (if any). This replaces the disconnected mental model.

### 6.3 Anomalies and Events
- **Band annotations**: Add configurable reference bands (e.g., "climatological mean ± σ") as horizontal bands on the chart.
- **Event markers**: Allow users to hover and see anomaly context (e.g., dates where values exceed 2σ from mean).
- **This is a medium-long term feature**: Not MVP, but the chart component should be designed to accommodate it.

### 6.4 Controls
- **Chart controls**: The current Plotly chart has minimal customization. Add:
  - Y-axis range selector (auto/fixed)
  - Toggle individual series visibility
  - Hover tooltip enhancement (show both variable value and date in a formatted card, not just raw Plotly default)

---

## 7. Visual System

### 7.1 Typography
- **Use a system font stack** (already done: `system-ui, -apple-system, ...`) — GOOD. Keep it.
- **Scale**: Current scale is too compressed. Sidebar text at 0.8-0.9rem is borderline. Increase to 0.875rem for hints, 0.9375rem for body, 1rem for labels.
- **Weight hierarchy**: Use 3 tiers max: 400 (body), 500 (labels, buttons), 700 (headings, active states). Currently uses 400/500/600 which is too subtle.

### 7.2 Density
- **Sidebar**: Increase vertical spacing between major groups from `var(--space-3)` to `var(--space-5)`. Reduce density within each step.
- **Map area**: The chart:map split should be adjustable, not fixed 7:3.
- **Controls**: Button padding should be generous (current `var(--space-3) var(--space-4)` is acceptable but could benefit from `0.625rem 1rem` for hit target reasons).

### 7.3 Color
- **Current**: Uses `--sky-500` (#0369a1) as the single accent. This is a GOOD blue — professional, accessible. Keep it.
- **Missing**: A semantic color system for states (success=green for "area selected", warning=amber for "generating", danger=red for "error"). Currently the status bar uses custom classes but the modal system uses hardcoded colors.
- **Recommendation**: Extend the token system with:
  - `--status-success` → green
  - `--status-warning` → amber
  - `--status-danger` → red
  - `--status-info` → sky-500 (current accent)

### 7.4 Surfaces and Elevation
- **Sidebar**: Already uses `box-shadow: 2px 0 6px rgba(0,0,0,0.08)` — good. Keep.
- **Modals**: Currently use `fixed` positioning and opaque black backgrounds. Recommend changing to a proper overlay system with backdrop blur and centered card (Material/Apple style).
- **Export toolbar**: Already uses `backdrop-filter: var(--export-toolbar-blur)` — good start. Extend this glass-morphism approach to other floating elements (mode banners, colorbar).

### 7.5 Borders
- **Current**: `--gray-200` borders everywhere. Too uniform. Recommend:
  - Thin separators (1px, `--gray-200`) inside sidebar
  - No borders on cards/panels — use elevation instead
  - Stronger border (2px, `--sky-500`) on active/selected states

### 7.6 Iconography
- **Current**: Mix of inline SVGs and emoji (📊). Replace all emoji with SVG icons.
- **Recommendation**: Use a consistent icon set. Lucide icons (already using their SVG style for menu/close/toggle buttons) would be ideal since they're lightweight and the existing SVGs already follow that style.

### 7.7 Contrast and Accessibility
- **Current**: Some accessibility issues:
  - `.hint` text at `--text-sm` + `--gray-400` is low contrast (4.5:1 requirement not met on all backgrounds)
  - Disabled buttons at `opacity: 0.8` + `--gray-300` text are nearly invisible
  - The player controls at the bottom of the map have `--gray-400` labels that are too faint
- **Fix**: Minimum text contrast of 4.5:1 (WCAG AA). Increase hint text to `--gray-500` on light backgrounds. Give disabled controls a visible (not just faded) state.

---

## 8. Highest-Impact / Lowest-Risk UX Improvements

| # | Improvement | Impact | Risk | Effort |
|---|------------|--------|------|--------|
| 1 | **Sidebar step-based layout** (reduce 5 accordions → tab/chip variable selector + numbered steps) | 🔴 Very High | 🟢 Low | Medium |
| 2 | **Add topbar** (logo, title, active variable, mode indicator) | 🔴 High | 🟢 Low | Medium |
| 3 | **Chart panel toggle** (collapse/expand instead of fixed flex:3) | 🟡 High | 🟢 Low | Low |
| 4 | **Remove duplicated hint text** (show task flow hint once, not 5 times) | 🟡 Medium | 🟢 Low | Low |
| 5 | **Status bar improvements** (visual state chips instead of text) | 🟡 Medium | 🟢 Low | Low |
| 6 | **Date overlay on map** (show current animation date) | 🔴 Very High | 🟡 Medium | Medium |
| 7 | **Export bar separation** (move out of chart container, into its own strip) | 🟡 Medium | 🟢 Low | Low |
| 8 | **Dark mode polish** (fix contrast issues in dark mode for modals, colorbars, disabled states) | 🟡 Medium | 🟢 Low | Low |
| 9 | **Leaflet Draw toolbar styling** (custom icons, tooltip on hover) | 🟢 Low | 🟢 Low | Low |
| 10 | **API-driven variable chip selector** (replace 5 `<details>` with JS-driven chip group) | 🟡 High | 🟡 Medium | Medium |

---

## 9. What to EXCLUDE from MVP UX/UI Overhaul

| Exclusion | Reason |
|-----------|--------|
| **Chart hover-sync with map** | Complex interaction requiring new state bridges between Plotly and Leaflet. High risk of bugs. |
| **Anomaly band annotations** | Requires statistical compute on backend (mean/σ per variable per area). Out of scope for UI overhaul. |
| **Resizable chart via drag handle** | Interaction complexity with Plotly layout recalculation. Better as a separate change. |
| **Basemap switcher** | Nice-to-have, but switching tile layers is cosmetic, not structural. |
| **i18n framework** | Current Spanish-language UI works. Internationalization requires a full architecture decision. |
| **Compare mode panel redesign** | Compare mode has complex state (2 maps, 2 charts, synchronized player). Restructuring it is a separate change. |
| **Backend API changes** | UI overhaul should not require new endpoints or modified responses. |
| **PWA/offline support** | Out of scope. |
| **Testing framework changes** | Current Vitest + Playwright setup is sufficient. |

---

## 10. Frontend Files/Layers Affected

| Layer | Files | Change Type |
|-------|-------|-------------|
| **HTML Template** | `templates/index.html` | Major restructure: add topbar, rewrite sidebar to step-based layout, separate chart panel, restructure export bar |
| **CSS** | `static/styles.css` | Major: new component styles (topbar, step-flow, chips, status-chips, chart-panel-strip), rewrite sidebar layout, chart panel collapse, dark mode fixes |
| **Main Orchestrator** | `src/ts/main.ts` | Moderate: wire new topbar state, step-flow interaction, chart toggle, export bar relocation |
| **Mode Modules** | `src/ts/modes/normalMode.ts`, `compareMode.ts`, `floodRiskMode.ts` | Moderate: adapt to new sidebar step flow, update mode toggling to new UI elements |
| **State** | `src/ts/state/mapState.ts` | Minor: may need new state fields (activeStep, chartCollapsed) |
| **Chart** | `src/ts/ui/chart.ts` | Minor: chart header styling, no behavioral change |
| **Overlays** | `src/ts/map/overlays.ts` | Moderate: redesign colorbar component, add date overlay |
| **UI Components** | `src/ts/ui/progress.ts`, `fieldErrors.ts` | Minor: progress indicator styling |
| **Config** | `src/ts/config.ts` | None (no UI roles) |
| **Types** | `src/ts/types.ts` | None (no UI roles) |
| **Asset** | `static/assets/branding/` | May need additional icons for topbar, step indicators, chip component |

---

## 11. Recommendation: Split Strategy

### This should be **3 SDD changes**, not 1.

Rationale: A single "overhaul everything" change would be 800+ lines of CSS + HTML restructure + JS orchestration wiring. It violates the 400-line review budget and makes rollback extremely costly. Each change below has a clear start, clear finish, and can be verified independently.

#### Change A: `ux-sidebar-task-flow` (Foundation)
**Scope**: Restructure the sidebar into a numbered step-based flow with variable chip selector. Remove duplicated hint text. Add visual state chips for bbox status.

- **Files**: `templates/index.html`, `static/styles.css`, `src/ts/main.ts`, `src/ts/modes/normalMode.ts`
- **Estimated effort**: ~350-400 lines
- **Risk**: Medium (sidebar restructure touches event wiring)
- **Value**: Highest — this is the single most impactful change for UX

#### Change B: `ux-topbar-and-map-overlays` (Shell + Map)
**Scope**: Add persistent topbar with app title, active variable, and mode indicator. Add animation date overlay on map. Style the Leaflet Draw toolbar. Separate export bar from chart container. Improve colorbar with title labels.

- **Files**: `templates/index.html`, `static/styles.css`, `src/ts/main.ts`, `src/ts/map/overlays.ts`, `src/ts/ui/progress.ts`
- **Estimated effort**: ~300-350 lines
- **Risk**: Low-Medium (new elements, minimal restructure of existing)
- **Value**: High — visible polish and professionalism

#### Change C: `ux-chart-panel-and-darkmode` (Chart + Polish)
**Scope**: Make chart panel collapsible/expandable (instead of fixed flex:3). Fix dark mode contrast issues across all components. Fix accessibility (hint contrast, disabled states). Replace emoji icons with SVG. Standardize modals.

- **Files**: `static/styles.css`, `src/ts/main.ts`, `src/ts/ui/progress.ts`, minor touches in mode files
- **Estimated effort**: ~250-300 lines
- **Risk**: Low (mostly CSS, chart toggle is isolated)
- **Value**: High — polish and accessibility

### Dependency chain
- **A** → **B** → **C** (sequential, since B builds on A's sidebar structure, and C benefits from B's topbar)
- Or **A** + **B** in parallel, then **C** (if review capacity allows)

### Why NOT a single change?
1. **Review budget**: 800+ lines exceeds the 400-line guard by 2x.
2. **Rollback safety**: If the sidebar restructure has a bug, the topbar and chart changes shouldn't need to be reverted.
3. **Incremental value**: Even Change A alone delivers massive UX improvement. The user doesn't have to wait for B+C.
4. **Testing**: Each change can be visually verified independently without cross-contamination.