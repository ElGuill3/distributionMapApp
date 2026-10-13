import { test, expect } from '@playwright/test';

test('flood risk mode shows the statewide layer, legend, readout and municipality card', async ({
  page,
}) => {
  const tileStatuses: number[] = [];
  page.on('response', response => {
    if (response.url().includes('/api/flood-risk/tiles/')) {
      tileStatuses.push(response.status());
    }
  });

  await page.goto('/templates/index.html');
  await page.locator('#toggleFloodRiskMode').click();

  const legend = page.locator('.flood-risk-colorbar');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.flood-legend-row')).toHaveText([
    'Muy alta',
    'Alta',
    'Media',
    'Baja',
    'Muy baja',
  ]);
  await expect
    .poll(() => tileStatuses.filter(s => s === 200).length)
    .toBeGreaterThan(0);
  expect(tileStatuses.filter(s => s !== 200)).toEqual([]);

  // Seventeen municipalities, including Teapa (missing before).
  await expect(page.locator('input.chk-flood-muni')).toHaveCount(17);

  await page.locator('input.chk-flood-muni[data-muni="centro"]').check({ force: true });
  const popup = page.locator('.flood-muni-card');
  await expect(popup).toContainText('Centro');
  await expect(popup).toContainText(/Lugar \d+ de 17/);
  await expect(popup.locator('.flood-muni-row')).toHaveCount(5);

  // Hover the middle of the map (Centro after fitBounds) and read the class.
  await page.locator('.leaflet-popup-close-button').click();
  const box = await page.locator('#map').boundingBox();
  if (!box) throw new Error('map not rendered');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3);
  await expect(page.locator('.flood-readout')).toContainText(
    /Susceptibilidad (Muy baja|Baja|Media|Alta|Muy alta) · Centro|Centro · sin dato/
  );

  // Leaving the mode removes the layer and legend.
  await page.locator('#toggleFloodRiskMode').click();
  await expect(legend).toHaveCount(0);
  await expect(page.locator('.flood-readout')).toHaveCount(0);
});
