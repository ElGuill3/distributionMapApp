import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NormalModeResult } from './normalMode.js';
import { requestNormalGeneration } from './normalGeneration.js';

const doubles = vi.hoisted(() => ({
  revision: 0,
  request: vi.fn(),
  error: vi.fn(),
  results: [] as Promise<NormalModeResult>[],
}));
vi.mock('./normalMode.js', () => ({
  requestGifAndSeries: doubles.request,
  captureGenerationOwnership: () => {
    const revision = doubles.revision;
    return () => revision === doubles.revision;
  },
}));
vi.mock('../ui/progress.js', () => ({ showErrorModal: doubles.error }));
vi.mock('../errorMap.js', () => ({
  translateBackendError: (message: string) => ({ title: 'Translated error', message }),
}));
const complete = vi.fn();
function deferred() {
  let resolve!: (result: NormalModeResult) => void;
  const promise = new Promise<NormalModeResult>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function request() {
  return requestNormalGeneration(
    'ndvi',
    '2020-01-01',
    '2020-12-31',
    [-92, 17, -91, 18]
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  doubles.results.length = 0;
  doubles.request.mockImplementation(() => {
    ++doubles.revision;
    return doubles.results.shift() ?? Promise.resolve({ success: true });
  });
  document.addEventListener('generationComplete', complete);
});
afterEach(() => {
  document.removeEventListener('generationComplete', complete);
});

it('preserves current success arguments and its payload-free CustomEvent', async () => {
  expect(await request()).toBeUndefined();
  expect(doubles.request).toHaveBeenCalledWith(
    'ndvi',
    '2020-01-01',
    '2020-12-31',
    [-92, 17, -91, 18]
  );
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'generationComplete', detail: null })
  );
  expect(doubles.error).not.toHaveBeenCalled();
});
it('preserves translated current failure feedback and completion', async () => {
  doubles.results.push(Promise.resolve({ success: false, error: 'Backend failed' }));
  await request();
  expect(doubles.error).toHaveBeenCalledExactlyOnceWith(
    'Translated error',
    'Backend failed'
  );
  expect(complete).toHaveBeenCalledOnce();
});
it.each([true, false])(
  'ignores obsolete success=%s before the newer request completes',
  async success => {
    const old = deferred();
    const current = deferred();
    doubles.results.push(old.promise, current.promise);
    const earlier = request();
    const newer = request();
    old.resolve({ success, error: 'Obsolete failure' });
    await earlier;
    expect(complete).not.toHaveBeenCalled();
    expect(doubles.error).not.toHaveBeenCalled();
    current.resolve({ success: true });
    await newer;
    expect(complete).toHaveBeenCalledOnce();
    expect(doubles.error).not.toHaveBeenCalled();
  }
);
it('ignores a result invalidated by clear after the producer has resolved', async () => {
  const pending = deferred();
  doubles.results.push(pending.promise);
  const loading = request();
  pending.resolve({ success: true });
  ++doubles.revision;
  await loading;
  expect(complete).not.toHaveBeenCalled();
  expect(doubles.error).not.toHaveBeenCalled();
});
it('ignores an explicitly superseded result', async () => {
  doubles.results.push(
    Promise.resolve({ success: false, superseded: true, error: 'Old error' })
  );
  await request();
  expect(complete).not.toHaveBeenCalled();
  expect(doubles.error).not.toHaveBeenCalled();
});
