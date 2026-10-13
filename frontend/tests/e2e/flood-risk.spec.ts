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

test('municipality view colours each municipality by its high-susceptibility share', async ({
  page,
}) => {
  await page.goto('/templates/index.html');
  await page.locator('#toggleFloodRiskMode').click();
  await expect(page.locator('.flood-risk-colorbar .flood-legend-row')).toHaveCount(5);

  await page
    .locator('input[name="flood-view"][value="municipal"]')
    .check({ force: true });

  await expect(page.locator('path.flood-choropleth')).toHaveCount(17);
  // Nacajuca has 84% of its area in high or very high susceptibility -> top bin.
  await expect(page.locator('path.flood-choropleth-5')).not.toHaveCount(0);
  await expect(page.locator('.flood-risk-colorbar .flood-legend-title')).toHaveText(
    '% de superficie en susceptibilidad alta o muy alta'
  );
  await expect(page.locator('.flood-risk-colorbar .flood-legend-row')).toHaveText([
    '80 – 100%',
    '60 – 80%',
    '40 – 60%',
    '20 – 40%',
    '0 – 20%',
  ]);
  await expect(
    page.locator('.leaflet-tile-pane img[src*="/api/flood-risk/tiles/"]')
  ).toHaveCount(0);

  await page.locator('path.flood-choropleth-5').first().click({ force: true });
  await expect(page.locator('.flood-muni-card')).toContainText(/Lugar \d+ de 17/);

  await page.locator('input[name="flood-view"][value="detail"]').check({ force: true });
  await expect(page.locator('path.flood-choropleth')).toHaveCount(0);
  await expect(page.locator('.flood-risk-colorbar .flood-legend-title')).toHaveText(
    'Susceptibilidad a inundación'
  );
});
