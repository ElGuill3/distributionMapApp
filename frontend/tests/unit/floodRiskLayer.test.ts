import { describe, it, expect } from 'vitest';
import {
  tilePixel,
  classFromRgba,
  findMunicipality,
  muniKey,
  highShareClass,
  municipalityCardHtml,
  type FloodClass,
  type MunicipalityFeature,
} from '../../src/ts/map/floodRiskLayer.js';

const CLASSES: FloodClass[] = [
  { value: 1, label: 'Muy baja', color: '#ffffcc' },
  { value: 2, label: 'Baja', color: '#a1dab4' },
  { value: 3, label: 'Media', color: '#41b6c4' },
  { value: 4, label: 'Alta', color: '#2c7fb8' },
  { value: 5, label: 'Muy alta', color: '#253494' },
];

const square = (x0: number, y0: number, size: number): number[][] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
  [x0, y0],
];

function feature(
  name: string,
  geometry: MunicipalityFeature['geometry']
): MunicipalityFeature {
  return {
    type: 'Feature',
    geometry,
    properties: {
      name,
      code: 1,
      area_km2: 100,
      class_share: [0.1, 0.1, 0.2, 0.3, 0.3],
      high_share: 0.6,
      mean_score: 0.65,
      rank: 3,
    },
  };
}

describe('tilePixel', () => {
  it('places the map origin at the corner of the four zoom-1 tiles', () => {
    expect(tilePixel(0, 0, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 });
  });

  it('matches the XYZ tile used by the pipeline for Villahermosa at z12', () => {
    // floor((-92.93 + 180) / 360 * 4096) = 990
    const pixel = tilePixel(17.99, -92.93, 12);
    expect(pixel.x).toBe(990);
    expect(pixel.px).toBeGreaterThanOrEqual(0);
    expect(pixel.px).toBeLessThan(256);
    expect(pixel.py).toBeLessThan(256);
  });
});

describe('classFromRgba', () => {
  it('maps each palette colour to its class', () => {
    expect(classFromRgba([37, 52, 148, 255], CLASSES)?.label).toBe('Muy alta');
    expect(classFromRgba([255, 255, 204, 255], CLASSES)?.value).toBe(1);
  });

  it('returns null for transparent pixels and unknown colours', () => {
    expect(classFromRgba([37, 52, 148, 0], CLASSES)).toBeNull();
    expect(classFromRgba([200, 0, 0, 255], CLASSES)).toBeNull();
  });
});

describe('findMunicipality', () => {
  const holed = feature('Con hueco', {
    type: 'Polygon',
    coordinates: [square(0, 0, 10), square(4, 4, 2)],
  });
  const multi = feature('Islas', {
    type: 'MultiPolygon',
    coordinates: [[square(20, 0, 2)], [square(30, 0, 2)]],
  });

  it('finds the polygon that contains the point', () => {
    expect(findMunicipality(1, 1, [holed, multi])?.properties.name).toBe('Con hueco');
    expect(findMunicipality(31, 1, [holed, multi])?.properties.name).toBe('Islas');
  });

  it('respects holes and returns null outside every polygon', () => {
    expect(findMunicipality(5, 5, [holed, multi])).toBeNull();
    expect(findMunicipality(-5, -5, [holed, multi])).toBeNull();
  });
});

describe('muniKey', () => {
  it('matches the sidebar data-muni keys', () => {
    expect(muniKey('Jalpa De Méndez')).toBe('jalpa_de_mendez');
    expect(muniKey('Cárdenas')).toBe('cardenas');
    expect(muniKey('Emiliano Zapata')).toBe('emiliano_zapata');
  });
});

describe('highShareClass', () => {
  it('bins the share of high susceptibility into five equal steps', () => {
    expect(highShareClass(0)).toBe(1);
    expect(highShareClass(0.19)).toBe(1);
    expect(highShareClass(0.2)).toBe(2);
    expect(highShareClass(0.84)).toBe(5);
    expect(highShareClass(1)).toBe(5);
  });
});

describe('municipalityCardHtml', () => {
  it('shows rank, high share and every class share', () => {
    const html = municipalityCardHtml(
      feature('Centro', square(0, 0, 1) as never).properties,
      CLASSES,
      17
    );
    expect(html).toContain('Centro');
    expect(html).toContain('3 de 17');
    expect(html).toContain('60%');
    for (const cls of CLASSES) expect(html).toContain(cls.label);
  });

  it('escapes the municipality name', () => {
    const props = {
      ...feature('x', square(0, 0, 1) as never).properties,
      name: '<img onerror=1>',
    };
    expect(municipalityCardHtml(props, CLASSES, 17)).not.toContain('<img');
  });
});
