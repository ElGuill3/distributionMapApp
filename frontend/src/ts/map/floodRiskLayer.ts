/**
 * Pure helpers for the statewide flood susceptibility layer.
 *
 * The map is published as paletted XYZ tiles (one colour per class), so the
 * class under the cursor is read back from the tile pixel colour without a
 * server request. Municipalities come from a static GeoJSON with stats.
 */

import { escapeHtml } from '../utils/html.js';

export interface FloodClass {
  value: number;
  label: string;
  color: string;
}

export interface FloodRiskMetadata {
  title: string;
  description: string;
  classes: FloodClass[];
  tiles: { url: string; minzoom: number; maxzoom: number };
  bounds: [number, number, number, number];
  sources: string[];
}

export interface MunicipalityProps {
  name: string;
  code: number;
  area_km2: number;
  class_share: number[];
  high_share: number;
  mean_score: number;
  rank: number;
}

type Ring = number[][];

export interface MunicipalityFeature {
  type: 'Feature';
  geometry:
    | { type: 'Polygon'; coordinates: Ring[] }
    | { type: 'MultiPolygon'; coordinates: Ring[][] };
  properties: MunicipalityProps;
}

export const TILE_SIZE = 256;

/** XYZ tile and pixel inside it for a WGS84 point at zoom `z`. */
export function tilePixel(
  lat: number,
  lng: number,
  z: number
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return {
    x,
    y,
    px: Math.floor((fx - x) * TILE_SIZE),
    py: Math.floor((fy - y) * TILE_SIZE),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Class whose palette colour matches the pixel; null if transparent/unknown. */
export function classFromRgba(
  rgba: ArrayLike<number>,
  classes: FloodClass[]
): FloodClass | null {
  if ((rgba[3] ?? 0) < 128) return null;
  for (const cls of classes) {
    const [r, g, b] = hexToRgb(cls.color);
    if (
      Math.abs(r - (rgba[0] ?? 0)) <= 2 &&
      Math.abs(g - (rgba[1] ?? 0)) <= 2 &&
      Math.abs(b - (rgba[2] ?? 0)) <= 2
    ) {
      return cls;
    }
  }
  return null;
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(lng, lat, outer)) return false;
  return !holes.some(hole => inRing(lng, lat, hole));
}

/** Municipality containing the point, or null. */
export function findMunicipality(
  lng: number,
  lat: number,
  features: MunicipalityFeature[]
): MunicipalityFeature | null {
  for (const f of features) {
    const polygons =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polygons.some(rings => inPolygon(lng, lat, rings))) return f;
  }
  return null;
}

/** Sidebar key (data-muni) for a municipality name. */
export function muniKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

/** Choropleth class (1-5) from the share of high + very high cells. */
export function highShareClass(share: number): number {
  return Math.min(5, Math.floor(share * 5) + 1);
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Stats card for a municipality (escaped HTML). */
export function municipalityCardHtml(
  props: MunicipalityProps,
  classes: FloodClass[],
  total: number
): string {
  const bars = classes
    .map((cls, i) => {
      const share = props.class_share[i] ?? 0;
      return `<div class="flood-muni-row">
        <span class="flood-swatch flood-swatch-${cls.value}"></span>
        <span class="flood-muni-label">${escapeHtml(cls.label)}</span>
        <span class="flood-muni-value">${pct(share)}</span>
      </div>`;
    })
    .join('');
  return `<div class="flood-muni-card">
    <strong>${escapeHtml(props.name)}</strong>
    <div class="flood-muni-meta">Puesto ${props.rank} de ${total} municipios por susceptibilidad ·
      ${pct(props.high_share)} en susceptibilidad alta o muy alta ·
      ${Math.round(props.area_km2).toLocaleString('es-MX')} km²</div>
    ${bars}
  </div>`;
}

/**
 * Bounded cache of decoded tile pixels. Only successful loads are kept, so a
 * tile that failed to load (network error) is retried on the next hover
 * instead of being reported as "no data" until it is evicted.
 */
export class TilePixelCache {
  private readonly entries = new Map<string, Promise<ImageData>>();

  constructor(
    private readonly limit: number,
    private readonly load: (key: string) => Promise<ImageData>
  ) {}

  get(key: string): Promise<ImageData> {
    const cached = this.entries.get(key);
    if (cached) return cached;
    const pending = this.load(key);
    this.entries.set(key, pending);
    pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return pending;
  }
}

export interface ReadoutState {
  /** 'error' when the tile under the cursor could not be read. */
  status: 'ok' | 'error';
  cls: FloodClass | null;
  muni: string | null;
}

/** Text of the hover readout (escaped HTML). */
export function readoutHtml({ status, cls, muni }: ReadoutState): string {
  const where = muni ? ` · ${escapeHtml(muni)}` : '';
  if (status === 'error') return `No se pudo leer el mapa en este punto${where}`;
  if (cls) return `Susceptibilidad <strong>${escapeHtml(cls.label)}</strong>${where}`;
  return muni
    ? `${escapeHtml(muni)} · sin dato (agua permanente o fuera del modelo)`
    : 'Fuera del área del modelo';
}

/**
 * Expose the published class colours as `--flood-class-N` so legend swatches
 * and the choropleth follow metadata.json instead of a hard-coded copy.
 */
export function applyClassColors(classes: FloodClass[], root: HTMLElement): void {
  for (const cls of classes) {
    root.style.setProperty(`--flood-class-${cls.value}`, cls.color);
  }
}
