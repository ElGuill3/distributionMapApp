/** Real public generation-event feedback; no synthetic modal DOM. */
import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  const alerts: string[] = [];
  const apiRequests: string[] = [];
  await page.exposeFunction('__alertSpy', (message: string) => alerts.push(message));
  await page.addInitScript(() => {
    window.alert = message => {
      void (
        window as Window & { __alertSpy: (message: string) => Promise<void> }
      ).__alertSpy(String(message));
    };
  });
  await page.route('**/api/**', route => {
    apiRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/templates/index.html', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.locator('#tflow-year-select option').count(), { timeout: 15000 })
    .toBeGreaterThan(1);
  return { alerts, apiRequests };
}

async function rejectMissingArea(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent('tflowGenerateAnimation', {
        detail: { variable: 'ndvi', year: 2020, season: 'spring' },
      })
    );
  });
  const modal = page.getByRole('alertdialog');
  await expect(modal.locator('.modal-error')).toBeVisible();
  await expect(modal).toContainText('Sin área seleccionada');
  await expect(modal).toContainText(
    'Dibujá un rectángulo en el mapa antes de generar.'
  );
  await expect(modal.getByRole('button', { name: 'Cerrar' })).toBeFocused();
  return modal;
}

test('generation without area produces accessible feedback and no API request', async ({
  page,
}) => {
  const { alerts, apiRequests } = await ready(page);
  apiRequests.length = 0;
  await expect(page.locator('#tflow-generate-btn')).toBeDisabled();
  await rejectMissingArea(page);
  expect(alerts).toEqual([]);
  expect(apiRequests).toEqual([]);
  await expect(page.locator('#loading-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('#tflow-generate-btn')).toBeDisabled();
});

test('Escape closes the actual application error modal without window.alert', async ({
  page,
}) => {
  const { alerts, apiRequests } = await ready(page);
  apiRequests.length = 0;
  await rejectMissingArea(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(alerts).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('startup initializes the actual sidebar and map without alerts', async ({
  page,
}) => {
  const { alerts } = await ready(page);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#control-sidebar')).toBeVisible();
  await expect(page.locator('#tflow-generate-btn')).toBeDisabled();
  expect(alerts).toEqual([]);
});

test('drawing and real Generate click preserve dates/bbox and recover from API failure', async ({
  page,
}) => {
  const { alerts } = await ready(page);
  const generated: URL[] = [];
  await page.route('**/api/ndvi-*', route => {
    generated.push(new URL(route.request().url()));
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic provider unavailable' }),
    });
  });
  await page.locator('#tflow-draw-btn').click();
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#map .leaflet-overlay-pane path')).toHaveCount(1);
  await page.locator('#tflow-year-select').selectOption('2020');
  await page.locator('#tflow-season-select').selectOption('primavera');
  const generate = page.locator('#tflow-generate-btn');
  await expect(generate).toBeEnabled();
  await generate.click();
  const modal = page.getByRole('alertdialog');
  await expect(modal.locator('.modal-error')).toBeVisible();
  await expect(modal).toContainText('Synthetic provider unavailable');
  expect(generated.map(url => url.pathname).sort()).toEqual([
    '/api/ndvi-gif-bbox',
    '/api/ndvi-timeseries-bbox',
  ]);
  for (const url of generated) {
    expect(url.searchParams.get('start')).toBe('2020-03-01');
    expect(url.searchParams.get('end')).toBe('2020-05-31');
    const bbox = JSON.parse(url.searchParams.get('bbox')!) as number[];
    expect(bbox).toHaveLength(4);
    expect(bbox.every(Number.isFinite)).toBe(true);
    expect(bbox[2]).toBeGreaterThan(bbox[0]);
    expect(bbox[3]).toBeGreaterThan(bbox[1]);
    expect(bbox[2] - bbox[0]).toBeCloseTo(bbox[3] - bbox[1], 5);
  }
  expect(generated[0].searchParams.get('bbox')).toBe(
    generated[1].searchParams.get('bbox')
  );
  expect(alerts).toEqual([]);
  await expect(page.locator('#loading-indicator')).toHaveCount(0);
  await expect(page.locator('#btnExportAnalysis')).toBeDisabled();
  await modal.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(generate).toBeEnabled();
});
