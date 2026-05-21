/**
 * Modo Section — distributionMapApp
 *
 * Manages the MODO section (Compare and Flood Risk toggles)
 *
 * PR2: TypeScript migration from modoSection.js
 */

/**
 * Valid modo types
 */
export type ModoType = 'compare' | 'flood';

/**
 * Listener callback for modo section events
 */
export type ModoChangeListener = (event: string, data?: ModoEventData) => void;

/**
 * Data emitted with modo events
 */
export interface ModoEventData {
  modo?: ModoType;
  previousModo?: ModoType | null;
  disabled?: boolean;
}

/**
 * ModoSection singleton
 */
class ModoSection {
  modoSection: HTMLElement | null = null;
  compareToggle: HTMLButtonElement | null = null;
  floodToggle: HTMLButtonElement | null = null;
  activeModo: ModoType | null = null; // 'compare' | 'flood' | null
  private listeners: ModoChangeListener[] = [];

  /**
   * Initialize the modo section
   */
  init(): void {
    this.modoSection = document.getElementById('tflow-modo-section');
    this.compareToggle = document.getElementById('toggleCompareMode') as HTMLButtonElement | null;
    this.floodToggle = document.getElementById('toggleFloodRiskMode') as HTMLButtonElement | null;

    if (!this.modoSection || !this.compareToggle || !this.floodToggle) {
      console.warn('[ModoSection] Required elements not found');
      return;
    }

    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    if (!this.compareToggle || !this.floodToggle) return;

    // Compare mode toggle
    this.compareToggle.addEventListener('click', () => {
      if (!this.compareToggle) return;
      const isActive = this.compareToggle.getAttribute('aria-pressed') === 'true';

      if (isActive) {
        this.deactivateAll();
      } else {
        this.activateModo('compare');
      }
    });

    // Flood risk toggle
    this.floodToggle.addEventListener('click', () => {
      if (!this.floodToggle) return;
      const isActive = this.floodToggle.getAttribute('aria-pressed') === 'true';

      if (isActive) {
        this.deactivateAll();
      } else {
        this.activateModo('flood');
      }
    });
  }

  /**
   * Activate a specific modo
   * @param modo - 'compare' or 'flood'
   */
  activateModo(modo: ModoType): void {
    if (modo !== 'compare' && modo !== 'flood') {
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

      // Disable task flow steps 1-2
      this.disableTaskFlowSteps();

      // Dispatch event
      document.dispatchEvent(new CustomEvent('compareModeActivated'));
    } else if (modo === 'flood') {
      if (this.floodToggle) {
        this.floodToggle.setAttribute('aria-pressed', 'true');
        this.floodToggle.classList.add('modo-toggle--active');
      }

      // Disable task flow steps 1-2
      this.disableTaskFlowSteps();

      // Dispatch event
      document.dispatchEvent(new CustomEvent('floodRiskModeActivated'));
    }

    this.notifyListeners('activate', { modo });
  }

  /**
   * Deactivate all modos
   */
  deactivateAll(): void {
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

    // Re-enable task flow steps
    this.enableTaskFlowSteps();

    // Dispatch event
    if (previousModo === 'compare') {
      document.dispatchEvent(new CustomEvent('compareModeDeactivated'));
    } else if (previousModo === 'flood') {
      document.dispatchEvent(new CustomEvent('floodRiskModeDeactivated'));
    }

    document.dispatchEvent(new CustomEvent('modoDeactivated', {
      detail: { previousModo },
    }));

    this.notifyListeners('deactivate', { previousModo });
  }

  /**
   * Disable task flow steps (for special modes)
   */
  private disableTaskFlowSteps(): void {
    const steps = ['tflow-area', 'tflow-variable'];
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
  private enableTaskFlowSteps(): void {
    const steps = ['tflow-area', 'tflow-variable'];
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
  getActiveModo(): ModoType | null {
    return this.activeModo;
  }

  /**
   * Check if a specific modo is active
   * @param modo - 'compare' or 'flood'
   * @returns {boolean}
   */
  isModoActive(modo: ModoType): boolean {
    return this.activeModo === modo;
  }

  /**
   * Add a listener for modo events
   * @param listener - Callback function
   */
  addListener(listener: ModoChangeListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener
   * @param listener - Callback function to remove
   */
  removeListener(listener: ModoChangeListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Notify all listeners of an event
   * @param event - Event type
   * @param data - Event data
   */
  private notifyListeners(event: string, data?: ModoEventData): void {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[ModoSection] Listener error:', err);
      }
    });
  }
}

// Export singleton instance
export const modoSection = new ModoSection();

// Convenience exports
export const init = (): void => modoSection.init();
export const activateModo = (modo: ModoType): void => modoSection.activateModo(modo);
export const deactivateAll = (): void => modoSection.deactivateAll();
export const getActiveModo = (): ModoType | null => modoSection.getActiveModo();
export const isModoActive = (modo: ModoType): boolean => modoSection.isModoActive(modo);
export const addListener = (listener: ModoChangeListener): void => modoSection.addListener(listener);
export const removeListener = (listener: ModoChangeListener): void =>
  modoSection.removeListener(listener);
export { ModoSection };