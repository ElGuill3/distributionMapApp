# Tasks: ui-theme-toggle-button

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 120–180 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | ask-on-risk |

## Task List

### Phase 1: CSS Refactoring & HTML Insertion
- [ ] Task 1.1: Insert `#themeToggle` button in `templates/index.html`.
- [ ] Task 1.2: Add CSS rules for `.theme-toggle-btn` and icons toggle visibility in `static/styles.css`.
- [ ] Task 1.3: Update and group existing `@media (prefers-color-scheme: dark)` overrides in `static/styles.css` with `:root[data-theme="dark"]` selectors.

### Phase 2: Logic Integration
- [ ] Task 2.1: Add `isDarkModeActive` utility and window event listener for `'theme-change'` in `src/ts/ui/chart.ts`.
- [ ] Task 2.2: Refactor trace and layout styling in `plotAllSelectedSeries` to call `isDarkModeActive()` instead of the raw media query matcher.
- [ ] Task 2.3: Wire the `#themeToggle` click handler in `src/ts/main.ts` to toggle the attribute and dispatch `'theme-change'`.

### Phase 3: Verification
- [ ] Task 3.1: Run TypeScript compiler validation (`npm run build:ts`).
- [ ] Task 3.2: Run unit test suites (`npm run test`).
- [ ] Task 3.3: Run Playwright tests (`npm run test:e2e`).
