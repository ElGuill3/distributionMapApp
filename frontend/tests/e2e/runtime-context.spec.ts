import { test, expect } from '@playwright/test';

test('serves rendered runtime limits before the public application module', async ({
  page,
}) => {
  await page.goto('/templates/index.html');
  const text = await page.locator('#runtime-limits').textContent();
  const limits = JSON.parse(text ?? '') as Record<string, unknown>;
  expect(Object.keys(limits).sort()).toEqual([
    'MAX_SPAN_DEG',
    'MAX_SPAN_DEG_S2',
    'MAX_YEARS_RANGE',
  ]);
  for (const value of Object.values(limits)) {
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  }
  await expect(page.locator('script[type="module"]').last()).toHaveAttribute(
    'src',
    /\/static\/main\.js/
  );
});
