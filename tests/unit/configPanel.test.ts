import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ConfigPanel', () => {
  let configPanel;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    
    // Mock config module before importing
    vi.doMock('../../static/config.js', () => ({
      VARIABLE_YEARS: {
        ndvi: [2000, 2001, 2002],
        temp: [2000, 2001],
      },
      SEASONS: [
        { value: 'invierno', label: 'Invierno' },
        { value: 'verano', label: 'Verano' },
      ],
    }));
    
    const module = await import('../../static/sidebar/configPanel.js');
    configPanel = module.configPanel;
    
    // Reset state
    configPanel.currentVariable = 'ndvi';
    configPanel.listeners = [];
  });

  afterEach(() => {
    vi.doUnmock('../../static/config.js');
  });

  describe('Configuration Management', () => {
    it('should initialize with default variable', () => {
      expect(configPanel.currentVariable).toBe('ndvi');
    });

    it('should get current config with null values when not set', () => {
      const config = configPanel.getConfig();
      
      expect(config.variable).toBe('ndvi');
      expect(config.year).toBeNull();
      expect(config.season).toBeNull();
    });
  });

  describe('Event Listeners', () => {
    it('should add listeners', () => {
      const listener = vi.fn();
      configPanel.addListener(listener);
      
      configPanel.notifyListeners('test', { data: true });
      
      expect(listener).toHaveBeenCalledWith('test', { data: true });
    });

    it('should remove listeners', () => {
      const listener = vi.fn();
      configPanel.addListener(listener);
      configPanel.removeListener(listener);
      
      configPanel.notifyListeners('test', {});
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => { throw new Error('Test error'); });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      configPanel.addListener(errorListener);
      configPanel.notifyListeners('test', {});
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Reset', () => {
    it('should reset to default variable', () => {
      configPanel.currentVariable = 'temp';
      configPanel.reset();
      expect(configPanel.currentVariable).toBe('ndvi');
    });
  });

  describe('PR2: TaskFlow Integration', () => {
    beforeEach(() => {
      // Set up minimal mock DOM for configPanel methods
      global.document = {
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        getElementById: vi.fn(() => null),
        createElement: vi.fn(() => ({ value: '', textContent: '' })),
      };
      global.CustomEvent = class CustomEvent {
        constructor(type, options) {
          this.type = type;
          this.detail = options?.detail;
        }
      };
    });

    it('should dispatch configValidityChanged when year+season filled', () => {
      configPanel.yearSelect = { value: '2023' };
      configPanel.seasonSelect = { value: 'verano' };
      configPanel.generateBtn = { disabled: true };

      configPanel.updateGenerateButton();

      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'configValidityChanged',
          detail: { isValid: true },
        })
      );
    });

    it('should dispatch configValidityChanged with false when incomplete', () => {
      configPanel.yearSelect = { value: '2023' };
      configPanel.seasonSelect = { value: '' };
      configPanel.generateBtn = { disabled: true };

      configPanel.updateGenerateButton();

      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'configValidityChanged',
          detail: { isValid: false },
        })
      );
    });

    it('should dispatch tflowGenerateAnimation on generate click when valid', () => {
      // Mock DOM elements for init()
      const mockYearSelect = {
        value: '2023',
        addEventListener: vi.fn(),
        disabled: false,
      };
      const mockSeasonSelect = {
        value: 'verano',
        addEventListener: vi.fn(),
        disabled: false,
      };
      const mockGenerateBtn = {
        disabled: false,
        addEventListener: vi.fn(),
        classList: { toggle: vi.fn() },
      };

      global.document.getElementById = vi.fn((id) => {
        if (id === 'tflow-year-select') return mockYearSelect;
        if (id === 'tflow-season-select') return mockSeasonSelect;
        if (id === 'tflow-generate-btn') return mockGenerateBtn;
        return null;
      });

      configPanel.init();

      // Simulate click by calling the registered handler
      const clickHandler = mockGenerateBtn.addEventListener.mock.calls.find(
        call => call[0] === 'click'
      )[1];

      clickHandler();

      // Should dispatch tflowGenerateAnimation (not generationRequested)
      expect(document.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tflowGenerateAnimation',
        })
      );
    });
  });
});
