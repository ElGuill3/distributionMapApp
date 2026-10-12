import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

it.each([2.5, 12])(
  'keeps the existing config export synchronized with server span %s',
  async span => {
    document.body.innerHTML = `<script id="runtime-limits" type="application/json">${JSON.stringify({ MAX_SPAN_DEG: span, MAX_YEARS_RANGE: 2, MAX_SPAN_DEG_S2: 1 })}</script>`;
    vi.resetModules();
    const config = await import('../config.js');
    expect(config.MAX_SPAN_DEG).toBe(span);
  }
);

it('preserves the existing eight-degree export without server context', async () => {
  document.body.innerHTML = '';
  vi.resetModules();
  const config = await import('../config.js');
  expect(config.MAX_SPAN_DEG).toBe(8);
});

it('preserves default exports for consumers without a DOM', async () => {
  vi.stubGlobal('document', undefined);
  try {
    vi.resetModules();
    expect((await import('../config.js')).MAX_SPAN_DEG).toBe(8);
  } finally {
    vi.unstubAllGlobals();
  }
});
