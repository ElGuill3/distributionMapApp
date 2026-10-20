import { describe, expect, it } from 'vitest';
import { buildStationPopup } from './stationPopup.js';
import { escapeHtml } from '../utils/html.js';
import type { LocalStationInfo } from '../types.js';

const info: LocalStationInfo = {
  name: 'Boca del Cerro',
  type: 'hidrometrica',
  coords: [17.43, -91.48],
  municipio: 'Tenosique',
};

describe('station popup rendering', () => {
  it('treats server names, municipalities and IDs as data, not HTML', () => {
    const attack = '<img src=x onerror="window.pwned=1">';
    const id = '" onclick="window.pwned=1';
    const popup = buildStationPopup(
      id,
      {
        ...info,
        station_name: attack,
        municipio: attack,
      },
      true
    );
    document.body.append(popup);
    expect(popup.querySelector('.station-popup-title')?.textContent).toBe(attack);
    expect(popup.querySelector('.station-popup-meta-item')?.textContent).toContain(
      attack
    );
    const link = popup.querySelector<HTMLAnchorElement>('.station-full-data-link');
    expect(link?.dataset.stationId).toBe(id);
    expect(link?.hasAttribute('onclick')).toBe(false);
    expect(popup.querySelector('img,script,[onerror]')).toBeNull();
    popup.remove();
  });

  it('keeps station labels, dataset IDs, icons and BDCTB forecast action', () => {
    const popup = buildStationPopup('BDCTB_hidro', info, true);
    expect(popup.className).toBe('station-popup-content');
    expect(popup.querySelector('.station-popup-title')?.textContent).toBe(info.name);
    expect(popup.textContent).toContain('Tenosique');
    expect(popup.textContent).toContain('Nivel del río');
    expect(popup.textContent).toContain('Ver datos 2000–2024');
    expect(popup.querySelector('[data-lucide="waves"]')).not.toBeNull();
    expect(
      popup.querySelector<HTMLAnchorElement>('.station-full-data-link')?.dataset
        .stationId
    ).toBe('BDCTB_hidro');
    expect(popup.querySelector('.station-forecast-link')?.textContent).toBe(
      'Ver pronóstico del río'
    );
  });

  it('keeps climate fallback labels without a forecast action', () => {
    const popup = buildStationPopup('BDCTB_clima', { ...info, municipio: '' }, false);
    expect(popup.textContent).toContain('Sin Municipio');
    expect(popup.textContent).toContain('Precipitación');
    expect(popup.querySelector('[data-lucide="droplet"]')).not.toBeNull();
    expect(popup.querySelector('.station-forecast-link')).toBeNull();
  });
});

describe('HTML text escaping', () => {
  it('preserves external text in HTML and quoted attributes without adding nodes', () => {
    const text = '"\'><img src=x onerror=alert(1)>&';
    const div = document.createElement('div');
    div.innerHTML = `<span title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    expect(div.querySelector('span')?.textContent).toBe(text);
    expect(div.querySelector('span')?.title).toBe(text);
    expect(div.querySelector('img,[onerror]')).toBeNull();
  });
});
