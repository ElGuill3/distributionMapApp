# SDD Spec: ui-theme-toggle-button

## Overview
This specification details the user experience, layout positioning, custom property overriding, and events triggered when toggling the theme manually.

## Functional Requirements

### 1. Header Integration
- A button `#themeToggle` must be injected inside `.sidebar-header` after `.sidebar-brand` and before `#sidebarToggle`.
- The button must display:
  - A moon icon (`.icon-moon`) when the active theme is light.
  - A sun icon (`.icon-sun`) when the active theme is dark.
- The button must have a clean hover effect and fit with the overall branding aesthetics.

### 2. State & Overrides
- **No preferences set**: The theme defaults to system preference via `@media (prefers-color-scheme: dark)`.
- **Light mode selected**: The root element has `data-theme="light"`. System prefers-color-scheme must be ignored.
- **Dark mode selected**: The root element has `data-theme="dark"`. System prefers-color-scheme must be ignored.
- Changing the selection must instantly trigger the class/attribute mutation on `html` and fire a `'theme-change'` window event.

### 3. Verification criteria
- Manual toggle shifts colors instantly across all UI panels.
- Plotly line colors, axes, grids, and legend text colors are recalculated and redrawn automatically without page reload or layout shifts.
