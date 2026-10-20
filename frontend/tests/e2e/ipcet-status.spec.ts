import { test, expect, type Page } from '@playwright/test';

// Publication shapes inspected once from forecasts/ipcet/{latest,recent}.json.
// PREVENCION and the NAMO-reaching forecast are deliberate synthetic scenarios.
const source = 'https://tabasco.gob.mx/noticias/semaforo-hidrometereologico-y-niveles-de-rios-19102026';
const stations = [
  { code: 'BDCTB', river: 'Usumacinta', station: 'Boca del Cerro', namo: 19.21, namino: null, ayer: 17.71, hoy: 17.93, diff: 0.22, capacity: 1.28, semaforo: 'PREVENCION', problems: [] },
  { code: 'SPTTB', river: 'San Pedro', station: 'San Pedro', namo: 9.01, namino: 758, ayer: 8.65, hoy: 8.68, diff: 0.03, capacity: 0.33, semaforo: 'NORMAL', problems: [] },
];
const latest = { schema: 'ipcet-levels/v1', table_date: '2026-10-19', issued_at: '2026-10-19T06:00:00-06:00', last_modified: 'Mon, 19 Oct 2026 16:22:09 GMT', source_url: source, stations, source: 'network', fetched_at: '2026-10-19T18:00:00Z' };
function forecast(live = true, median = 19.21) {
  return {
    source: 'network', fetched_at: '2026-10-19T18:00:00Z', updating: false,
    forecast: {
      schema: 'bdctb-forecast/v2', station: { code: 'BDCTB', name: 'Boca del Cerro' },
      issue_time: '2026-10-19T11:00:00-06:00', generated_at: '2026-10-19T18:00:00Z', model_version: 'bdctb-L1-postaudit-v1',
      mode: live ? 'live' : 'glofas_only', live_input: live ? { date: '2026-10-19', stage_m: 17.93, age_days: 0 } : null,
      forecasts: Object.fromEntries([1, 3, 7].map(h => [`h${h}`, { target_date: `2026-10-${19 + h}`, q10: 17.9, q50: median, q90: 20.1, distance_to_namo_m: median - 19.21, namo_m: 19.21, data_kind: 'modeled_not_observed' }])),
      disclaimer: 'Pronóstico modelado, no es una observación ni un aviso oficial. Consulte el semáforo oficial de IPCET.',
    },
  };
}
async function ready(page: Page, state = 'PREVENCION', failure = false) {
  const requests: string[] = [];
  const forbidden: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) {
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'API no simulada' } });
      return route.continue();
    }
    if (['unpkg.com', 'cdn.plot.ly', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.continue();
    // Basemap deliberately blocked in deterministic tests.
    if (!url.hostname.endsWith('.tile.openstreetmap.org')) forbidden.push(url.href);
    return route.abort();
  });
  await page.route('**/api/local-stations', route => route.fulfill({ json: Object.fromEntries(stations.map((s, i) => [`${s.code}_hidro`, { name: s.station, station_name: s.station, municipio: i ? 'Balancán' : 'Tenosique', type: 'hidrometrica', coords: i ? [17.79, -91.16] : [17.43, -91.48] }])) }));
  await page.route('**/api/v1/ipcet/levels', route => route.fulfill(failure ? { status: 503, json: { error: 'Niveles no disponibles' } } : { json: { ...latest, stations: [{ ...stations[0], semaforo: state }, stations[1]] } }));
  await page.route('**/api/v1/ipcet/levels/*/recent', route => {
    const code = new URL(route.request().url()).pathname.split('/')[5];
    const base = code === 'BDCTB' ? 17.93 : 8.68;
    return route.fulfill({ json: { schema: 'ipcet-recent/v1', source: 'network', fetched_at: latest.fetched_at, stations: { [code]: [{ date: '2026-10-12', hoy: Number((base - 0.3).toFixed(2)), semaforo: null }, { date: '2026-10-13', hoy: Number((base - 0.2).toFixed(2)), semaforo: null }, { date: '2026-10-14', hoy: null, semaforo: null }, { date: '2026-10-16', hoy: Number((base - 0.1).toFixed(2)), semaforo: null }, { date: '2026-10-19', hoy: base, semaforo: code === 'BDCTB' ? state : 'NORMAL' }] } } });
  });
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests.push(route.request().url());
    return route.fulfill({ json: forecast() });
  });
  return { requests, forbidden };
}
const icon = (page: Page, state: string) => page.locator(`#map .station-icon-hidro.ipcet-state-${state}`);
async function start(page: Page) {
  await page.goto('/templates/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .station-icon-hidro')).toHaveCount(2);
}
async function chart(page: Page, state = 'prevencion') {
  await icon(page, state).click();
  await page.getByRole('button', { name: 'Ver niveles en la gráfica' }).click();
  await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
  return page.locator('#ndvi-chart').evaluate((el: any) => el.data);
}
test.setTimeout(90_000);

for (const [state, css, color] of [
  ['NORMAL', 'normal', 'rgb(21, 128, 61)'], ['A LA BAJA', 'a-la-baja', 'rgb(107, 114, 128)'], ['BAJO', 'bajo', 'rgb(146, 64, 14)'],
  ['PREVENCION', 'prevencion', 'rgb(250, 204, 21)'], ['ALERTA', 'alerta', 'rgb(220, 38, 38)'], ['EMERGENCIA', 'emergencia', 'rgb(126, 34, 206)'],
]) {
  test(`official ${state} colour, accessible date, blink and reduced motion`, async ({ page }) => {
    const { requests, forbidden } = await ready(page, state);
    await start(page);
    const marker = icon(page, css).first();
    await expect(marker).toHaveCSS('background-color', color);
    const blinking = ['PREVENCION', 'ALERTA', 'EMERGENCIA'].includes(state);
    if (blinking) await expect(marker).toHaveClass(/ipcet-blink/);
    else await expect(marker).not.toHaveClass(/ipcet-blink/);
    await expect(marker).toHaveCSS('animation-name', blinking ? 'ipcet-blink' : 'none');
    for (const [target, name, label] of [[marker, 'Boca del Cerro', state === 'PREVENCION' ? 'PREVENCIÓN' : state], [icon(page, 'normal').last(), 'San Pedro', 'NORMAL']] as const) {
      await expect(target).toHaveAttribute('aria-label', `${name}: ${label} (IPCET, 19/10/2026)`);
      await expect(target.locator('..')).toHaveAttribute('title', `${name}: ${label} (IPCET, 19/10/2026)`);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(marker).toHaveCSS('animation-name', 'none');
    expect(requests).toEqual([]);
    expect(forbidden).toEqual([]);
  });
}

test('dated official popup links to IPCET without requesting a forecast at startup', async ({ page }) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'prevencion')).toBeVisible();
  expect(requests).toEqual([]);
  await icon(page, 'prevencion').click();
  const popup = page.locator('.station-popup-content');
  await expect(popup).toContainText('Boca del Cerro');
  await expect(popup).toContainText('PREVENCIÓN (IPCET, 19/10/2026)');
  await expect(popup.getByRole('link', { name: 'Fuente: IPCET' })).toHaveAttribute('href', source);
  await expect(popup.getByRole('link', { name: 'Ver datos 2000–2024' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Ver pronóstico del río' })).toBeVisible();
  expect(requests).toEqual([]);
  expect(forbidden).toEqual([]);
});

test('BDCTB chart has observed, median, probability band and NAMO; only loaded live median reaching NAMO marks model', async ({ page }) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'prevencion')).toBeVisible();
  await expect(page.locator('.ipcet-model-ring')).toHaveCount(0);
  expect(requests).toEqual([]);
  const traces = await chart(page);
  expect(traces).toHaveLength(5);
  expect(traces[0]).toMatchObject({ name: 'Nivel observado (IPCET)', y: [17.63, 17.73, null, 17.83, 17.93], connectgaps: false, line: { dash: 'solid' } });
  expect(traces[1]).toMatchObject({ y: [17.93, 17.9, 17.9, 17.9], showlegend: false });
  expect(traces[2]).toMatchObject({ name: 'Rango probable (10–90 %)', fill: 'tonexty', y: [17.93, 20.1, 20.1, 20.1] });
  expect(traces[3]).toMatchObject({ name: 'Pronóstico (mediana)', y: [17.93, 19.21, 19.21, 19.21], line: { dash: 'dash' } });
  expect(traces[4]).toMatchObject({ name: 'NAMO 19.21 m (oficial)', y: [19.21, 19.21] });
  await expect(icon(page, 'prevencion').locator('.ipcet-model-ring')).toHaveCount(1);
  await expect(icon(page, 'normal').locator('.ipcet-model-ring')).toHaveCount(0);
  await expect(icon(page, 'prevencion')).toHaveAttribute('aria-label', /Pronóstico del modelo: alcanza el NAMO \(no es aviso oficial\)/);
  expect(requests).toHaveLength(1);
  expect(forbidden).toEqual([]);
});

test('SPTTB chart contains only observed and official NAMO and never fetches BDCTB', async ({ page }) => {
  const { requests, forbidden } = await ready(page);
  await start(page);
  await expect(icon(page, 'normal')).toBeVisible();
  const traces = await chart(page, 'normal');
  expect(traces).toHaveLength(2);
  expect(traces[0]).toMatchObject({ name: 'Nivel observado (IPCET)', y: [8.38, 8.48, null, 8.58, 8.68], line: { dash: 'solid' } });
  expect(traces[1]).toMatchObject({ name: 'NAMO 9.01 m (oficial)', y: [9.01, 9.01] });
  await expect(page.locator('.ipcet-model-ring')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(forbidden).toEqual([]);
});

for (const [live, median, label] of [[false, 19.21, 'GloFAS-only'], [true, 19.2, 'live below NAMO']] as const) {
  test(`${label} does not mark the model, and clears a previously loaded mark`, async ({ page }) => {
    const { forbidden } = await ready(page);
    await start(page);
    await chart(page);
    await expect(page.locator('#map .ipcet-model-ring')).toHaveCount(1);
    await page.route('**/api/v1/forecasts/bdctb', route => route.fulfill({ json: forecast(live, median) }));
    await icon(page, 'prevencion').click();
    await page.getByRole('button', { name: 'Ver pronóstico del río' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pronóstico de Boca del Cerro' });
    await expect(dialog.locator('svg')).toBeVisible();
    await expect(page.locator('#map .ipcet-model-ring')).toHaveCount(0);
    await expect(icon(page, 'prevencion')).toHaveCSS('background-color', 'rgb(250, 204, 21)');
    expect(forbidden).toEqual([]);
  });
}

test('IPCET 503 leaves default icons and the station chart action usable', async ({ page }) => {
  const { forbidden } = await ready(page, 'PREVENCION', true);
  await start(page);
  const markers = page.locator('#map .station-icon-hidro');
  for (const marker of await markers.all()) {
    await expect(marker).toHaveCSS('background-color', 'rgb(124, 58, 237)');
    await expect(marker).not.toHaveClass(/ipcet-state-|ipcet-blink/);
  }
  await markers.first().click();
  await expect(page.getByRole('button', { name: 'Ver niveles en la gráfica' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver niveles en la gráfica' }).click();
  await expect(page.locator('#ndvi-chart .main-svg').first()).toBeVisible();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  expect(forbidden).toEqual([]);
});
