// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStyleBundle } from '../../scripts/bundle-styles.mjs';

const html = readFileSync('frontend/templates/index.html', 'utf8');
const css = readStyleBundle().css;

describe('index.html inline styles', () => {
  it('keeps only the icon-sun inline style that prevents a flash before CSS loads', () => {
    const inline = html.match(/style="[^"]*"/g) ?? [];
    expect(inline).toEqual(['style="display: none;"']);
    expect(html).toMatch(/class="icon-sun"[^>]*style="display: none;"/);
  });

  it.each([
    '.sidebar-header-bottom-row .sidebar-title',
    '#themeToggle',
    '#tflow-draw-container',
    '#tflow-draw-btn',
    '.tflow-station-group.tflow-station-group--separated',
    '#inundaciones-panel .inund-control',
    '#inund-satellite-hint',
    '#inund-btn-process',
  ])('styles.css defines the rule for %s', selector => {
    expect(css).toContain(`${selector} {`);
  });
});
