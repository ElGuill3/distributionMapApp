# SDD Explore: ui-theme-toggle-button

## Objective
Analyze the codebase to locate:
1. The markup where the theme switcher button can be integrated.
2. The CSS rules that need updating to support manual theme overrides using a `data-theme` attribute on `:root`.
3. The JS/TS files where the theme state and click handler should be managed.

## Discoveries

### 1. HTML Markup
- The sidebar header (`templates/index.html`, lines 51-86) contains the branding section and `sidebarToggle` close button.
- A theme button (`themeToggle`) can be placed right before `sidebarToggle` inside the sidebar header.

### 2. CSS Dark Mode Rules
- Currently, dark mode variables and styling overrides are governed purely by `@media (prefers-color-scheme: dark)`.
- We can rewrite these queries to also match when `:root[data-theme="dark"]` is set, and to ignore `@media (prefers-color-scheme: dark)` if `:root[data-theme="light"]` is explicitly defined.
- Grouping selectors like `:root[data-theme="dark"], @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` provides clean, dry, zero-duplication style definitions.

### 3. JS/TS Theme Controller
- We can implement a simple theme controller inside a new module `src/ts/ui/theme.ts` or inside `src/ts/main.ts` that:
  - Toggles the `data-theme` attribute between `light` and `dark`.
  - Dispatches a custom event `'theme-change'` on `window` so that the Plotly chart module (`src/ts/ui/chart.ts`) is notified and triggers a redraw of the active charts.
  - Ensures a consistent dark mode check utility:
    ```typescript
    export function isDarkModeActive(): boolean {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    ```
- Let's update `src/ts/ui/chart.ts` to call this `isDarkModeActive()` utility and listen to `theme-change` window events.
