// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { muniKey, type MunicipalityFeature } from '../../src/ts/map/floodRiskLayer.js';

// Resolved from this file so the test does not depend on the working directory.
const TEMPLATE = fileURLToPath(new URL('../../templates/index.html', import.meta.url));
const MUNICIPALITIES = fileURLToPath(
  new URL('../../../backend/data/flood_risk/municipalities.geojson', import.meta.url)
);

describe('sidebar municipality list', () => {
  it('matches every sidebar button to one published municipality', () => {
    const html = readFileSync(TEMPLATE, 'utf8');
    const buttons = [
      ...html.matchAll(/class="flood-muni-btn" data-muni="([a-z_]+)"/g),
    ].map(m => m[1]);
    const published = (
      JSON.parse(readFileSync(MUNICIPALITIES, 'utf8')) as {
        features: MunicipalityFeature[];
      }
    ).features.map(f => muniKey(f.properties.name));
    expect(buttons).toHaveLength(17);
    expect([...buttons].sort()).toEqual([...published].sort());
  });
});
