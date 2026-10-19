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
      model_version: 'bdctb-L1-postaudit-v1',
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
    const host = new URL(route.request().url()).hostname;
    if (
      host === 'tabasco.gob.mx' ||
      host === 'raw.githubusercontent.com' ||
      host === 'github.com' ||
      host === 'api.github.com'
    ) {
      forbidden.push(route.request().url());
      return route.abort();
    }
    return route.continue();
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
  await page.locator('#map .leaflet-marker-pane > *').first().click();
  await page.getByRole('button', { name: 'Ver pronóstico del río' }).click();
  return page.getByRole('dialog', { name: 'Pronóstico de Boca del Cerro' });
}

test('BDCTB popup opens a compact NAMO chart and cached fallback without remote forecast access', async ({
  page,
}) => {
  const forbidden = await ready(page);
  let requests = 0;
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests++;
    return route.fulfill({ json: publication(false, 'cache') });
  });
  const dialog = await openFromMarker(page);
  expect(requests).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Pronóstico guardado, emitido el 2026-10-19 (sin conexión)'
  );
  await expect(dialog).toContainText(
    'Sin nivel IPCET reciente: pronóstico solo con GloFAS, menos preciso'
  );
  await expect(dialog).toContainText('Mañana: 18.4 m (17.9–18.9) · a 0.8 m del NAMO');
  await expect(dialog.locator('svg')).toContainText('NAMO 19.21 m');
  await expect(dialog.locator('.forecast-band')).toHaveCSS(
    'fill',
    'rgba(14, 116, 144, 0.2)'
  );
  await expect(dialog.locator('.forecast-median')).toHaveCSS('fill', 'none');
  await expect(dialog.locator('.forecast-namo')).toHaveCSS(
    'stroke-dasharray',
    '6px, 4px'
  );
  await expect(
    dialog.getByRole('link', { name: 'Consultar el semáforo oficial de IPCET' })
  ).toHaveAttribute('href', /^https:\/\/tabasco\.gob\.mx\//);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  expect(forbidden).toEqual([]);
});

test('keeps the forecast visible while updating and replaces it on the 60-second poll', async ({
  page,
}) => {
  const forbidden = await ready(page);
  let requests = 0;
  await page.route('**/api/v1/forecasts/bdctb', route => {
    requests++;
    return route.fulfill({
      json: publication(requests > 1, 'network', requests === 1),
    });
  });
  await page.clock.install();
  const dialog = await openFromMarker(page);
  await expect(dialog).toContainText('Actualizando con el nivel de IPCET de hoy…');
  await expect(dialog.locator('svg')).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(dialog).toContainText('Con nivel IPCET del 2026-10-19 (06:00)');
  await expect(dialog).not.toContainText('Actualizando con');
  expect(requests).toBe(2);
  await dialog.getByRole('button', { name: 'Cerrar pronóstico' }).click();
  await page.clock.fastForward(60000);
  expect(requests).toBe(2);
  expect(forbidden).toEqual([]);
});

test('503 is a Spanish notice without disturbing the map', async ({ page }) => {
  const forbidden = await ready(page);
  await page.route('**/api/v1/forecasts/bdctb', route =>
    route.fulfill({
      status: 503,
      json: { error: 'No hay un pronóstico válido guardado.' },
    })
  );
  const dialog = await openFromMarker(page);
  await expect(dialog).toContainText('No hay un pronóstico válido guardado.');
  await expect(dialog.locator('svg')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cerrar pronóstico' }).click();
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  expect(forbidden).toEqual([]);
});
