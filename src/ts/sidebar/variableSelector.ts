/**
 * Variable Selector — distributionMapApp
 *
 * Manages the variable chip/tabs selection in Paso 2
 *
 * PR1: TypeScript migration
 */

import { VARIABLE_YEARS } from '../config.js';
import type { VariableKey } from '../types.js';
import { setCurrentVariable } from '../state/mapState.js';
import { transitionTo } from './taskFlow.js';

// Variable mapping
const VARIABLE_MAP: Record<string, string> = {
  ndvi: 'NDVI',
  temp: 'Temperatura 2m',
  soil: 'Humedad del suelo',
  precip: 'Precipitación diaria',
};

const VARIABLE_KEYS = Object.keys(VARIABLE_MAP) as VariableKey[];

/**
 * VariableSelector singleton
 */
class VariableSelector {
  activeVariable: string;
  private listeners: ((event: string, data?: unknown) => void)[];
  chipContainer: HTMLElement | null;

  constructor() {
    this.activeVariable = 'ndvi';
    this.listeners = [];
    this.chipContainer = null;
  }

  initChipContainer(): void {
    this.chipContainer = document.getElementById(
      'tflow-chip-container'
    ) as HTMLElement | null;
    if (!this.chipContainer) {
      console.warn('[VariableSelector] Chip container not found');
      return;
    }

    this.setupChipListeners();
    this.updateChipVisuals();
    // PR2 fix: populate year select on init so it's ready before first chip click
    this.populateYearSelect();


  }

  /**
   * Setup click listeners on chips
   */
  setupChipListeners(): void {
    if (!this.chipContainer) return;

    this.chipContainer.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const chip = target.closest('.tflow-chip') as HTMLElement | null;
      if (!chip) return;

      const variable = chip.dataset.variable;
      if (variable && variable !== this.activeVariable) {
        this.setActiveChip(variable);
      }
    });
  }

  setActiveChip(variable: string): void {
    if (!VARIABLE_KEYS.includes(variable as VariableKey)) {
      console.warn(`[VariableSelector] Invalid variable: ${variable}`);
      return;
    }

    this.activeVariable = variable;
    this.updateChipVisuals();



    // PR2: Single source of truth — update mapState and taskFlow directly
    setCurrentVariable(variable as VariableKey);
    transitionTo('config');

    // Update config panel first (populates year select)
    this.populateYearSelect();

    // Dispatch custom event AFTER year select is populated
    document.dispatchEvent(
      new CustomEvent('variableSelected', {
        detail: { variable },
      })
    );

    this.notifyListeners('change', { variable });
  }

  /**
   * Get the currently active variable
   * @returns Active variable key
   */
  getActiveVariable(): string {
    return this.activeVariable;
  }

  /**
   * Update chip visual states
   */
  updateChipVisuals(): void {
    if (!this.chipContainer) return;

    const chips = this.chipContainer.querySelectorAll('.tflow-chip');
    chips.forEach(chip => {
      const isActive = (chip as HTMLElement).dataset.variable === this.activeVariable;
      chip.classList.toggle('tflow-chip--active', isActive);
    });
  }

  populateYearSelect(): void {
    const yearSelect = document.getElementById(
      'tflow-year-select'
    ) as HTMLSelectElement | null;
    if (!yearSelect) return;

    // Save previous value if possible
    const prevValue = yearSelect.value;

    // Clear existing options except placeholder
    while (yearSelect.options.length > 1) {
      yearSelect.remove(1);
    }

    // Get years for active variable
    let years = VARIABLE_YEARS[this.activeVariable as VariableKey] || [];



    // Populate options
    years.forEach((year: number) => {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.appendChild(option);
    });

    // Reset to placeholder or keep if still valid
    if (prevValue && years.includes(Number(prevValue))) {
      yearSelect.value = prevValue;
    } else {
      yearSelect.value = '';
    }

    // Dispatch event for config panel
    document.dispatchEvent(
      new CustomEvent('yearSelectPopulated', {
        detail: { variable: this.activeVariable, years },
      })
    );
  }

  /**
   * Add a listener for variable changes
   * @param listener - Callback function
   */
  addListener(listener: (event: string, data?: unknown) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener
   * @param listener - Callback function to remove
   */
  removeListener(listener: (event: string, data?: unknown) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Notify all listeners of an event
   * @param event - Event type
   * @param data - Event data
   */
  notifyListeners(event: string, data?: unknown): void {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[VariableSelector] Listener error:', err);
      }
    });
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.activeVariable = 'ndvi';
    this.updateChipVisuals();



    this.populateYearSelect();
  }
}

// Export singleton instance
export const variableSelector = new VariableSelector();

// Convenience exports
export const initChipContainer = (): void => variableSelector.initChipContainer();
export const setActiveChip = (variable: string): void =>
  variableSelector.setActiveChip(variable);
export const getActiveVariable = (): string => variableSelector.getActiveVariable();
export const populateYearSelect = (): void => variableSelector.populateYearSelect();
export const addListener = (listener: (event: string, data?: unknown) => void): void =>
  variableSelector.addListener(listener);
export const removeListener = (
  listener: (event: string, data?: unknown) => void
): void => variableSelector.removeListener(listener);
export const reset = (): void => variableSelector.reset();
export { VariableSelector };
