/**
 * Config Panel — distributionMapApp
 *
 * Manages the configuration (year/season selects) in Paso 3
 *
 * PR2: TypeScript migration from configPanel.js
 */
import { VARIABLE_YEARS, SEASONS } from '../config.js';
import { updateStepValidity } from './taskFlow.js';
import { getTaskFlowStepValidity } from '../state/mapState.js';
/**
 * ConfigPanel singleton
 */
class ConfigPanel {
    constructor() {
        this.yearSelect = null;
        this.seasonSelect = null;
        this.generateBtn = null;
        this.currentVariable = 'ndvi';
        this.listeners = [];
    }
    /**
     * Initialize the config panel
     */
    init() {
        this.yearSelect = document.getElementById('tflow-year-select');
        this.seasonSelect = document.getElementById('tflow-season-select');
        this.generateBtn = document.getElementById('tflow-generate-btn');
        if (!this.yearSelect || !this.seasonSelect || !this.generateBtn) {
            console.warn('[ConfigPanel] Required elements not found');
            return;
        }
        this.setupEventListeners();
        this.updateGenerateButton();
    }
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (!this.yearSelect || !this.seasonSelect || !this.generateBtn)
            return;
        // Year select change
        this.yearSelect.addEventListener('change', () => {
            if (!this.yearSelect || !this.seasonSelect)
                return;
            const hasYear = Boolean(this.yearSelect.value);
            this.seasonSelect.disabled = !hasYear;
            if (!hasYear) {
                this.seasonSelect.value = '';
            }
            else {
                this.populateSeasonSelect();
            }
            this.updateGenerateButton();
            this.notifyListeners('yearChange', { year: this.yearSelect.value });
        });
        // Season select change
        this.seasonSelect.addEventListener('change', () => {
            if (!this.yearSelect || !this.seasonSelect)
                return;
            this.updateGenerateButton();
            this.notifyListeners('seasonChange', {
                year: this.yearSelect.value,
                season: this.seasonSelect.value,
            });
        });
        // Generate button click
        this.generateBtn.addEventListener('click', () => {
            if (!this.generateBtn || !this.yearSelect || !this.seasonSelect)
                return;
            if (this.generateBtn.disabled)
                return;
            // Verify config step validity before generating
            if (!getTaskFlowStepValidity('config'))
                return;
            const year = Number(this.yearSelect.value);
            const season = this.seasonSelect.value;
            document.dispatchEvent(new CustomEvent('tflowGenerateAnimation', {
                detail: {
                    variable: this.currentVariable,
                    year,
                    season,
                },
            }));
        });
        // Listen for variable changes
        document.addEventListener('variableSelected', (e) => {
            const detail = e.detail;
            const { variable } = detail || {};
            if (variable) {
                this.currentVariable = variable;
                this.populateYearSelect(variable);
                this.resetSeasonSelect();
                this.updateGenerateButton();
            }
        });
    }
    /**
     * Populate year select for a specific variable
     * @param variable - Variable key
     */
    populateYearSelect(variable) {
        if (!this.yearSelect)
            return;
        this.currentVariable = variable;
        // Clear existing options except placeholder
        while (this.yearSelect.options.length > 1) {
            this.yearSelect.remove(1);
        }
        // Get years for variable
        const years = VARIABLE_YEARS[variable] || [];
        // Populate options
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            this.yearSelect.appendChild(option);
        });
        // Reset to placeholder
        this.yearSelect.value = '';
    }
    /**
     * Populate season select with standard seasons
     */
    populateSeasonSelect() {
        if (!this.seasonSelect)
            return;
        // Clear existing options except placeholder
        while (this.seasonSelect.options.length > 1) {
            this.seasonSelect.remove(1);
        }
        // Populate with standard seasons
        SEASONS.forEach((s) => {
            const option = document.createElement('option');
            option.value = s.value;
            option.textContent = s.label;
            this.seasonSelect.appendChild(option);
        });
    }
    /**
     * Reset season select to disabled state
     */
    resetSeasonSelect() {
        if (!this.seasonSelect)
            return;
        this.seasonSelect.value = '';
        this.seasonSelect.disabled = true;
    }
    /**
     * Update generate button disabled state
     */
    updateGenerateButton() {
        if (!this.generateBtn || !this.yearSelect || !this.seasonSelect)
            return;
        const hasYear = Boolean(this.yearSelect.value);
        const hasSeason = Boolean(this.seasonSelect.value);
        // Check if bbox exists via mapState (will be checked at click time too)
        this.generateBtn.disabled = !(hasYear && hasSeason);
        // Update taskFlow validity directly (single source of truth)
        const isValid = hasYear && hasSeason;
        updateStepValidity('config', isValid);
        // Keep event for backward compatibility with other listeners
        document.dispatchEvent(new CustomEvent('configValidityChanged', {
            detail: { isValid },
        }));
    }
    /**
     * Get current configuration values
     * @returns Current config
     */
    getConfig() {
        var _a, _b;
        return {
            variable: this.currentVariable,
            year: ((_a = this.yearSelect) === null || _a === void 0 ? void 0 : _a.value) || null,
            season: ((_b = this.seasonSelect) === null || _b === void 0 ? void 0 : _b.value) || null,
        };
    }
    /**
     * Set the generate button loading state
     * @param isLoading - Whether button should show loading state
     */
    setLoading(isLoading) {
        if (!this.generateBtn)
            return;
        this.generateBtn.disabled = isLoading;
        this.generateBtn.textContent = isLoading ? 'Generando…' : 'Generar animación';
        this.generateBtn.classList.toggle('loading', isLoading);
    }
    /**
     * Add a listener for config panel events
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
                console.error('[ConfigPanel] Listener error:', err);
            }
        });
    }
    /**
     * Reset to initial state
     */
    reset() {
        this.currentVariable = 'ndvi';
        if (this.yearSelect) {
            this.yearSelect.value = '';
        }
        this.resetSeasonSelect();
        this.updateGenerateButton();
        this.setLoading(false);
    }
}
// Export singleton instance
export const configPanel = new ConfigPanel();
// Convenience exports
export const init = () => configPanel.init();
export const populateYearSelect = (variable) => configPanel.populateYearSelect(variable);
export const populateSeasonSelect = () => configPanel.populateSeasonSelect();
export const updateGenerateButton = () => configPanel.updateGenerateButton();
export const getConfig = () => configPanel.getConfig();
export const setLoading = (isLoading) => configPanel.setLoading(isLoading);
export const addListener = (listener) => configPanel.addListener(listener);
export const removeListener = (listener) => configPanel.removeListener(listener);
export const reset = () => configPanel.reset();
export { ConfigPanel };
//# sourceMappingURL=configPanel.js.map