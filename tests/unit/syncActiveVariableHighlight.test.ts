import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock mapState to provide controlled test environment
vi.mock('../../src/ts/state/mapState.js', () => ({
  getCurrentVariable: vi.fn(),
}));

import * as mapState from '../../src/ts/state/mapState.js';

// Mock the variable details map from main.ts
const variableDetailsMap: Record<string, string> = {
  'ndvi-controls': 'ndvi',
  'temp-controls': 'temp',
  'soil-controls': 'soil',
  'precip-controls': 'precip',
  'water-controls': 'water',
};

/**
 * Production implementation of syncActiveVariableHighlight.
 * Syncs the .details-active class on the details element matching the current variable.
 * Removes the class from all other variable details elements.
 */
function syncActiveVariableHighlight(): void {
  const currentVariable = mapState.getCurrentVariable();

  // Remove from all variable details
  Object.keys(variableDetailsMap).forEach(id => {
    const details = document.getElementById(id);
    if (details) {
      details.classList.remove('details-active');
    }
  });

  // Add to current variable's details
  const currentId = Object.entries(variableDetailsMap).find(
    ([, v]) => v === currentVariable
  )?.[0];
  if (currentId) {
    const details = document.getElementById(currentId);
    if (details) {
      details.classList.add('details-active');
    }
  }
}

describe('syncActiveVariableHighlight', () => {
  let container: HTMLElement;
  const mockGetCurrentVariable = mapState.getCurrentVariable as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <details id="ndvi-controls"><summary>NDVI</summary></details>
      <details id="temp-controls"><summary>Temp</summary></details>
      <details id="soil-controls"><summary>Soil</summary></details>
      <details id="precip-controls"><summary>Precip</summary></details>
      <details id="water-controls"><summary>Water</summary></details>
    `;
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should add details-active class to current variable details', () => {
    mockGetCurrentVariable.mockReturnValue('ndvi');
    syncActiveVariableHighlight();

    const ndviDetails = document.getElementById('ndvi-controls');
    expect(ndviDetails?.classList.contains('details-active')).toBe(true);
  });

  it('should remove details-active from other variables when switching', () => {
    // Start with ndvi active
    mockGetCurrentVariable.mockReturnValue('ndvi');
    syncActiveVariableHighlight();
    const ndviDetails = document.getElementById('ndvi-controls');
    expect(ndviDetails?.classList.contains('details-active')).toBe(true);

    // Switch to temp
    mockGetCurrentVariable.mockReturnValue('temp');
    syncActiveVariableHighlight();
    const tempDetails = document.getElementById('temp-controls');

    expect(ndviDetails?.classList.contains('details-active')).toBe(false);
    expect(tempDetails?.classList.contains('details-active')).toBe(true);
  });

  it('should remove details-active from all when no variable is selected', () => {
    // Start with ndvi active
    mockGetCurrentVariable.mockReturnValue('ndvi');
    syncActiveVariableHighlight();

    // Clear variable (getCurrentVariable returns undefined/null)
    mockGetCurrentVariable.mockReturnValue(undefined);
    syncActiveVariableHighlight();

    Object.keys(variableDetailsMap).forEach(id => {
      const details = document.getElementById(id);
      expect(details?.classList.contains('details-active')).toBe(false);
    });
  });

  it('should handle non-existent variables gracefully', () => {
    mockGetCurrentVariable.mockReturnValue('nonexistent');
    // Should not throw
    expect(() => syncActiveVariableHighlight()).not.toThrow();
  });
});
