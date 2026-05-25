import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportBundle } from '../../src/ts/apiClient.js';

describe('apiClient.exportBundle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the provided series data without mixing variables', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['zip']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await exportBundle({
      gifPaths: ['/static/gifs/ndvi_a.gif'],
      seriesData: {
        ndvi: {
          dates: ['2020-01-01', '2020-01-02'],
          values: [0.45, 0.5],
        },
        temp: {
          dates: ['2020-01-01', '2020-01-02'],
          values: [28.1, 28.9],
        },
      },
      bbox: [-92.5, 17, -91, 18],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body.seriesData.dates).toEqual(['2020-01-01', '2020-01-02']);
    expect(body.seriesData.variables).toEqual({
      ndvi: [0.45, 0.5],
      temp: [28.1, 28.9],
    });
    expect(body.metadata.variableKeys).toEqual(['ndvi', 'temp']);
  });

  it('exports all provided variables when multiple series are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['zip']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await exportBundle({
      gifPaths: ['/static/gifs/temp_b.gif'],
      seriesData: {
        ndvi: {
          dates: ['2020-01-01', '2020-01-02'],
          values: [0.1, 0.2],
        },
        temp: {
          dates: ['2020-02-01', '2020-02-02'],
          values: [29.5, 29.9],
        },
        soil: {
          dates: ['2020-02-01', '2020-02-02'],
          values: [35, 40],
        },
      },
      bbox: [-92.5, 17, -91, 18],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body.seriesData.dates).toEqual([
      '2020-01-01',
      '2020-01-02',
      '2020-02-01',
      '2020-02-02',
    ]);
    expect(body.seriesData.variables).toEqual({
      ndvi: [0.1, 0.2, null, null],
      temp: [null, null, 29.5, 29.9],
      soil: [null, null, 35, 40],
    });
    expect(body.metadata.variableKeys).toEqual(['ndvi', 'temp', 'soil']);
  });

  it('aligns variables with different date frequencies before export', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['zip']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await exportBundle({
      gifPaths: ['/static/gifs/ndvi_a.gif', '/static/gifs/local_sp.gif'],
      seriesData: {
        ndvi: {
          dates: ['2020-01-01', '2020-01-17'],
          values: [0.4, 0.5],
        },
        local_sp: {
          dates: ['2020-01-01', '2020-01-02', '2020-01-03'],
          values: [1.1, 1.2, 1.3],
        },
      },
      bbox: [-92.5, 17, -91, 18],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body.seriesData.dates).toEqual([
      '2020-01-01',
      '2020-01-02',
      '2020-01-03',
      '2020-01-17',
    ]);
    expect(body.seriesData.variables.ndvi).toEqual([0.4, null, null, 0.5]);
    expect(body.seriesData.variables.local_sp).toEqual([1.1, 1.2, 1.3, null]);
  });
});
