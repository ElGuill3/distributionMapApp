import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mapState from '../../static/state/mapState.js';

// Simple DOM mock
global.document = {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  getElementById: vi.fn(() => null),
  createElement: vi.fn(() => ({ value: '', textContent: '' })),
};

global.CustomEvent = class CustomEvent {
  constructor(type, detail) {
    this.type = type;
    this.detail = detail?.detail || detail;
  }
};

describe('VariableSelector', () => {
  let variableSelector;
  let taskFlowController;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset mapState to ensure clean state
    mapState.resetState();

    // Import fresh instances
    const tfModule = await import('../../static/sidebar/taskFlow.js');
    taskFlowController = tfModule.taskFlowController;
    taskFlowController.reset();

    const module = await import('../../static/sidebar/variableSelector.js');
    variableSelector = module.variableSelector;

    // Reset state
    variableSelector.activeVariable = 'ndvi';
    variableSelector.listeners = [];
    variableSelector.chipContainer = null;
  });

  describe('Initialization', () => {
    it('should have ndvi as default active variable', () => {
      expect(variableSelector.getActiveVariable()).toBe('ndvi');
    });

    it('should warn when chip container not found', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      variableSelector.initChipContainer();
      
      expect(consoleSpy).toHaveBeenCalledWith('[VariableSelector] Chip container not found');
      consoleSpy.mockRestore();
    });
  });

  describe('Variable Selection', () => {
    it('should set active chip to valid variable', () => {
      // Mock year select element
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });
      
      variableSelector.setActiveChip('temp');
      expect(variableSelector.getActiveVariable()).toBe('temp');
    });

    it('should not change for invalid variable', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      variableSelector.setActiveChip('invalid');
      expect(variableSelector.getActiveVariable()).toBe('ndvi');
      consoleSpy.mockRestore();
    });

    it('should dispatch variableSelected event on change', () => {
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });
      
      const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
      variableSelector.setActiveChip('temp');
      
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'variableSelected',
          detail: { variable: 'temp' },
        })
      );
    });

    it('should notify listeners on change', () => {
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });
      
      const listener = vi.fn();
      variableSelector.addListener(listener);
      variableSelector.setActiveChip('temp');
      
      expect(listener).toHaveBeenCalledWith('change', { variable: 'temp' });
    });
  });

  describe('Event Listeners', () => {
    it('should add and remove listeners', () => {
      const listener = vi.fn();
      variableSelector.addListener(listener);
      variableSelector.removeListener(listener);
      
      variableSelector.notifyListeners('test', {});
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should notify all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      variableSelector.addListener(listener1);
      variableSelector.addListener(listener2);
      
      variableSelector.notifyListeners('test', { data: true });
      
      expect(listener1).toHaveBeenCalledWith('test', { data: true });
      expect(listener2).toHaveBeenCalledWith('test', { data: true });
    });

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => { throw new Error('Test error'); });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      variableSelector.addListener(errorListener);
      variableSelector.notifyListeners('test', {});
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('PR2: MapState and TaskFlow Integration', () => {
    it('should dispatch variableSelected event with correct variable', () => {
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });

      const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
      variableSelector.setActiveChip('temp');

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'variableSelected',
          detail: { variable: 'temp' },
        })
      );
    });

    it('should transition taskFlow to config when chip selected', () => {
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });

      taskFlowController.reset();
      variableSelector.setActiveChip('temp');
      expect(taskFlowController.getCurrentStep()).toBe('config');
    });

    it('should not transition taskFlow for invalid variable', () => {
      taskFlowController.reset();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      variableSelector.setActiveChip('invalid');
      expect(taskFlowController.getCurrentStep()).toBe('area');
      consoleSpy.mockRestore();
    });
  });

  describe('Reset', () => {
    it('should reset to default variable', () => {
      const mockYearSelect = {
        options: [{ value: '' }],
        value: '',
        remove: vi.fn(),
        appendChild: vi.fn(),
      };
      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        return null;
      });
      
      variableSelector.setActiveChip('temp');
      variableSelector.reset();
      
      expect(variableSelector.getActiveVariable()).toBe('ndvi');
    });
  });

  describe('Year Select Population', () => {
    it('should handle missing year select gracefully', () => {
      global.document.getElementById = vi.fn(() => null);
      
      expect(() => variableSelector.populateYearSelect()).not.toThrow();
    });
  });
});
