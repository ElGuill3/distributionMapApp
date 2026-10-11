import type { BBox, VariableKey } from '../types.js';
import * as normalMode from './normalMode.js';
import { translateBackendError } from '../errorMap.js';
import { showErrorModal } from '../ui/progress.js';

/** Bridge normal-mode results to the existing task-flow event contract. */
export async function requestNormalGeneration(
  variable: Exclude<VariableKey, 'local_sp' | 'local_bd'>,
  start: string,
  end: string,
  bbox: BBox
): Promise<void> {
  const pending = normalMode.requestGifAndSeries(variable, start, end, bbox);
  const isCurrent = normalMode.captureGenerationOwnership();
  const result = await pending;
  if (!isCurrent() || result.superseded) return;
  if (!result.success && result.error) {
    const uxError = translateBackendError(result.error);
    showErrorModal(uxError.title, uxError.message);
  }
  document.dispatchEvent(new CustomEvent('generationComplete'));
}
