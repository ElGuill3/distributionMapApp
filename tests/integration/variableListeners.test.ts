/**
 * Integration test: variableListeners error handling
 *
 * Task 4.3: Simulate clicking "generate" without bbox and verify:
 *  1. window.alert is NOT called
 *  2. .field-error span appears in DOM
 *
 * This covers the path in variableListeners.ts line 133-137:
 *   if (!bbox) { showFieldError(button, '...'); return; }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerVariableListener, VariableListenerConfig } from '../../src/ts/listeners/variableListeners.js';

describe('variableListeners — error handling without bbox', () => {
  // Mock DOM elements
  let yearSelect: HTMLSelectElement;
  let seasonSelect: HTMLSelectElement;
  let button: HTMLButtonElement;
  let getBbox: () => null;
  let onRequest: ReturnType<VariableListenerConfig>['onRequest'];

  beforeEach(() => {
    // Build minimal DOM structure
    yearSelect = document.createElement('select');
    yearSelect.id = 'test-year';
    seasonSelect = document.createElement('select');
    seasonSelect.id = 'test-season';
    button = document.createElement('button');
    button.id = 'test-btn';
    button.disabled = true; // starts disabled until year+season selected

    document.body.appendChild(yearSelect);
    document.body.appendChild(seasonSelect);
    document.body.appendChild(button);

    // getBbox returns null → triggers the "Dibujá un rectángulo..." path
    getBbox = () => null;

    // onRequest should NOT be called in this scenario
    onRequest = vi.fn();

    // Spy on window.alert
    vi.spyOn(window, 'alert');
  });

  afterEach(() => {
    document.body.removeChild(yearSelect);
    document.body.removeChild(seasonSelect);
    document.body.removeChild(button);
    vi.restoreAllMocks();
  });

  it('clicking button without bbox shows field-error and does NOT call alert()', () => {
    // Register the listener
    registerVariableListener({
      variable: 'ndvi',
      yearSelect,
      seasonSelect,
      button,
      getBbox,
      onRequest,
    });

    // Simulate selecting year + season (enables button)
    yearSelect.value = '2020';
    yearSelect.dispatchEvent(new Event('change'));
    seasonSelect.value = 'verano';
    seasonSelect.dispatchEvent(new Event('change'));

    expect(button.disabled).toBe(false);

    // Click the button (bbox is null → showFieldError path)
    button.click();

    // alert() was NOT called
    expect(window.alert).not.toHaveBeenCalled();

    // onRequest was NOT called either (early return)
    expect(onRequest).not.toHaveBeenCalled();

    // .field-error span exists in DOM with the expected message
    const errorSpan = document.querySelector('.field-error');
    expect(errorSpan).not.toBeNull();
    expect(errorSpan?.textContent).toBe('Dibujá un rectángulo en el mapa primero.');
  });

  it('clicking button without year/season does NOT call alert()', () => {
    // Provide a valid bbox so we pass the bbox check and reach the
    // year+season validation in the click handler.
    const validBbox: [number, number, number, number] = [-91.5, 17.0, -90.5, 18.0];
    const getBboxWithValue = () => validBbox;

    registerVariableListener({
      variable: 'ndvi',
      yearSelect,
      seasonSelect,
      button,
      getBbox: getBboxWithValue,
      onRequest,
    });

    // Manually enable button and set year to reach year+season validation.
    // We skip setting season (it stays '') to trigger that validation path.
    button.disabled = false;
    yearSelect.value = '2020';

    // Click → should NOT trigger alert(), regardless of which validation fires first
    button.click();

    expect(window.alert).not.toHaveBeenCalled();
    // Either year+season validation or bbox validation may fire depending on
    // the internal ordering in the click handler; either way no alert() is used.
  });
});
