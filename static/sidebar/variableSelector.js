/**
 * Variable Selector — distributionMapApp
 *
 * Manages the variable chip/tabs selection in Paso 2
 *
 * PR1: TypeScript migration
 */
import { VARIABLE_YEARS } from '../config.js';
import { setCurrentVariable } from '../state/mapState.js';
import { transitionTo } from './taskFlow.js';
// Variable mapping
const VARIABLE_MAP = {
    'ndvi': 'NDVI',
    'temp': 'Temperatura 2m',
    'soil': 'Humedad del suelo',
    'precip': 'Precipitación diaria',
    'water': 'Cuerpos de agua',
};
const VARIABLE_KEYS = Object.keys(VARIABLE_MAP);
/**
 * VariableSelector singleton
 */
class VariableSelector {
    constructor() {
        this.activeVariable = 'ndvi';
        this.listeners = [];
        this.chipContainer = null;
    }
    /**
     * Initialize the chip container
     */
    initChipContainer() {
        this.chipContainer = document.getElementById('tflow-chip-container');
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
    setupChipListeners() {
        if (!this.chipContainer)
            return;
        this.chipContainer.addEventListener('click', (e) => {
            const target = e.target;
            const chip = target.closest('.tflow-chip');
            if (!chip)
                return;
            const variable = chip.dataset.variable;
            if (variable && variable !== this.activeVariable) {
                this.setActiveChip(variable);
            }
        });
    }
    /**
     * Set the active variable chip
     * @param variable - Variable key ('ndvi', 'temp', 'soil', 'precip', 'water')
     */
    setActiveChip(variable) {
        if (!VARIABLE_KEYS.includes(variable)) {
            console.warn(`[VariableSelector] Invalid variable: ${variable}`);
            return;
        }
        this.activeVariable = variable;
        this.updateChipVisuals();
        // PR2: Single source of truth — update mapState and taskFlow directly
        setCurrentVariable(variable);
        transitionTo('config');
        // Update config panel first (populates year select)
        this.populateYearSelect();
        // Dispatch custom event AFTER year select is populated
        document.dispatchEvent(new CustomEvent('variableSelected', {
            detail: { variable }
        }));
        this.notifyListeners('change', { variable });
    }
    /**
     * Get the currently active variable
     * @returns Active variable key
     */
    getActiveVariable() {
        return this.activeVariable;
    }
    /**
     * Update chip visual states
     */
    updateChipVisuals() {
        if (!this.chipContainer)
            return;
        const chips = this.chipContainer.querySelectorAll('.tflow-chip');
        chips.forEach(chip => {
            const isActive = chip.dataset.variable === this.activeVariable;
            chip.classList.toggle('tflow-chip--active', isActive);
        });
    }
    /**
     * Populate the year select based on active variable
     */
    populateYearSelect() {
        const yearSelect = document.getElementById('tflow-year-select');
        if (!yearSelect)
            return;
        // Clear existing options except placeholder
        while (yearSelect.options.length > 1) {
            yearSelect.remove(1);
        }
        // Get years for active variable
        const years = VARIABLE_YEARS[this.activeVariable] || [];
        // Populate options
        years.forEach((year) => {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            yearSelect.appendChild(option);
        });
        // Reset to placeholder
        yearSelect.value = '';
        // Dispatch event for config panel
        document.dispatchEvent(new CustomEvent('yearSelectPopulated', {
            detail: { variable: this.activeVariable, years }
        }));
    }
    /**
     * Add a listener for variable changes
     * @param listener - Callback function
     */
    addListener(listener) {
        this.listeners.push(listener);
    }
    /**
     * Remove a listener
     * @param listener - Callback function to remove
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }
    /**
     * Notify all listeners of an event
     * @param event - Event type
     * @param data - Event data
     */
    notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            try {
                listener(event, data);
            }
            catch (err) {
                console.error('[VariableSelector] Listener error:', err);
            }
        });
    }
    /**
     * Reset to default state
     */
    reset() {
        this.activeVariable = 'ndvi';
        this.updateChipVisuals();
        this.populateYearSelect();
    }
}
// Export singleton instance
export const variableSelector = new VariableSelector();
// Convenience exports
export const initChipContainer = () => variableSelector.initChipContainer();
export const setActiveChip = (variable) => variableSelector.setActiveChip(variable);
export const getActiveVariable = () => variableSelector.getActiveVariable();
export const populateYearSelect = () => variableSelector.populateYearSelect();
export const addListener = (listener) => variableSelector.addListener(listener);
export const removeListener = (listener) => variableSelector.removeListener(listener);
export const reset = () => variableSelector.reset();
export { VariableSelector };
//# sourceMappingURL=variableSelector.js.map