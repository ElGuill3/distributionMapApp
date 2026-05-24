# SDD Design: ui-theme-toggle-button

## Technical Details & Code Structure

### 1. HTML Insertion in `templates/index.html`
Place the button after `.sidebar-brand` (around line 63):

```html
      <header class="sidebar-header">
        <div class="sidebar-brand">
          <div class="sidebar-brand-logo-container">
            <img
              src="/static/assets/branding/logo-icon.webp"
              alt="Logo"
              width="40"
              height="44"
              style="object-fit: contain;"
            />
          </div>
          <h1 style="font-weight: 600;">Visor meteorológico</h1>
        </div>
        <button
          id="themeToggle"
          type="button"
          class="theme-toggle-btn"
          aria-label="Alternar modo claro u oscuro"
          title="Alternar modo claro u oscuro"
          style="width: 36px; height: 36px;"
        >
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display: none;">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        </button>
        <button
          id="sidebarToggle"
          type="button"
          aria-controls="control-sidebar"
          aria-expanded="true"
          style="width: 36px; height: 36px;"
        >
...
```

### 2. Styling Rules in `static/styles.css`
1. Define the theme toggle button styles:
```css
.theme-toggle-btn {
  background: transparent;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  color: var(--surface-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;
  flex-shrink: 0;
  margin-right: 8px;
}
.theme-toggle-btn:hover {
  background: var(--gray-50);
  border-color: var(--gray-300);
}
.theme-toggle-btn svg {
  width: 18px;
  height: 18px;
}

/* Visibility toggles based on theme state */
:root:not([data-theme="dark"]) .theme-toggle-btn .icon-sun {
  display: none !important;
}
:root:not([data-theme="dark"]) .theme-toggle-btn .icon-moon {
  display: block !important;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-toggle-btn .icon-sun {
    display: block !important;
  }
  :root:not([data-theme="light"]) .theme-toggle-btn .icon-moon {
    display: none !important;
  }
}

:root[data-theme="dark"] .theme-toggle-btn .icon-sun {
  display: block !important;
}
:root[data-theme="dark"] .theme-toggle-btn .icon-moon {
  display: none !important;
}

:root[data-theme="light"] .theme-toggle-btn .icon-sun {
  display: none !important;
}
:root[data-theme="light"] .theme-toggle-btn .icon-moon {
  display: block !important;
}
```

2. Group the existing dark mode `@media` blocks with `[data-theme="dark"]` selectors:
   - Root variables:
     ```css
     :root[data-theme="dark"],
     @media (prefers-color-scheme: dark) {
       :root:not([data-theme="light"]) {
         /* inversion tokens ... */
       }
     }
     ```
   - Leaflet/Topbar elements:
     ```css
     :root[data-theme="dark"] .map-overlay-topbar,
     @media (prefers-color-scheme: dark) {
       :root:not([data-theme="light"]) .map-overlay-topbar {
         background: rgba(17, 24, 39, 0.92);
         border-bottom-color: var(--gray-200);
       }
     }
     /* Repeated for date-label, leaflet-draw buttons, and draw tooltips */
     ```
   - Task flow block:
     ```css
     :root[data-theme="dark"] .tflow-modo-section,
     @media (prefers-color-scheme: dark) {
       :root:not([data-theme="light"]) .tflow-modo-section {
         background: var(--gray-100);
       }
     }
     ```

### 3. Chart Module Update in `src/ts/ui/chart.ts`
Implement and export the `isDarkModeActive()` utility, and replace references to raw media query checking:

```typescript
export function isDarkModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
```

Add listener for custom `'theme-change'` window event:
```typescript
if (typeof window !== 'undefined') {
  const redraw = () => {
    for (const [chartDiv, state] of activeCharts.entries()) {
      plotAllSelectedSeries(
        chartDiv,
        state.allSeries,
        state.onShow,
        state.onHide,
        state.onShowPlaceholder,
        state.onHidePlaceholder
      );
    }
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  window.addEventListener('theme-change', redraw);
}
```

### 4. Interactive Toggling in `src/ts/main.ts`
Bind click listener to `#themeToggle`:

```typescript
import { isDarkModeActive } from './ui/chart.js';

// Setup theme switcher
const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isDark = isDarkModeActive();
    const nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    window.dispatchEvent(new Event('theme-change'));
  });
}
```
