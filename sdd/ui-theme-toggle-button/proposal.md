# SDD Proposal: ui-theme-toggle-button

## Intent
Add a manual theme switcher button inside the sidebar header. It will allow users to force light or dark mode while falling back to the system's preferred color scheme by default.

## Requirements
- **Theme Button Integration**: A button with sun (visible in dark mode) and moon (visible in light mode) icons in the sidebar header next to the close sidebar button.
- **Dynamic Mode overrides**: Manual selection overrides the system scheme. Setting the theme must trigger a full page re-theme without reloading.
- **Plotly Chart Updates**: Activating the toggle must immediately trigger a theme redraw of all plotted Plotly charts.
- **Accessibility**: Include correct aria-label and title attributes.

## Technical Approach
1. **Markup Addition**:
   Add `#themeToggle` button to `templates/index.html` sidebar header.
2. **CSS Overrides Update**:
   Update `@media (prefers-color-scheme: dark)` references in `static/styles.css` to support `:root[data-theme="dark"]` and exclude `:root[data-theme="light"]`.
3. **Chart Module Update**:
   Update `src/ts/ui/chart.ts` to query `isDarkModeActive()` instead of raw media queries, and register a listener for `'theme-change'` window event to redraw.
4. **Main JS/TS Wiring**:
   In `src/ts/main.ts` (or a dedicated `theme.ts` file), bind the click handler of `#themeToggle` to:
   - Read the current theme.
   - Toggle the `data-theme` attribute on `document.documentElement` to the opposite.
   - Dispatch `window.dispatchEvent(new Event('theme-change'))`.
