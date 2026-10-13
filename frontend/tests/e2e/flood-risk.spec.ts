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
  await expect(page.locator('.flood-readout')).toContainText(
    /Susceptibilidad (Muy baja|Baja|Media|Alta|Muy alta) · Centro/
  );
  // Legend swatches take their colour from metadata.json.
  await expect(page.locator('.flood-risk-colorbar .flood-swatch-5')).toHaveCSS(
    'background-color',
    'rgb(37, 52, 148)'
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

test('a tile that fails to load is reported, not shown as no data', async ({
  page,
}) => {
  await page.route('**/api/flood-risk/tiles/**', route =>
    route.fulfill({ status: 500 })
  );
  await page.goto('/templates/index.html');
  await page.locator('#toggleFloodRiskMode').click();
  await page.locator('input.chk-flood-muni[data-muni="centro"]').check({ force: true });
  await page.locator('.leaflet-popup-close-button').click();
  const box = await page.locator('#map').boundingBox();
  if (!box) throw new Error('map not rendered');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator('.flood-readout')).toContainText(
    'No se pudo leer el mapa en este punto · Centro'
  );
});

test('flood risk mode hides station markers and restores them on exit', async ({
  page,
}) => {
  await page.route('**/api/local-stations', route =>
    route.fulfill({
      json: {
        BDCTB_hidro: {
          name: 'Boca del Cerro',
          type: 'hidrometrica',
          coords: [17.43, -91.48],
          station_name: 'Boca del Cerro',
          municipio: 'Tenosique',
        },
      },
    })
  );
  await page.goto('/templates/index.html');
  const markers = page.locator('.leaflet-marker-pane > *');
  await expect(markers).toHaveCount(1);

  await page.locator('#toggleFloodRiskMode').click();
  await expect(page.locator('.flood-risk-colorbar')).toBeVisible();
  await expect(markers).toHaveCount(0);

  await page.locator('#toggleFloodRiskMode').click();
  await expect(markers).toHaveCount(1);
});

test('the stations toggle still hides markers and flood mode keeps that choice', async ({
  page,
}) => {
  await page.route('**/api/local-stations', route =>
    route.fulfill({
      json: {
        BDCTB_hidro: {
          name: 'Boca del Cerro',
          type: 'hidrometrica',
          coords: [17.43, -91.48],
          station_name: 'Boca del Cerro',
          municipio: 'Tenosique',
        },
      },
    })
  );
  await page.goto('/templates/index.html');
  const markers = page.locator('.leaflet-marker-pane > *');
  const toggle = page.locator('#topbar-layer-stations');
  await expect(markers).toHaveCount(1);

  await toggle.evaluate(el => (el as HTMLElement).click());
  await expect(markers).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#toggleFloodRiskMode').click();
  await page.locator('#toggleFloodRiskMode').click();
  await expect(markers).toHaveCount(0);

  await toggle.evaluate(el => (el as HTMLElement).click());
  await expect(markers).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});
