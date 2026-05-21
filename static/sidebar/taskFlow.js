/**
 * Task Flow Controller — distributionMapApp
 *
 * Manages the 4-step sidebar flow:
 * 1. Área → 2. Variable → 3. Configurar → 4. Explorar
 *
 * PR1: Single source of truth via mapState.
 * All state is delegated to mapState; this controller only handles
 * UI updates and event orchestration.
 */
import * as mapState from '../state/mapState.js';
// Step states as const object
const STEP_STATES = {
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETE: 'complete',
    GENERATING: 'generating',
};
// Step order
const STEPS = ['area', 'variable', 'config', 'explore'];
/**
 * TaskFlowController singleton
 *
 * PR1: No internal state — all reads/writes go through mapState.
 */
class TaskFlowController {
    constructor() {
        this.isDisabled = false;
        this.listeners = [];
    }
    /**
     * Initialize the task flow controller
     */
    init() {
        this.updateUI();
        this.setupEventListeners();
    }
    /**
     * Setup DOM event listeners
     */
    setupEventListeners() {
        // Listen for bbox changes via custom event
        document.addEventListener('bboxChanged', (e) => {
            const detail = e.detail;
            const { hasBbox } = detail || {};
            this.updateStepValidity('area', Boolean(hasBbox));
            if (hasBbox) {
                this.transitionTo('variable');
            }
            else {
                this.transitionTo('area');
                // Reset subsequent steps
                mapState.updateTaskFlowStepStatus('variable', STEP_STATES.PENDING);
                mapState.updateTaskFlowStepStatus('config', STEP_STATES.PENDING);
                mapState.updateTaskFlowStepStatus('explore', STEP_STATES.PENDING);
                this.updateUI();
            }
        });
        // Listen for variable selection
        document.addEventListener('variableSelected', (e) => {
            const detail = e.detail;
            const { variable } = detail || {};
            if (variable) {
                this.updateStepValidity('variable', true);
                this.transitionTo('config');
            }
        });
        // Listen for config validity changes
        document.addEventListener('configValidityChanged', (e) => {
            const detail = e.detail;
            const { isValid } = detail || {};
            this.updateStepValidity('config', Boolean(isValid));
            if (isValid) {
                this.transitionTo('explore');
            }
        });
        // Listen for generation start
        document.addEventListener('generationStarted', () => {
            mapState.updateTaskFlowStepStatus('config', STEP_STATES.GENERATING);
            this.updateUI();
        });
        // Listen for generation complete
        document.addEventListener('generationComplete', () => {
            mapState.updateTaskFlowStepStatus('config', STEP_STATES.COMPLETE);
            this.updateUI();
        });
    }
    /**
     * Transition to a specific step
     * @param step - Step name ('area', 'variable', 'config', 'explore')
     */
    transitionTo(step) {
        if (!STEPS.includes(step)) {
            console.warn(`[TaskFlow] Invalid step: ${step}`);
            return;
        }
        mapState.setTaskFlowStep(step);
        // Update states based on transition
        const stepIndex = STEPS.indexOf(step);
        STEPS.forEach((s, index) => {
            if (index < stepIndex) {
                mapState.updateTaskFlowStepStatus(s, STEP_STATES.COMPLETE);
            }
            else if (index === stepIndex) {
                mapState.updateTaskFlowStepStatus(s, STEP_STATES.ACTIVE);
            }
        });
        this.updateUI();
        this.notifyListeners('transition', { step, states: this.getStepStates() });
    }
    /**
     * Update the status of a specific step
     * @param step - Step name
     * @param status - New status ('pending', 'active', 'complete', 'generating')
     */
    updateStepStatus(step, status) {
        if (!STEPS.includes(step))
            return;
        mapState.updateTaskFlowStepStatus(step, status);
        this.updateUI();
        this.notifyListeners('statusChange', { step, status });
    }
    /**
     * Update the validity of a specific step
     * @param step - Step name
     * @param isValid - Whether step is valid
     */
    updateStepValidity(step, isValid) {
        if (!STEPS.includes(step))
            return;
        mapState.updateTaskFlowStepValidity(step, isValid);
        // Update UI elements based on validity
        if (step === 'area') {
            const hintEl = document.getElementById('tflow-hint');
            const statusEl = document.getElementById('tflow-area-status');
            if (hintEl && statusEl) {
                hintEl.classList.toggle('hidden', isValid);
                statusEl.classList.toggle('hidden', !isValid);
            }
        }
        this.notifyListeners('validityChange', { step, isValid });
    }
    /**
     * Get current step validity
     * @param step - Step name
     * @returns Whether step is valid
     */
    getStepValidity(step) {
        return mapState.getTaskFlowStepValidity(step);
    }
    /**
     * Enable/disable all steps (for special modes)
     * @param disabled - Whether to disable steps
     */
    setStepsDisabled(disabled) {
        this.isDisabled = disabled;
        const container = document.getElementById('tflow-container');
        if (container) {
            container.classList.toggle('disabled', disabled);
        }
        STEPS.forEach(step => {
            const stepEl = document.getElementById(`tflow-${step}`);
            if (stepEl) {
                stepEl.classList.toggle('disabled', disabled);
            }
        });
        this.notifyListeners('disabledChange', { disabled });
    }
    /**
     * Get current step
     * @returns Current step name
     */
    getCurrentStep() {
        return mapState.getTaskFlowStep();
    }
    /**
     * Get all step states
     * @returns Record of step names to status strings
     */
    getStepStates() {
        const tf = mapState.getTaskFlowState();
        const states = {};
        STEPS.forEach(step => {
            var _a;
            states[step] = ((_a = tf.steps[step]) === null || _a === void 0 ? void 0 : _a.status) || 'pending';
        });
        return states;
    }
    /**
     * Update the visual UI based on current states
     */
    updateUI() {
        const tf = mapState.getTaskFlowState();
        STEPS.forEach(step => {
            var _a;
            const stepEl = document.getElementById(`tflow-${step}`);
            if (!stepEl)
                return;
            // Remove all state classes
            stepEl.classList.remove('tflow-step--pending', 'tflow-step--active', 'tflow-step--complete', 'tflow-step--generating');
            // Add current state class
            const state = ((_a = tf.steps[step]) === null || _a === void 0 ? void 0 : _a.status) || STEP_STATES.PENDING;
            stepEl.classList.add(`tflow-step--${state}`);
        });
    }
    /**
     * Add a listener for task flow events
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
                console.error('[TaskFlow] Listener error:', err);
            }
        });
    }
    /**
     * Reset the flow to initial state
     */
    reset() {
        mapState.resetState();
        // Reset hint visibility
        const hintEl = document.getElementById('tflow-hint');
        const statusEl = document.getElementById('tflow-area-status');
        if (hintEl && statusEl) {
            hintEl.classList.remove('hidden');
            statusEl.classList.add('hidden');
        }
        this.updateUI();
        this.notifyListeners('reset', {});
    }
}
// Export singleton instance
export const taskFlowController = new TaskFlowController();
// Convenience exports
export const init = () => taskFlowController.init();
export const transitionTo = (step) => taskFlowController.transitionTo(step);
export const updateStepStatus = (step, status) => taskFlowController.updateStepStatus(step, status);
export const updateStepValidity = (step, isValid) => taskFlowController.updateStepValidity(step, isValid);
export const getStepValidity = (step) => taskFlowController.getStepValidity(step);
export const setStepsDisabled = (disabled) => taskFlowController.setStepsDisabled(disabled);
export const getCurrentStep = () => taskFlowController.getCurrentStep();
export const getStepStates = () => taskFlowController.getStepStates();
export const reset = () => taskFlowController.reset();
export const addListener = (listener) => taskFlowController.addListener(listener);
export const removeListener = (listener) => taskFlowController.removeListener(listener);
export { TaskFlowController };
//# sourceMappingURL=taskFlow.js.map