/**
 * Modo Section — distributionMapApp
 *
 * Manages the MODO section (Compare and Flood Risk toggles)
 *
 * PR2: TypeScript migration from modoSection.js
 */
/**
 * ModoSection singleton
 */
class ModoSection {
    constructor() {
        this.modoSection = null;
        this.compareToggle = null;
        this.floodToggle = null;
        this.inundacionesToggle = null;
        this.activeModo = null; // 'compare' | 'flood' | 'inundaciones' | null
        this.listeners = [];
    }
    /**
     * Initialize the modo section
     */
    init() {
        this.modoSection = document.getElementById('tflow-modo-section');
        this.compareToggle = document.getElementById('toggleCompareMode');
        this.floodToggle = document.getElementById('toggleFloodRiskMode');
        this.inundacionesToggle = document.getElementById('toggleInundacionesMode');
        if (!this.modoSection ||
            !this.compareToggle ||
            !this.floodToggle ||
            !this.inundacionesToggle) {
            console.warn('[ModoSection] Required elements not found');
            return;
        }
        this.setupEventListeners();
    }
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (!this.compareToggle || !this.floodToggle || !this.inundacionesToggle)
            return;
        // Compare mode toggle
        this.compareToggle.addEventListener('click', () => {
            if (!this.compareToggle)
                return;
            const isActive = this.compareToggle.getAttribute('aria-pressed') === 'true';
            if (isActive) {
                this.deactivateAll();
            }
            else {
                this.activateModo('compare');
            }
        });
        // Flood risk toggle
        this.floodToggle.addEventListener('click', () => {
            if (!this.floodToggle)
                return;
            const isActive = this.floodToggle.getAttribute('aria-pressed') === 'true';
            if (isActive) {
                this.deactivateAll();
            }
            else {
                this.activateModo('flood');
            }
        });
        // Inundaciones toggle
        this.inundacionesToggle.addEventListener('click', () => {
            if (!this.inundacionesToggle)
                return;
            const isActive = this.inundacionesToggle.getAttribute('aria-pressed') === 'true';
            if (isActive) {
                this.deactivateAll();
            }
            else {
                this.activateModo('inundaciones');
            }
        });
    }
    /**
     * Activate a specific modo
     * @param modo - 'compare' or 'flood'
     */
    activateModo(modo) {
        if (modo !== 'compare' && modo !== 'flood' && modo !== 'inundaciones') {
            console.warn(`[ModoSection] Invalid modo: ${modo}`);
            return;
        }
        // Deactivate other modo first
        this.deactivateAll();
        this.activeModo = modo;
        if (modo === 'compare') {
            if (this.compareToggle) {
                this.compareToggle.setAttribute('aria-pressed', 'true');
                this.compareToggle.classList.add('modo-toggle--active');
            }
            // Disable all task flow steps on the left
            this.disableTaskFlowSteps([
                'tflow-area',
                'tflow-variable',
                'tflow-config',
                'tflow-explore',
            ]);
            // Dispatch event
            document.dispatchEvent(new CustomEvent('compareModeActivated'));
        }
        else if (modo === 'flood') {
            if (this.floodToggle) {
                this.floodToggle.setAttribute('aria-pressed', 'true');
                this.floodToggle.classList.add('modo-toggle--active');
            }
            // Disable all task flow steps on the left
            this.disableTaskFlowSteps([
                'tflow-area',
                'tflow-variable',
                'tflow-config',
                'tflow-explore',
            ]);
            // Dispatch event
            document.dispatchEvent(new CustomEvent('floodRiskModeActivated'));
        }
        else if (modo === 'inundaciones') {
            if (this.inundacionesToggle) {
                this.inundacionesToggle.setAttribute('aria-pressed', 'true');
                this.inundacionesToggle.classList.add('modo-toggle--active');
            }
            // Disable variable, config, and explore steps (keep area active for drawing bbox)
            this.disableTaskFlowSteps(['tflow-variable', 'tflow-config', 'tflow-explore']);
            // Dispatch event
            document.dispatchEvent(new CustomEvent('inundacionesModeActivated'));
        }
        this.notifyListeners('activate', { modo });
    }
    /**
     * Deactivate all modos
     */
    deactivateAll() {
        const previousModo = this.activeModo;
        this.activeModo = null;
        if (this.compareToggle) {
            this.compareToggle.setAttribute('aria-pressed', 'false');
            this.compareToggle.classList.remove('modo-toggle--active');
        }
        if (this.floodToggle) {
            this.floodToggle.setAttribute('aria-pressed', 'false');
            this.floodToggle.classList.remove('modo-toggle--active');
        }
        if (this.inundacionesToggle) {
            this.inundacionesToggle.setAttribute('aria-pressed', 'false');
            this.inundacionesToggle.classList.remove('modo-toggle--active');
        }
        // Re-enable task flow steps
        this.enableTaskFlowSteps();
        // Dispatch event
        if (previousModo === 'compare') {
            document.dispatchEvent(new CustomEvent('compareModeDeactivated'));
        }
        else if (previousModo === 'flood') {
            document.dispatchEvent(new CustomEvent('floodRiskModeDeactivated'));
        }
        else if (previousModo === 'inundaciones') {
            document.dispatchEvent(new CustomEvent('inundacionesModeDeactivated'));
        }
        document.dispatchEvent(new CustomEvent('modoDeactivated', {
            detail: { previousModo },
        }));
        this.notifyListeners('deactivate', { previousModo });
    }
    /**
     * Disable task flow steps (for special modes)
     */
    disableTaskFlowSteps(steps = ['tflow-area', 'tflow-variable']) {
        steps.forEach(id => {
            const step = document.getElementById(id);
            if (step) {
                step.classList.add('disabled');
            }
        });
        // Dispatch to task flow controller
        document.dispatchEvent(new CustomEvent('taskFlowDisabled', {
            detail: { disabled: true },
        }));
    }
    /**
     * Enable task flow steps
     */
    enableTaskFlowSteps() {
        const steps = ['tflow-area', 'tflow-variable', 'tflow-config', 'tflow-explore'];
        steps.forEach(id => {
            const step = document.getElementById(id);
            if (step) {
                step.classList.remove('disabled');
            }
        });
        // Dispatch to task flow controller
        document.dispatchEvent(new CustomEvent('taskFlowDisabled', {
            detail: { disabled: false },
        }));
    }
    /**
     * Get currently active modo
     * @returns {ModoType | null}
     */
    getActiveModo() {
        return this.activeModo;
    }
    /**
     * Check if a specific modo is active
     * @param modo - 'compare' or 'flood'
     * @returns {boolean}
     */
    isModoActive(modo) {
        return this.activeModo === modo;
    }
    /**
     * Add a listener for modo events
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
                console.error('[ModoSection] Listener error:', err);
            }
        });
    }
}
// Export singleton instance
export const modoSection = new ModoSection();
// Convenience exports
export const init = () => modoSection.init();
export const activateModo = (modo) => modoSection.activateModo(modo);
export const deactivateAll = () => modoSection.deactivateAll();
export const getActiveModo = () => modoSection.getActiveModo();
export const isModoActive = (modo) => modoSection.isModoActive(modo);
export const addListener = (listener) => modoSection.addListener(listener);
export const removeListener = (listener) => modoSection.removeListener(listener);
export { ModoSection };
//# sourceMappingURL=modoSection.js.map