import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the DOM and document before importing the module
const mockElements = new Map();

function createMockElement(id) {
  const element = {
    id,
    classList: {
      classes: new Set(),
      add(cls) {
        this.classes.add(cls);
      },
      remove(cls) {
        this.classes.delete(cls);
      },
      toggle(cls, force) {
        if (force === undefined) {
          if (this.classes.has(cls)) this.classes.delete(cls);
          else this.classes.add(cls);
        } else if (force) {
          this.classes.add(cls);
        } else {
          this.classes.delete(cls);
        }
      },
      contains(cls) {
        return this.classes.has(cls);
      },
    },
    className: '',
  };
  mockElements.set(id, element);
  return element;
}

// Setup global document mock
global.document = {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  getElementById: vi.fn(id => mockElements.get(id) || createMockElement(id)),
};

// Import mapState to reset it between tests
import * as mapState from '../../static/state/mapState.js';

// Import the module after mocking
describe('TaskFlowController', () => {
  let taskFlowController;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockElements.clear();

    // Reset mapState to get clean taskFlow state
    // NOTE: vi.resetModules() is NOT used because taskFlowController
    // now has no internal state — it reads from mapState on every call.
    // Re-creating the module would create a different mapState instance
    // than the one imported statically at the top of this file.
    mapState.resetState();

    // Get the singleton (it will use the fresh mapState)
    const module = await import('../../static/sidebar/taskFlow.js');
    taskFlowController = module.taskFlowController;

    // Reset UI state
    taskFlowController.reset();
  });

  describe('Initialization', () => {
    it('should start with area as current step', () => {
      expect(taskFlowController.getCurrentStep()).toBe('area');
    });

    it('should have area as active state initially', () => {
      const states = taskFlowController.getStepStates();
      expect(states.area).toBe('active');
    });

    it('should have other steps as pending initially', () => {
      const states = taskFlowController.getStepStates();
      expect(states.variable).toBe('pending');
      expect(states.config).toBe('pending');
      expect(states.explore).toBe('pending');
    });

    it('should have all steps invalid initially', () => {
      expect(taskFlowController.getStepValidity('area')).toBe(false);
      expect(taskFlowController.getStepValidity('variable')).toBe(false);
      expect(taskFlowController.getStepValidity('config')).toBe(false);
      expect(taskFlowController.getStepValidity('explore')).toBe(false);
    });
  });

  describe('Step Transitions', () => {
    it('should transition to variable step', () => {
      taskFlowController.transitionTo('variable');
      expect(taskFlowController.getCurrentStep()).toBe('variable');
    });

    it('should mark previous steps as complete when transitioning', () => {
      taskFlowController.transitionTo('config');
      const states = taskFlowController.getStepStates();
      expect(states.area).toBe('complete');
      expect(states.variable).toBe('complete');
      expect(states.config).toBe('active');
    });

    it('should not change states for steps after current', () => {
      taskFlowController.transitionTo('variable');
      const states = taskFlowController.getStepStates();
      expect(states.config).toBe('pending');
      expect(states.explore).toBe('pending');
    });

    it('should handle invalid step gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      taskFlowController.transitionTo('invalid');
      expect(consoleSpy).toHaveBeenCalledWith('[TaskFlow] Invalid step: invalid');
      consoleSpy.mockRestore();
    });

    it('should update mapState currentStep on transition', () => {
      taskFlowController.transitionTo('config');
      expect(mapState.getTaskFlowStep()).toBe('config');
    });
  });

  describe('Step Validity', () => {
    it('should update step validity', () => {
      taskFlowController.updateStepValidity('area', true);
      expect(taskFlowController.getStepValidity('area')).toBe(true);
    });

    it('should update UI when area validity changes to true', () => {
      const hintEl = createMockElement('tflow-hint');
      const statusEl = createMockElement('tflow-area-status');

      taskFlowController.updateStepValidity('area', true);

      expect(hintEl.classList.contains('hidden')).toBe(true);
      expect(statusEl.classList.contains('hidden')).toBe(false);
    });

    it('should update UI when area validity changes to false', () => {
      const hintEl = createMockElement('tflow-hint');
      const statusEl = createMockElement('tflow-area-status');

      taskFlowController.updateStepValidity('area', true);
      taskFlowController.updateStepValidity('area', false);

      expect(hintEl.classList.contains('hidden')).toBe(false);
      expect(statusEl.classList.contains('hidden')).toBe(true);
    });

    it('should ignore invalid step names', () => {
      taskFlowController.updateStepValidity('invalidStep', true);
      // Should not throw
      expect(taskFlowController.getStepValidity('invalidStep')).toBe(false);
    });

    it('should sync validity to mapState', () => {
      taskFlowController.updateStepValidity('config', true);
      expect(mapState.getTaskFlowStepValidity('config')).toBe(true);
    });
  });

  describe('Step Status Updates', () => {
    it('should update step status', () => {
      taskFlowController.updateStepStatus('config', 'generating');
      const states = taskFlowController.getStepStates();
      expect(states.config).toBe('generating');
    });

    it('should ignore invalid step names for status updates', () => {
      taskFlowController.updateStepStatus('invalid', 'active');
      // Should not throw
    });

    it('should ignore invalid status values', () => {
      taskFlowController.updateStepStatus('area', 'invalid-status');
      const states = taskFlowController.getStepStates();
      expect(states.area).toBe('active'); // Unchanged
    });

    it('should sync status to mapState', () => {
      taskFlowController.updateStepStatus('config', 'generating');
      const tf = mapState.getTaskFlowState();
      expect(tf.steps.config.status).toBe('generating');
    });
  });

  describe('Disable/Enable Steps', () => {
    it('should disable all steps', () => {
      taskFlowController.setStepsDisabled(true);
      expect(taskFlowController.isDisabled).toBe(true);
    });

    it('should enable all steps', () => {
      taskFlowController.setStepsDisabled(true);
      taskFlowController.setStepsDisabled(false);
      expect(taskFlowController.isDisabled).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should reset to initial state', () => {
      taskFlowController.transitionTo('explore');
      taskFlowController.updateStepValidity('area', true);

      taskFlowController.reset();

      expect(taskFlowController.getCurrentStep()).toBe('area');
      expect(taskFlowController.getStepValidity('area')).toBe(false);
    });

    it('should reset hint visibility', () => {
      const hintEl = createMockElement('tflow-hint');
      const statusEl = createMockElement('tflow-area-status');

      taskFlowController.updateStepValidity('area', true);
      taskFlowController.reset();

      expect(hintEl.classList.contains('hidden')).toBe(false);
      expect(statusEl.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Event Listeners', () => {
    it('should add and notify listeners', () => {
      const listener = vi.fn();
      taskFlowController.addListener(listener);

      taskFlowController.transitionTo('variable');

      expect(listener).toHaveBeenCalledWith('transition', expect.any(Object));
    });

    it('should remove listeners', () => {
      const listener = vi.fn();
      taskFlowController.addListener(listener);
      taskFlowController.removeListener(listener);

      taskFlowController.transitionTo('variable');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
