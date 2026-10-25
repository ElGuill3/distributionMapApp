import { mactbPublication } from '../../src/ts/ui/stationForecast.fixture.js';
import { test, expect, type Page } from '@playwright/test';

// Publication shapes inspected once from forecasts/ipcet/{latest,recent}.json.
// PREVENCION and the NAMO-reaching forecast are deliberate synthetic scenarios.
const source =
  'https://tabasco.gob.mx/noticias/semaforo-hidrometereologico-y-niveles-de-rios-19102026';
const stations = [
  {
    code: 'BDCTB',
    river: 'Usumacinta',
    station: 'Boca del Cerro',
    namo: 19.21,
    namino: null,
    ayer: 17.71,
    hoy: 17.93,
    diff: 0.22,
    capacity: 1.28,
    semaforo: 'PREVENCION',
    problems: [],
  },
  {
    code: 'SPTTB',
    river: 'San Pedro',
    station: 'San Pedro',
    namo: 9.01,
    namino: 758,
    ayer: 8.65,
    hoy: 8.68,
    diff: 0.03,
    capacity: 0.33,
    semaforo: 'NORMAL',
    problems: [],
  },
];
const latest = {
  schema: 'ipcet-levels/v1',
  table_date: '2026-10-19',
  issued_at: '2026-10-19T06:00:00-06:00',
  last_modified: 'Mon, 19 Oct 2026 16:22:09 GMT',
  source_url: source,
  stations,
  source: 'network',
  fetched_at: '2026-10-19T18:00:00Z',
};
function forecast(live = true, median = 19.21) {
  return {
    source: 'network',
    fetched_at: '2026-10-19T18:00:00Z',
    updating: false,
    forecast: {
      schema: 'bdctb-forecast/v2',
      station: { code: 'BDCTB', name: 'Boca del Cerro' },
      issue_time: '2026-10-19T11:00:00-06:00',
      generated_at: '2026-10-19T18:00:00Z',
      model_version: 'bdctb-L1-postaudit-v1',
      mode: live ? 'live' : 'glofas_only',
      live_input: live ? { date: '2026-10-19', stage_m: 17.93, age_days: 0 } : null,
      forecasts: Object.fromEntries(
        [1, 3, 7].map(h => [
          `h${h}`,
          {
            target_date: `2026-10-${19 + h}`,
            q10: 17.9,
            q50: median,
            q90: 20.1,
            distance_to_namo_m: median - 19.21,
            namo_m: 19.21,
            data_kind: 'modeled_not_observed',
          },
        ])
      ),
      disclaimer:
        'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
    },
  };
}
async function ready(page: Page, state = 'PREVENCION', failure = false) {
  const requests: string[] = [];
  const forbidden: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) {
      if (url.pathname.startsWith('/api/'))
        return route.fulfill({ status: 503, json: { error: 'API no simulada' } });
      return route.continue();
    }
    if (['unpkg.com', 'cdn.plot.ly', 'cdn.jsdelivr.net'].includes(url.hostname))
      return route.continue();
    // Basemap deliberately blocked in deterministic tests.
    if (!url.hostname.endsWith('.tile.openstreetmap.org')) forbidden.push(url.href);
    return route.abort();
  });
  await page.route('**/api/local-stations', route =>
    route.fulfill({
      json: Object.fromEntries(
        stations.map((s, i) => [
          `${s.code}_hidro`,
          {
            name: s.station,
            station_name: s.station,
            municipio: i ? 'Balancán' : 'Tenosique',
            type: 'hidrometrica',
            coords: i ? [17.79, -91.16] : [17.43, -91.48],
          },
        ])
      ),
    })
  );
  await page.route('**/api/v1/ipcet/levels', route =>
    route.fulfill(
      failure
        ? { status: 503, json: { error: 'Niveles no disponibles' } }
        : {
            json: {
              ...latest,
              stations: [{ ...stations[0], semaforo: state }, stations[1]],
            },
          }
    )
  );
  await page.route('**/api/v1/ipcet/levels/*/recent', route => {
    const code = new URL(route.request().url()).pathname.split('/')[5];
    const base = code === 'BDCTB' ? 17.93 : 8.68;
    return route.fulfill({
      json: {
        schema: 'ipcet-recent/v1',
        source: 'network',
        fetched_at: latest.fetched_at,
        stations: {
          [code]: [
            {
              date: '2026-10-12',
              hoy: Number((base - 0.3).toFixed(2)),
              semaforo: null,
            },
            {
              date: '2026-10-13',
              hoy: Number((base - 0.2).toFixed(2)),
              semaforo: null,
            },
            { date: '2026-10-14', hoy: null, semaforo: null },
            {
              date: '2026-10-16',
              hoy: Number((base - 0.1).toFixed(2)),
              semaforo: null,
            },
            {
              date: '2026-10-19',
              hoy: base,
              semaforo: code === 'BDCTB' ? state : 'NORMAL',
            },
          ],
        },
      },
    });
  });
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests.push(route.request().url());
    return route.fulfill({ json: forecast() });
  });
  return { requests, forbidden };
}
const icon = (page: Page, state: string) =>
  page.locator(`#map .station-icon-hidro.ipcet-state-${state}`);
async function start(page: Page) {
  await page.goto('/templates/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .station-icon-hidro')).toHaveCount(2);
}
async function chart(page: Page, state = 'prevencion') {
  await icon(page, state).click();
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
  return page.locator('#ndvi-chart').evaluate((el: any) => el.data);
}
test.setTimeout(90_000);

test('T7 visual comparison: popup and detail in both themes, variable chart and SPTTB', async ({
  page,
}) => {
  await ready(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.documentElement.setAttribute('data-theme', theme);
      window.dispatchEvent(new Event('theme-change'));
    }, theme);
    if (await page.locator('.leaflet-popup-close-button').count())
      await page.locator('.leaflet-popup-close-button').click();
    await icon(page, 'prevencion').click();
    await expect(page.locator('.station-forecast-summary')).toContainText(
      'Pronóstico del modelo'
    );
    await expect(page.locator('.leaflet-popup')).toHaveCSS('opacity', '1');
    // The NAMO phrase must stay readable: no summary line may be clipped.
    const clipped = await page
      .locator('.station-forecast-summary > span')
      .evaluateAll(spans => spans.filter(s => s.scrollWidth > s.clientWidth).length);
    expect(clipped).toBe(0);
    await page.screenshot({ path: `.cache/fv-shots/t7-bdctb-popup-${theme}.png` });
    await page.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
    await page.locator('.leaflet-popup-close-button').click();
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator('#ndvi-chart')
          .evaluate((el: any) => el._fullLayout.height === el.clientHeight)
      )
      .toBe(true);
    await page.screenshot({ path: `.cache/fv-shots/t7-bdctb-chart-${theme}.png` });
  }
  // Real shared renderer with deterministic synthetic Temp data. Retain the
  // station panel alongside it solely for this side-by-side visual comparison.
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.evaluate(async () => {
    const modulePath = '/static/ui/chart.js';
    const { plotAllSelectedSeries } = await import(modulePath);
    const original = document.getElementById('ndvi-chart')!;
    const sibling = document.createElement('div');
    sibling.id = 't7-variable-comparison';
    sibling.style.cssText =
      'position:fixed;left:calc(320px + (100vw - 320px)/2);right:0;bottom:0;height:240px;background:var(--surface-bg);z-index:2000';
    document.body.append(sibling);
    original.style.width = '50%';
    (window as any).Plotly.relayout(original, { width: original.clientWidth });
    const dates = Array.from(
      { length: 30 },
      (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`
    );
    plotAllSelectedSeries(
      sibling,
      { temp: { dates, values: dates.map((_, i) => 26 + Math.sin(i / 3) * 3) } },
      () => {},
      () => {}
    );
  });
  await expect(page.locator('#t7-variable-comparison .main-svg').first()).toBeVisible();
  await page.screenshot({
    path: '.cache/fv-shots/t7-variable-temp-dark-comparison.png',
  });
  await page.evaluate(() => {
    document.getElementById('t7-variable-comparison')?.remove();
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await icon(page, 'normal').click();
  await expect(page.locator('.station-popup-content')).toContainText('San Pedro');
  await expect(page.locator('.station-forecast-summary')).toHaveCount(0);
  await expect(page.locator('.leaflet-popup')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.cache/fv-shots/t7-spttb-popup.png' });
});

for (const [state, css, color] of [
  ['NORMAL', 'normal', 'rgb(21, 128, 61)'],
  ['A LA BAJA', 'a-la-baja', 'rgb(107, 114, 128)'],
  ['BAJO', 'bajo', 'rgb(146, 64, 14)'],
  ['PREVENCION', 'prevencion', 'rgb(250, 204, 21)'],
  ['ALERTA', 'alerta', 'rgb(220, 38, 38)'],
  ['EMERGENCIA', 'emergencia', 'rgb(126, 34, 206)'],
]) {
  test(`official ${state} colour, accessible date, blink and reduced motion`, async ({
    page,
  }) => {
    const { requests, forbidden } = await ready(page, state);
    await start(page);
    const marker = icon(page, css).first();
    await expect(marker).toHaveCSS('background-color', color);
    const blinking = ['PREVENCION', 'ALERTA', 'EMERGENCIA'].includes(state);
    if (blinking) await expect(marker).toHaveClass(/ipcet-blink/);
    else await expect(marker).not.toHaveClass(/ipcet-blink/);
    await expect(marker).toHaveCSS('animation-name', blinking ? 'ipcet-blink' : 'none');
    for (const [target, name, label] of [
      [marker, 'Boca del Cerro', state === 'PREVENCION' ? 'PREVENCIÓN' : state],
      [icon(page, 'normal').last(), 'San Pedro', 'NORMAL'],
    ] as const) {
      await expect(target).toHaveAttribute(
        'aria-label',
        `${name}: ${label} (IPCET, 19/10/2026)`
      );
      await expect(target.locator('..')).toHaveAttribute(
        'title',
        `${name}: ${label} (IPCET, 19/10/2026)`
      );
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(marker).toHaveCSS('animation-name', 'none');
    expect(requests).toEqual([]);
    expect(forbidden).toEqual([]);
  });
}

test('dated official popup links to IPCET without requesting a forecast at startup', async ({
  page,
}) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'prevencion')).toBeVisible();
  expect(requests).toEqual([]);
  await icon(page, 'prevencion').click();
  const popup = page.locator('.station-popup-content');
  await expect(popup).toContainText('Boca del Cerro');
  await expect(popup).toContainText('PREVENCIÓN (IPCET, 19/10/2026)');
  await expect(popup.getByRole('link', { name: 'Fuente: IPCET' })).toHaveAttribute(
    'href',
    source
  );
  await expect(popup.getByRole('link', { name: 'Ver datos 2000–2024' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Ver detalle' })).toBeVisible();
  await expect(popup).toContainText('Pronóstico del modelo');
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(forbidden).toEqual([]);
});

test('BDCTB chart has observed, median, probability band and NAMO; only loaded live median reaching NAMO marks model', async ({
  page,
}) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'prevencion')).toBeVisible();
  await expect(page.locator('.ipcet-model-ring')).toHaveCount(0);
  expect(requests).toEqual([]);
  const traces = await chart(page);
  expect(traces).toHaveLength(5);
  expect(traces[0]).toMatchObject({
    name: 'Nivel observado (IPCET)',
    y: [17.63, 17.73, null, 17.83, 17.93],
    connectgaps: false,
    line: { dash: 'solid' },
  });
  expect(traces[1]).toMatchObject({ y: [17.93, 17.9, 17.9, 17.9], showlegend: false });
  expect(traces[2]).toMatchObject({
    name: 'Rango probable (10–90 %)',
    fill: 'tonexty',
    y: [17.93, 20.1, 20.1, 20.1],
  });
  expect(traces[3]).toMatchObject({
    name: 'Pronóstico (mediana)',
    y: [17.93, 19.21, 19.21, 19.21],
    line: { dash: 'dash' },
  });
  expect(traces[4]).toMatchObject({
    name: 'NAMO 19.21 m (oficial)',
    y: [19.21, 19.21],
  });
  await expect(icon(page, 'prevencion').locator('.ipcet-model-ring')).toHaveCount(1);
  await expect(icon(page, 'normal').locator('.ipcet-model-ring')).toHaveCount(0);
  await expect(icon(page, 'prevencion')).toHaveAttribute(
    'aria-label',
    /Pronóstico del modelo: alcanza el NAMO \(no es aviso oficial\)/
  );
  expect(requests).toHaveLength(2);
  await expect(page.locator('#btnExportAnalysis')).toBeDisabled();
  await expect(page.locator('#btnExportAnalysis')).toHaveAttribute(
    'title',
    /no admite las series IPCET/
  );
  await expect(page.locator('#export-toolbar')).toHaveClass(/can-export/);
  expect(forbidden).toEqual([]);
});

test('SPTTB chart contains only observed and official NAMO and never fetches BDCTB', async ({
  page,
}) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'normal')).toBeVisible();
  const traces = await chart(page, 'normal');
  expect(traces).toHaveLength(2);
  expect(traces[0]).toMatchObject({
    name: 'Nivel observado (IPCET)',
    y: [8.38, 8.48, null, 8.58, 8.68],
    line: { dash: 'solid' },
  });
  expect(traces[1]).toMatchObject({ name: 'NAMO 9.01 m (oficial)', y: [9.01, 9.01] });
  await expect(page.locator('.ipcet-model-ring')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(forbidden).toEqual([]);
});

for (const [live, median, label] of [
  [false, 19.21, 'GloFAS-only'],
  [true, 19.2, 'live below NAMO'],
] as const) {
  test(`${label} does not mark the model, and clears a previously loaded mark`, async ({
    page,
  }) => {
    const { forbidden } = await ready(page);
    await start(page);
    await chart(page);
    await expect(page.locator('#map .ipcet-model-ring')).toHaveCount(1);
    await page.route('**/api/v1/forecasts/bdctb', route =>
      route.fulfill({ json: forecast(live, median) })
    );
    await page.locator('.leaflet-popup-close-button').click();
    await icon(page, 'prevencion').click();
    await expect(page.locator('.station-forecast-summary')).toContainText(
      'Pronóstico del modelo'
    );
    await expect(page.locator('#map .ipcet-model-ring')).toHaveCount(0);
    await expect(icon(page, 'prevencion')).toHaveCSS(
      'background-color',
      'rgb(250, 204, 21)'
    );
    expect(forbidden).toEqual([]);
  });
}

test('IPCET 503 leaves default icons and the station chart action usable', async ({
  page,
}) => {
  const { forbidden } = await ready(page, 'PREVENCION', true);
  await start(page);
  const markers = page.locator('#map .station-icon-hidro');
  for (const marker of await markers.all()) {
    await expect(marker).toHaveCSS('background-color', 'rgb(124, 58, 237)');
    await expect(marker).not.toHaveClass(/ipcet-state-|ipcet-blink/);
  }
  await markers.first().click();
  await expect(page.getByRole('button', { name: 'Ver detalle' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  expect(forbidden).toEqual([]);
});

test('MACTB opens a lazy forecast popup and IPCET detail without CSV-backed actions', async ({
  page,
}) => {
  const { forbidden } = await ready(page);
  const extra = [
    ['MACTB', 'Macuspana', [17.766667, -92.6]],
    ['SAACP', 'Salto de Agua', [17.566667, -92.35]],
    ['PNVTB', 'Pueblo Nuevo', [17.854167, -92.879167]],
    ['TAPTB', 'Tapijulapa', [17.456944, -92.778611]],
  ] as const;
  await page.route('**/api/local-stations', route =>
    route.fulfill({
      json: {
        ...Object.fromEntries(
          stations.map((s, i) => [
            `${s.code}_hidro`,
            {
              name: s.station,
              station_name: s.station,
              type: 'hidrometrica',
              coords: i ? [17.79, -91.16] : [17.43, -91.48],
            },
          ])
        ),
        ...Object.fromEntries(
          extra.map(([code, name, coords]) => [
            `${code}_hidro`,
            { name, station_name: name, type: 'hidrometrica', coords },
          ])
        ),
      },
    })
  );
  await page.route('**/api/v1/ipcet/levels', route =>
    route.fulfill({
      json: {
        ...latest,
        stations: [
          ...stations,
          ...extra.map(([code, station]) => ({
            ...stations[1],
            code,
            station,
            namo: 9.85,
            semaforo: 'NORMAL',
          })),
        ],
      },
    })
  );
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/forecasts/')) requests.push(request.url());
  });
  await page.route('**/api/v1/forecasts/mactb', route =>
    route.fulfill({
      json: {
        forecast: mactbPublication,
        source: 'network',
        fetched_at: latest.fetched_at,
        updating: false,
      },
    })
  );
  await page.goto('/templates/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .station-icon-hidro')).toHaveCount(6);
  const marker = page.locator(
    '#map .station-icon-hidro[aria-label="Macuspana: NORMAL (IPCET, 19/10/2026)"]'
  );
  await expect(marker).toHaveCSS('background-color', 'rgb(21, 128, 61)');
  expect(requests).toEqual([]);
  await marker.click();
  const popup = page.locator('.station-popup-content');
  await expect(popup).toContainText('NORMAL (IPCET, 19/10/2026)');
  await expect(popup).toContainText('Pronóstico del modelo · emitido 25/10 11:00');
  await expect(popup).toContainText('Mañana 6.3 m · 3 días 4.4 m · 7 días 3.0 m');
  await expect(popup.locator('.station-forecast-summary > span')).toHaveCount(3);
  await expect(popup.getByRole('link', { name: 'Ver datos 2000–2024' })).toHaveCount(0);
  for (const [code] of extra) {
    await expect(page.locator(`select option[value="${code}_hidro"]`)).toHaveCount(0);
  }
  expect(requests).toHaveLength(1);
  await popup.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
  const traces = await page.locator('#ndvi-chart').evaluate((el: any) => el.data);
  expect(traces.map((t: any) => t.name)).toContain('NAMO 9.85 m (oficial)');
  expect(traces[3].y).toEqual([
    null,
    ...Object.values(mactbPublication.forecasts).map(p => p.q50),
  ]);
  await expect(marker.locator('.ipcet-model-ring')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(forbidden).toEqual([]);
});
