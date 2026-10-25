import { mactbPublication } from './stationForecast.fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcetStatus } from './ipcetStatus.js';
import {
  buildStationPopup,
  openStationPopup,
  closeStationPopup,
} from './stationPopup.js';
import { forecastLoaderFor } from './stationChart.js';
import { escapeHtml } from '../utils/html.js';
import type { LocalStationInfo } from '../types.js';

const info: LocalStationInfo = {
  name: 'Boca del Cerro',
  type: 'hidrometrica',
  coords: [17.43, -91.48],
  municipio: 'Tenosique',
};

describe('station popup rendering', () => {
  it.each(['BDCTB_hidro', 'SPTTB_hidro', 'ABCDE'])(
    'offers the chart for hydrometric code %s',
    id => {
      const popup = buildStationPopup(id, info, true);
      const action = popup.querySelector<HTMLElement>('.station-chart-link');
      expect(action?.textContent).toBe('Ver detalle');
      expect(popup.querySelectorAll('button')).toHaveLength(1);
      expect(action?.dataset.stationId).toBe(id);
      expect(popup.querySelector('.station-full-data-link')).not.toBeNull();
      expect(
        buildStationPopup(id, info, false).querySelector('.station-chart-link')
      ).toBeNull();
    }
  );
  it('adds official state, date, safe source link and unconfirmed note without removing actions', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schema: 'ipcet-levels/v1',
          table_date: '2026-10-14',
          issued_at: '2026-10-14T12:00:00Z',
          last_modified: '',
          source_url: 'https://example.org/ipcet',
          source: 'network',
          stations: [
            {
              code: 'BDCTB',
              station: 'Boca del Cerro',
              river: 'Usumacinta',
              namo: 19.21,
              namino: null,
              ayer: 18,
              hoy: null,
              diff: null,
              capacity: null,
              semaforo: 'PREVENCION',
              problems: ['missing'],
            },
          ],
        })
      )
    );
    try {
      await ipcetStatus.refresh();
      const popup = buildStationPopup('BDCTB_hidro', info, true);
      expect(popup.textContent).toContain('PREVENCIÓN (IPCET, 14/10/2026)');
      expect(popup.textContent).toContain('nivel sin confirmar');
      const link = popup.querySelector<HTMLAnchorElement>('.ipcet-source')!;
      expect(link.textContent).toBe('Fuente: IPCET');
      expect(link.href).toBe('https://example.org/ipcet');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener');
      expect(popup.querySelector('.station-full-data-link')).not.toBeNull();
      expect(popup.querySelector('.station-chart-link')).not.toBeNull();
      expect(
        buildStationPopup('BDCTB_clima', info, false).querySelector('.ipcet-source')
      ).toBeNull();
    } finally {
      fetcher.mockRestore();
    }
  });
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
    expect(popup.querySelector('.station-chart-link')?.textContent).toBe('Ver detalle');
  });

  it('keeps climate fallback labels without a forecast action', () => {
    const popup = buildStationPopup('BDCTB_clima', { ...info, municipio: '' }, false);
    expect(popup.textContent).toContain('Sin Municipio');
    expect(popup.textContent).toContain('Precipitación');
    expect(popup.querySelector('[data-lucide="droplet"]')).not.toBeNull();
    expect(popup.querySelector('.station-forecast-link')).toBeNull();
  });
});

function publication(
  mode: 'live' | 'glofas_only' = 'live',
  source: 'network' | 'cache' = 'network',
  updating = false
) {
  return {
    source,
    updating,
    fetched_at: '2026-10-19T18:00:00Z',
    forecast: {
      schema: 'bdctb-forecast/v2',
      station: { code: 'BDCTB', name: 'Boca del Cerro' },
      model_version: 'test',
      issue_time: '2026-10-19T11:00:00-06:00',
      generated_at: '2026-10-19T18:00:00Z',
      mode,
      live_input:
        mode === 'live' ? { date: '2026-10-19', stage_m: 18, age_days: 0 } : null,
      forecasts: Object.fromEntries(
        [1, 3, 7].map(h => [
          `h${h}`,
          {
            target_date: `2026-10-${19 + h}`,
            q10: 17,
            q50: 19.21,
            q90: 20,
            namo_m: 19.21,
            distance_to_namo_m: 0,
            data_kind: 'modeled_not_observed',
          },
        ])
      ),
      disclaimer:
        'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
    },
  };
}
function mounted(id = 'BDCTB_hidro') {
  const element = buildStationPopup(id, info, true);
  document.body.append(element);
  return { getElement: () => element, update: vi.fn() };
}
afterEach(() => {
  closeStationPopup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('popup forecast lifecycle', () => {
  it('uses the registry, never fetches at construction/startup, and requests only on open', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(publication())));
    vi.stubGlobal('fetch', fetcher);
    expect(forecastLoaderFor('BDCTB_hidro')).toBeTypeOf('function');
    const popup = mounted();
    expect(fetcher).not.toHaveBeenCalled();
    openStationPopup(popup);
    expect(popup.getElement().textContent).toContain('Consultando pronóstico…');
    await vi.waitFor(() =>
      expect(popup.getElement().textContent).toContain(
        'Pronóstico del modelo · emitido 19/10 11:00'
      )
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(true);
    expect(popup.update).toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    closeStationPopup(popup);
    const other = mounted('SPTTB_hidro');
    openStationPopup(other);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(other.getElement().querySelector('.station-forecast-summary')).toBeNull();
  });
  it.each([
    ['live', 'network', false, 'Modelado, no es aviso oficial'],
    ['glofas_only', 'network', false, 'Sin nivel en vivo: puede sobrestimar'],
    ['live', 'cache', false, 'Copia guardada del 19/10'],
    ['live', 'network', true, 'Actualizando con el nivel de hoy…'],
  ] as const)(
    'renders %s/%s/updating=%s in at most three lines',
    async (mode, source, updating, note) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(publication(mode, source, updating)))
          )
      );
      const popup = mounted();
      openStationPopup(popup);
      await vi.waitFor(() => expect(popup.getElement().textContent).toContain(note));
      const block = popup.getElement().querySelector('.station-forecast-summary')!;
      expect(block.children).toHaveLength(3);
      expect(block.textContent).toContain(
        'Mañana 19.2 m · 3 días 19.2 m · 7 días 19.2 m · alcanza el NAMO'
      );
      expect(document.querySelector('dialog')).toBeNull();
    }
  );
  it('keeps function-valued Leaflet content stable across update and restores the factory on close', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(publication()))))
    );
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    const factory = () => buildStationPopup('BDCTB_hidro', info, true);
    let content: ReturnType<L.Popup['getContent']> = factory;
    const popup = {
      getElement: () => wrapper,
      getContent: () => content,
      setContent: vi.fn((next: typeof content) => {
        content = next;
        return popup;
      }),
      update: vi.fn(() => {
        wrapper.replaceChildren(
          typeof content === 'function' ? factory() : (content as HTMLElement)
        );
        return popup;
      }),
    };
    popup.update();
    openStationPopup(popup);
    await vi.waitFor(() =>
      expect(wrapper.textContent).toContain('Pronóstico del modelo')
    );
    expect(typeof content).not.toBe('function');
    vi.useFakeTimers();
    popup.setContent.mockClear();
    closeStationPopup(popup);
    expect(popup.setContent).not.toHaveBeenCalled();
    expect(typeof content).not.toBe('function');
    await vi.advanceTimersByTimeAsync(0);
    expect(popup.setContent).toHaveBeenCalledExactlyOnceWith(factory);
    expect(content).toBe(factory);
    popup.update();
    expect(wrapper.textContent).not.toContain('Pronóstico del modelo');
    openStationPopup(popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.textContent).toContain('Pronóstico del modelo');
    // Reopening before the deferred restoration must not lose the factory.
    closeStationPopup(popup);
    openStationPopup(popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(typeof content).not.toBe('function');
    expect(wrapper.textContent).toContain('Pronóstico del modelo');
    closeStationPopup(popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(content).toBe(factory);
  });
  it('preserves same-popup replacement by aborting only its previous request', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        signals.push(init.signal);
        return new Promise<Response>(() => {});
      })
    );
    const main = mounted();
    const compare = mounted();
    openStationPopup(main);
    openStationPopup(compare);
    openStationPopup(main);
    expect(signals).toHaveLength(3);
    expect(signals.map(signal => signal.aborted)).toEqual([true, false, false]);
    closeStationPopup(main);
    expect(signals.map(signal => signal.aborted)).toEqual([true, false, true]);
    closeStationPopup();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
  });
  it('keeps both maps polling independently and closes only the selected popup', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(publication('live', 'network', true)))
      )
    );
    vi.stubGlobal('fetch', fetcher);
    const main = mounted();
    const compare = mounted();
    openStationPopup(main);
    await vi.advanceTimersByTimeAsync(0);
    const summary = main.getElement().textContent;
    openStationPopup(compare);
    await vi.advanceTimersByTimeAsync(0);
    expect(main.getElement().textContent).toBe(summary);
    expect(compare.getElement().textContent).toBe(summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    closeStationPopup(compare);
    const compareUpdates = compare.update.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(compare.update).toHaveBeenCalledTimes(compareUpdates);
    expect(main.getElement().textContent).toBe(summary);
    closeStationPopup();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('omits the near-NAMO phrase on overflow but keeps the complete tooltip', async () => {
    const value = publication();
    for (const point of Object.values(value.forecast.forecasts)) {
      point.q50 = 19.17;
      point.distance_to_namo_m = point.q50 - point.namo_m;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(value)))
    );
    const popup = mounted();
    popup.update.mockImplementation(() => {
      const medians = popup.getElement().querySelector('.station-forecast-summary')
        ?.children[1];
      if (medians) {
        Object.defineProperty(medians, 'clientWidth', {
          configurable: true,
          value: 100,
        });
        Object.defineProperty(medians, 'scrollWidth', {
          configurable: true,
          value: 200,
        });
      }
    });
    openStationPopup(popup);
    await vi.waitFor(() =>
      expect(popup.getElement().textContent).toContain('Pronóstico del modelo')
    );
    const medians = popup.getElement().querySelector('.station-forecast-summary')!
      .children[1] as HTMLElement;
    expect(medians.textContent).toBe('Mañana 19.2 m · 3 días 19.2 m · 7 días 19.2 m');
    expect(medians.title).toBe(
      'Mañana 19.2 m · 3 días 19.2 m · 7 días 19.2 m · prácticamente en el NAMO'
    );
  });
  it('preserves a valid summary after a transient poll failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(publication('live', 'network', true)))
      )
      .mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    const popup = mounted();
    openStationPopup(popup);
    await vi.advanceTimersByTimeAsync(0);
    const summary = popup.getElement().textContent;
    await vi.advanceTimersByTimeAsync(60000);
    expect(popup.getElement().textContent).toBe(summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps the popup usable on error and after the five-second deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          )
      )
    );
    const popup = mounted();
    openStationPopup(popup);
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      popup.getElement().querySelector('.station-forecast-summary')?.textContent
    ).toBe('Pronóstico no disponible');
    expect(popup.getElement().querySelector('button')?.textContent).toBe('Ver detalle');
  });
  it('ignores late responses on close or replacement, without altering a different popup or model mark', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(r => {
            resolve = r;
          })
      )
    );
    ipcetStatus.setModelMark('BDCTB', false);
    const popup = mounted();
    openStationPopup(popup);
    closeStationPopup(popup);
    const other = mounted('SPTTB_hidro');
    openStationPopup(other);
    const before = popup.getElement().innerHTML;
    resolve(new Response(JSON.stringify(publication())));
    await new Promise(r => setTimeout(r, 0));
    expect(popup.getElement().innerHTML).toBe(before);
    expect(other.getElement().textContent).not.toContain('Pronóstico del modelo');
    expect(ipcetStatus.modelMarkFor('BDCTB')).toBe(false);
  });
  it('polls updating every minute while open, pauses hidden, resumes visible and stops on close', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(publication('live', 'network', true)))
      )
    );
    vi.stubGlobal('fetch', fetcher);
    const popup = mounted();
    openStationPopup(popup);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * 60000);
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    closeStationPopup(popup);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(count);
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

it('opens each published popup lazily, using MACTB values and its own NAMO wording', async () => {
  const fetcher = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          forecast: mactbPublication,
          source: 'network',
          fetched_at: mactbPublication.generated_at,
          updating: false,
        })
      )
    )
  );
  vi.stubGlobal('fetch', fetcher);
  for (const code of ['BDCTB', 'MACTB', 'SAACP', 'PNVTB', 'TAPTB']) {
    expect(forecastLoaderFor(`${code}_hidro`)).toBeTypeOf('function');
    expect(
      buildStationPopup(`${code}_hidro`, info, true).querySelector(
        '.station-forecast-summary'
      )
    ).not.toBeNull();
  }
  expect(forecastLoaderFor('constructor')).toBeUndefined();
  const popup = mounted('MACTB_hidro');
  expect(fetcher).not.toHaveBeenCalled();
  openStationPopup(popup);
  await vi.waitFor(() =>
    expect(popup.getElement().textContent).toContain(
      'Pronóstico del modelo · emitido 25/10 11:00'
    )
  );
  const block = popup.getElement().querySelector('.station-forecast-summary')!;
  expect(block.children).toHaveLength(3);
  expect(block.children[1]?.textContent).toBe(
    'Mañana 6.3 m · 3 días 4.4 m · 7 días 3.0 m · mín. 3.6 m bajo el NAMO'
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/forecasts/mactb');
  expect(ipcetStatus.modelMarkFor('MACTB')).toBe(false);
});

it.each(['MACTB', 'SAACP', 'PNVTB', 'TAPTB'])(
  'omits CSV-backed actions for forecast-only %s',
  code => {
    const popup = buildStationPopup(`${code}_hidro`, info, true);
    expect(popup.querySelector('.station-full-data-link')).toBeNull();
    expect(popup.querySelector('.station-chart-link')?.textContent).toBe('Ver detalle');
    expect(popup.querySelector('.station-forecast-summary')).not.toBeNull();
  }
);
