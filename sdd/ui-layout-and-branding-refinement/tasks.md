# Tasks: UI Layout and Branding Refinement

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80–120 lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Asset Preparation

- [ ] 1.1 Crop original wide logo to icon-only 3D block, save as `static/assets/branding/logo-icon.webp` (≥96×96px source, containing only the recognizable block)

## Phase 2: CSS Token Foundation

- [ ] 2.1 Add sidebar layout rhythm tokens to `:root` in `static/styles.css`: `--sidebar-header-gap: var(--space-5)`, `--sidebar-group-header-bg`, `--sidebar-group-header-padding: var(--space-2) var(--space-3)`
- [ ] 2.2 Add chart placeholder weight tokens: `--chart-placeholder-min-height: 120px`, `--chart-placeholder-border-width: 1px`, `--chart-placeholder-icon-size: 1.5rem`
- [ ] 2.3 Add export toolbar floating strip tokens: `--export-toolbar-blur: blur(4px)`, `--export-toolbar-shadow`, `--export-toolbar-bg: rgba(248, 249, 251, 0.85)`
- [ ] 2.4 Add colorbar toggle token consistency: `--colorbar-toggle-size: 22px`, `--colorbar-toggle-radius: var(--radius-sm)`
- [ ] 2.5 Add dark mode overrides for new tokens (`@media (prefers-color-scheme: dark)`)

## Phase 3: HTML Template Updates

- [ ] 3.1 In `templates/index.html`: update logo `<img>` src to `logo-icon.webp`, set `width="40" height="44"`, add `style="object-fit: contain;"`
- [ ] 3.2 Update `h1` to include `style="font-weight: 600;"`
- [ ] 3.3 Reduce close button from 40×40px to 36×36px

## Phase 4: Component Restyles (`static/styles.css`)

- [ ] 4.1 Restyle `.sidebar-header`: increase gap to `--sidebar-header-gap`, logo container 48×48px with `--logo-container-bg` + `--radius-md`, close button 36×36px
- [ ] 4.2 Apply 3-tier spacing rhythm to `.sidebar-group`: Tier 1 `--space-5` between major sections, Tier 2 `--sidebar-group-gap` between groups, Tier 3 `--space-2` within groups
- [ ] 4.3 Restyle `.sidebar-group-header`: `--sidebar-group-header-bg` tint, `--radius-sm`, `--sidebar-group-header-padding`
- [ ] 4.4 Update `.sidebar-brand-logo-container` from 64×64px to logo icon display size (48×48px container, 40×44px img via tokens)
- [ ] 4.5 Lighten chart placeholder: `--chart-placeholder-fg` → `--gray-300`, `min-height: 120px`, border `1px dashed`, icon `1.5rem`
- [ ] 4.6 Restyle `#export-toolbar` as floating strip: add `backdrop-filter: blur(4px)`, use `--export-toolbar-bg`, replace `border-bottom` with `--export-toolbar-shadow`
- [ ] 4.7 Add status bar contextual shrink states (selected state: thin 2–4px accent line instead of full text)
- [ ] 4.8 Token-consistent colorbar toggle: `--colorbar-toggle-size: 22px`, `--colorbar-toggle-radius: var(--radius-sm)` (CSS only — remove hardcoded values)

## Phase 5: Verification

- [ ] 5.1 Visual: verify logo proportions (40×44px), spacing rhythm, group differentiation at 320px and 1440px widths
- [ ] 5.2 Dark mode: toggle system preference, verify dark token overrides apply correctly
- [ ] 5.3 Responsive: sidebar layout at min/max widths via browser devtools device emulation
- [ ] 5.4 Accessibility: Lighthouse audit for color contrast and touch target sizes