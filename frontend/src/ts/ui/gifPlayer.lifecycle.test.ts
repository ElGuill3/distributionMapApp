import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GifPlayer } from './gifPlayer.js';

vi.mock('gifuct-js', () => ({
  parseGIF: vi.fn(() => ({ lsd: { width: 1, height: 1 } })),
  decompressFrames: vi.fn(() =>
    [0, 20].map(delay => ({
      dims: { left: 0, top: 0, width: 1, height: 1 },
      patch: new Uint8ClampedArray(4),
      delay,
      disposalType: 2,
    }))
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(): Response {
  return { arrayBuffer: async () => new ArrayBuffer(1) } as Response;
}

describe('GifPlayer resource ownership', () => {
  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let sequence = 0;
    create = vi.fn(() => `blob:frame-${sequence++}`);
    revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    vi.stubGlobal('ImageData', class {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response())
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
      callback(new Blob(['frame']));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps decoded frames, fallback delays and idempotent disposal', async () => {
    const player = new GifPlayer();
    await player.load('/first.gif');
    expect(player.frameCount).toBe(2);
    expect(player.getFrameUrl(0)).toBe('blob:frame-0');
    expect(player.getFrameUrl(99)).toBe('');
    expect(player.getFrameDelay(0)).toBe(100);
    expect(player.getFrameDelay(1)).toBe(20);
    player.dispose();
    player.dispose();
    expect(revoke.mock.calls).toEqual([['blob:frame-0'], ['blob:frame-1']]);
    expect(player.frameCount).toBe(0);
  });

  it('revokes the previous frames when the same instance reloads', async () => {
    const player = new GifPlayer();
    await player.load('/first.gif');
    await player.load('/second.gif');
    expect(revoke.mock.calls).toEqual([['blob:frame-0'], ['blob:frame-1']]);
    expect(player.getFrameUrl(0)).toBe('blob:frame-2');
    player.dispose();
    expect(revoke).toHaveBeenCalledTimes(4);
  });

  it('does not let an older fetch overwrite a newer load', async () => {
    const old = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(old.promise);
    const player = new GifPlayer();
    const earlier = player.load('/old.gif');
    await player.load('/new.gif');
    old.resolve(response());
    await earlier;
    expect(player.getFrameUrl(0)).toBe('blob:frame-0');
    expect(player.frameCount).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    player.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect frames when disposed during fetch', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const player = new GifPlayer();
    const loading = player.load('/late.gif');
    player.dispose();
    pending.resolve(response());
    await loading;
    expect(player.frameCount).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a late canvas result after disposal', async () => {
    const entered = deferred<BlobCallback>();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => {
      entered.resolve(callback);
    });
    const player = new GifPlayer();
    const loading = player.load('/late-canvas.gif');
    const callback = await entered.promise;
    player.dispose();
    callback(new Blob(['frame']));
    await loading;
    expect(player.frameCount).toBe(0);
    expect(revoke.mock.calls).toEqual([['blob:frame-0']]);
  });

  it('reclaims partially rendered frames on failure and preserves existing ownership', async () => {
    const player = new GifPlayer();
    await player.load('/first.gif');
    vi.mocked(HTMLCanvasElement.prototype.toBlob)
      .mockImplementationOnce(callback => callback(new Blob(['partial'])))
      .mockImplementationOnce(callback => callback(null));
    await expect(player.load('/broken.gif')).rejects.toThrow(
      'canvas.toBlob devolvió null.'
    );
    expect(player.frameCount).toBe(2);
    expect(player.getFrameUrl(0)).toBe('blob:frame-0');
    expect(revoke.mock.calls).toEqual([['blob:frame-2']]);
    player.dispose();
    expect(revoke.mock.calls).toEqual([
      ['blob:frame-2'],
      ['blob:frame-0'],
      ['blob:frame-1'],
    ]);
  });
});
