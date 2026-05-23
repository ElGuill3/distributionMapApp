import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock elements storage
const mockElements = new Map();

function createMockSelect(id: string) {
  const select = {
    id,
    value: '',
    disabled: false,
    addEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    appendChild: vi.fn(),
    remove: vi.fn(),
    classList: {
      classes: new Set<string>(),
      add(cls: string) {
        this.classes.add(cls);
      },
      remove(cls: string) {
        this.classes.delete(cls);
      },
      toggle(cls: string, force?: boolean) {
        if (force === undefined) {
          if (this.classes.has(cls)) {
            this.classes.delete(cls);
          } else {
            this.classes.add(cls);
          }
        } else if (force) {
          this.classes.add(cls);
        } else {
          this.classes.delete(cls);
        }
      },
      contains(cls: string) {
        return this.classes.has(cls);
      },
    },
  };
  // Simulate options array - first option is placeholder
  Object.defineProperty(select, 'options', {
    value: {
      length: 1,
      0: { value: '', textContent: 'Select...' },
      remove: vi.fn(() => {
        /* mock */
      }),
    },
    writable: true,
    enumerable: true,
  });
  mockElements.set(id, select);
  return select;
}

function createMockButton(id: string) {
  return {
    id,
    disabled: false,
    textContent: 'Generar animación',
    classList: {
      classes: new Set<string>(),
      add(cls: string) {
        this.classes.add(cls);
      },
      remove(cls: string) {
        this.classes.delete(cls);
      },
      toggle(cls: string, force?: boolean) {
        if (force === undefined) {
          if (this.classes.has(cls)) {
            this.classes.delete(cls);
          } else {
            this.classes.add(cls);
          }
        } else if (force) {
          this.classes.add(cls);
        } else {
          this.classes.delete(cls);
        }
      },
      contains(cls: string) {
        return this.classes.has(cls);
      },
    },
    addEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
  };
}

// Setup global document mock
global.document = {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  getElementById: vi.fn((id: string) => mockElements.get(id) || null),
  createElement: vi.fn(() => ({
    value: '',
    textContent: '',
    appendChild: vi.fn(),
  })),
} as unknown as Document;

global.CustomEvent = class CustomEvent {
  constructor(
    public type: string,
    public options?: { detail?: unknown }
  ) {}
} as unknown as typeof CustomEvent;

// Import the module - it will use mocks set up in beforeEach
import * as mapState from '../../static/state/mapState.js';

describe('ConfigPanel', () => {
  let configPanel: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockElements.clear();

    // Reset mapState to get clean state
    mapState.resetState();

    // Mock config module - use absolute path
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

    // Mock taskFlow - track calls but delegate to real logic where needed
    vi.doMock('../../static/sidebar/taskFlow.js', () => ({
      updateStepValidity: vi.fn(),
    }));

    // Mock mapState - provide the function configPanel uses
    vi.doMock('../../static/state/mapState.js', () => ({
      getTaskFlowStepValidity: vi.fn((step: string) => {
        // Default: config step is valid when called
        return step === 'config';
      }),
    }));

    // Re-import module with fresh mocks - must use vi.resetModules first
    vi.resetModules();
    const module = await import('../../static/sidebar/configPanel.js');
    configPanel = module.configPanel;

    // Setup DOM elements for init() to find
    const yearSelect = createMockSelect('tflow-year-select');
    const seasonSelect = createMockSelect('tflow-season-select');
    const generateBtn = createMockButton('tflow-generate-btn');
    mockElements.set('tflow-year-select', yearSelect);
    mockElements.set('tflow-season-select', seasonSelect);
    mockElements.set('tflow-generate-btn', generateBtn);

    // Call init to register event listeners
    configPanel.init();

    // Reset state
    configPanel.listeners = [];
  });

  afterEach(() => {
    vi.doUnmock('../../static/config.js');
    vi.doUnmock('../../static/sidebar/taskFlow.js');
    vi.doUnmock('../../static/state/mapState.js');
  });

  describe('Year Select Change', () => {
    it('year select change enables season select', async () => {
      // Get elements that init() configured
      const yearSelect = mockElements.get('tflow-year-select') as any;
      const seasonSelect = mockElements.get('tflow-season-select') as any;

      // Simulate year select with value (user picked a year)
      yearSelect.value = '2023';

      // Find the change handler that was registered
      const changeHandler = yearSelect.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      )?.[1] as () => void;

      expect(changeHandler).toBeDefined();

      // Act
      changeHandler();

      // Assert: season select should now be enabled
      expect(seasonSelect.disabled).toBe(false);
    });

    it('deselecting year disables season select and generate button', async () => {
      // Get elements that init() configured
      const yearSelect = mockElements.get('tflow-year-select') as any;
      const seasonSelect = mockElements.get('tflow-season-select') as any;
      const generateBtn = mockElements.get('tflow-generate-btn') as any;

      // Simulate year select with value first (to enable season)
      yearSelect.value = '2023';
      seasonSelect.disabled = false;
      seasonSelect.value = 'verano';
      generateBtn.disabled = false;

      // Now deselect year
      yearSelect.value = ''; // Empty = deselected

      // Find the change handler
      const changeHandler = yearSelect.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'change'
      )?.[1] as () => void;

      expect(changeHandler).toBeDefined();

      // Act
      changeHandler();

      // Assert: both should be disabled
      expect(seasonSelect.disabled).toBe(true);
      expect(generateBtn.disabled).toBe(true);
    });
  });

  describe('Generate Button Click', () => {
    it('generate button click guarded by taskFlow validity', async () => {
      // Get elements that init() configured
      const yearSelect = mockElements.get('tflow-year-select') as any;
      const seasonSelect = mockElements.get('tflow-season-select') as any;
      const generateBtn = mockElements.get('tflow-generate-btn') as any;

      // Set up valid config state directly
      yearSelect.value = '2023';
      seasonSelect.value = 'verano';

      // Assign to panel and update button state
      configPanel.yearSelect = yearSelect;
      configPanel.seasonSelect = seasonSelect;
      configPanel.generateBtn = generateBtn;
      configPanel.currentVariable = 'ndvi';
      configPanel.updateGenerateButton();

      // Verify button is enabled
      expect(generateBtn.disabled).toBe(false);

      // Find click handler
      const clickHandler = generateBtn.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      expect(clickHandler).toBeDefined();

      // Act
      clickHandler();

      // Assert: should dispatch tflowGenerateAnimation (check last call)
      const allCalls = document.dispatchEvent.mock.calls;
      const lastCall = allCalls[allCalls.length - 1];
      const lastEvent = lastCall[0];

      expect(lastEvent.type).toBe('tflowGenerateAnimation');
      expect(lastEvent.options?.detail?.year).toBe(2023);
      expect(lastEvent.options?.detail?.season).toBe('verano');
    });
  });

  describe('setLoading', () => {
    it('setLoading updates button text to loading state', async () => {
      const generateBtn = mockElements.get('tflow-generate-btn') as any;
      configPanel.generateBtn = generateBtn;
      generateBtn.textContent = 'Generar animación';

      // Act
      configPanel.setLoading(true);

      // Assert
      expect(generateBtn.disabled).toBe(true);
      expect(generateBtn.textContent).toBe('Generando…');
    });

    it('setLoading(false) restores button to normal state', async () => {
      const generateBtn = mockElements.get('tflow-generate-btn') as any;
      configPanel.generateBtn = generateBtn;
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generando…';

      // Act
      configPanel.setLoading(false);

      // Assert
      expect(generateBtn.disabled).toBe(false);
      expect(generateBtn.textContent).toBe('Generar animación');
    });
  });
});
