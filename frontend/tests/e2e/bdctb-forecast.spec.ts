import { test, expect, type Page } from '@playwright/test';

function publication(live = false, source = 'network', updating = false) {
  return {
    source,
    fetched_at: '2026-10-19T18:00:00Z',
    updating,
    forecast: {
      schema: 'bdctb-forecast/v2',
      station: { code: 'BDCTB', name: 'Boca del Cerro' },
      issue_time: '2026-10-19T11:00:00-06:00',
      generated_at: '2026-10-19T18:00:00Z',
      model_version: 'test',
      mode: live ? 'live' : 'glofas_only',
      live_input: live ? { date: '2026-10-19', stage_m: 18.1, age_days: 0 } : null,
      forecasts: Object.fromEntries(
        [1, 3, 7].map(h => [
          `h${h}`,
          {
            target_date: `2026-10-${19 + h}`,
            q10: 17.9,
            q50: 18.4,
            q90: 18.9,
            distance_to_namo_m: 18.4 - 19.21,
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
async function ready(page: Page) {
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
    if (!url.hostname.endsWith('.tile.openstreetmap.org')) forbidden.push(url.href);
    return route.abort();
  });
  await page.route('**/api/local-stations', route =>
    route.fulfill({
      json: {
        BDCTB_hidro: {
          name: 'Boca del Cerro',
          station_name: 'Boca del Cerro',
          municipio: 'Tenosique',
          type: 'hidrometrica',
          coords: [17.43, -91.48],
        },
      },
    })
  );
  return forbidden;
}
async function openFromMarker(page: Page) {
  await page.goto('/templates/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map .station-icon-hidro')).toHaveCount(1);
  await page.locator('#map .station-icon-hidro').click();
  return page.locator('.station-popup-content');
}
test('popup shows compact q50 summary, cached provenance, no dialog, and one small detail button', async ({
  page,
}) => {
  const forbidden = await ready(page);
  let requests = 0;
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests++;
    return route.fulfill({ json: publication(true, 'cache') });
  });
  const popup = await openFromMarker(page);
  await expect(popup).toContainText('Pronóstico del modelo · emitido 19/10 11:00');
  await expect(popup).toContainText('Mañana 18.4 m · 3 días 18.4 m · 7 días 18.4 m');
  await expect(popup).toContainText('Copia guardada del 19/10');
  await expect(popup.locator('.station-forecast-summary > span')).toHaveCount(3);
  expect(
    await popup
      .locator('.station-forecast-summary > span')
      .nth(1)
      .evaluate(el => el.scrollWidth <= el.clientWidth)
  ).toBe(true);
  await expect(popup.getByRole('button', { name: 'Ver detalle' })).toBeVisible();
  await expect(popup.locator('button')).toHaveCount(1);
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(
    await popup.getByRole('button').evaluate(el => el.getBoundingClientRect().width)
  ).toBeLessThan(110);
  expect(
    await popup.evaluate(el => el.getBoundingClientRect().width)
  ).toBeLessThanOrEqual(300);
  expect(requests).toBe(1);
  expect(forbidden).toEqual([]);
});
test('updating polls while open and stops when popup closes', async ({ page }) => {
  const forbidden = await ready(page);
  let requests = 0;
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests++;
    return route.fulfill({
      json: publication(requests > 1, 'network', requests === 1),
    });
  });
  await page.clock.install();
  const popup = await openFromMarker(page);
  await expect(popup).toContainText('Actualizando con el nivel de hoy…');
  await page.clock.fastForward(60000);
  await expect(popup).not.toContainText('Actualizando con');
  expect(requests).toBe(2);
  await page.locator('.leaflet-popup-close-button').click();
  await page.clock.fastForward(60000);
  expect(requests).toBe(2);
  expect(forbidden).toEqual([]);
});
test('GloFAS-only note is inline, and a 503 keeps the map and actions usable', async ({
  page,
}) => {
  const forbidden = await ready(page);
  await page.route('**/api/v1/forecasts/bdctb', route =>
    route.fulfill({ json: publication() })
  );
  const popup = await openFromMarker(page);
  await expect(popup).toContainText('Sin nivel en vivo: puede sobrestimar');
  await page.locator('.leaflet-popup-close-button').click();
  await page.route('**/api/v1/forecasts/bdctb', route =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } })
  );
  await page.locator('#map .station-icon-hidro').click();
  await expect(popup).toContainText('Pronóstico no disponible');
  await expect(popup.getByRole('button', { name: 'Ver detalle' })).toBeVisible();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(forbidden).toEqual([]);
});
