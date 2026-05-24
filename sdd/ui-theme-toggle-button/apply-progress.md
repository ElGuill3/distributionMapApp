# SDD Apply Progress: ui-theme-toggle-button

## Task Status

### Phase 1: CSS Refactoring & HTML Insertion
- [x] Task 1.1: Insert `#themeToggle` button in `templates/index.html`.
- [x] Task 1.2: Add CSS rules for `.theme-toggle-btn` and icons toggle visibility in `static/styles.css`.
- [x] Task 1.3: Update and group existing `@media (prefers-color-scheme: dark)` overrides in `static/styles.css` with `:root[data-theme="dark"]` selectors.

### Phase 2: Logic Integration
- [x] Task 2.1: Add `isDarkModeActive` utility and window event listener for `'theme-change'` in `src/ts/ui/chart.ts`.
- [x] Task 2.2: Refactor trace and layout styling in `plotAllSelectedSeries` to call `isDarkModeActive()` instead of the raw media query matcher.
- [x] Task 2.3: Wire the `#themeToggle` click handler in `src/ts/main.ts` to toggle the attribute and dispatch `'theme-change'`.

### Phase 3: Verification
- [x] Task 3.1: Run TypeScript compiler validation (`npm run build:ts`).
- [x] Task 3.2: Run unit test suites (`npm run test`).
- [x] Task 3.3: Run Playwright tests (`npm run test:e2e`).
