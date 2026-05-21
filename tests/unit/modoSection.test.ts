import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock elements storage
const mockElements = new Map();

function createMockToggle(id: string) {
  return {
    id,
    getAttribute: vi.fn((attr: string) => {
      if (attr === 'aria-pressed') return 'false';
      return null;
    }),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    classList: {
      classes: new Set<string>(),
      add(cls: string) { this.classes.add(cls); },
      remove(cls: string) { this.classes.delete(cls); },
      toggle(cls: string, force?: boolean) {
        if (force === undefined) {
          this.classes.has(cls) ? this.classes.delete(cls) : this.classes.add(cls);
        } else if (force) {
          this.classes.add(cls);
        } else {
          this.classes.delete(cls);
        }
      },
      contains(cls: string) { return this.classes.has(cls); },
    },
    addEventListener: vi.fn(),
  };
}

// Setup global document mock
global.document = {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  getElementById: vi.fn((id: string) => mockElements.get(id) || null),
} as unknown as Document;

global.CustomEvent = class CustomEvent {
  constructor(public type: string, public options?: { detail?: unknown }) {}
} as unknown as typeof CustomEvent;

describe('ModoSection', () => {
  let modoSection: any;
  let compareToggle: any;
  let floodToggle: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockElements.clear();

    // Set up DOM elements before importing module
    const modoSectionEl = createMockToggle('tflow-modo-section');
    compareToggle = createMockToggle('toggleCompareMode');
    floodToggle = createMockToggle('toggleFloodRiskMode');
    mockElements.set('tflow-modo-section', modoSectionEl);
    mockElements.set('toggleCompareMode', compareToggle);
    mockElements.set('toggleFloodRiskMode', floodToggle);

    // Import the module
    const module = await import('../../static/sidebar/modoSection.js');
    modoSection = module.modoSection;

    // Call init to set up event listeners
    modoSection.init();

    // Reset state
    modoSection.activeModo = null;
    modoSection.listeners = [];
  });

  describe('Click Compare Toggle', () => {
    it('click compare toggle activates compare mode', () => {
      // Simulate click on inactive compare toggle (should activate)
      compareToggle.getAttribute = vi.fn(() => 'false');

      // Find the click handler that was registered
      const clickHandler = compareToggle.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      expect(clickHandler).toBeDefined();

      // Act
      clickHandler();

      // Assert: compare mode should be active
      expect(modoSection.activeModo).toBe('compare');
      expect(compareToggle.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
      expect(compareToggle.classList.classes.has('modo-toggle--active')).toBe(true);
    });

    it('click active compare toggle deactivates all', () => {
      // First activate compare mode
      modoSection.activeModo = 'compare';
      compareToggle.getAttribute = vi.fn(() => 'true');

      // Find the click handler
      const clickHandler = compareToggle.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      expect(clickHandler).toBeDefined();

      // Act
      clickHandler();

      // Assert: all modos should be deactivated
      expect(modoSection.activeModo).toBe(null);
    });
  });

  describe('Click Flood Toggle', () => {
    it('click flood toggle activates flood mode', () => {
      // Simulate click on inactive flood toggle (should activate)
      floodToggle.getAttribute = vi.fn(() => 'false');

      // Find the click handler
      const clickHandler = floodToggle.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      expect(clickHandler).toBeDefined();

      // Act
      clickHandler();

      // Assert: flood mode should be active
      expect(modoSection.activeModo).toBe('flood');
      expect(floodToggle.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
      expect(floodToggle.classList.classes.has('modo-toggle--active')).toBe(true);
    });

    it('clicking compare while flood active switches to compare', () => {
      // First activate flood mode
      modoSection.activeModo = 'flood';
      floodToggle.getAttribute = vi.fn(() => 'true');
      compareToggle.getAttribute = vi.fn(() => 'false');

      // Find the compare click handler
      const clickHandler = compareToggle.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      expect(clickHandler).toBeDefined();

      // Act
      clickHandler();

      // Assert: should switch to compare mode
      expect(modoSection.activeModo).toBe('compare');
    });
  });

  describe('Invalid Modo String', () => {
    it('invalid modo string is silently ignored', () => {
      // Call activateModo with invalid string directly
      modoSection.activateModo('invalid' as any);

      // Assert: nothing should change
      expect(modoSection.activeModo).toBe(null);

      // Verify no events were dispatched for invalid modo
      const events = document.dispatchEvent.mock.calls.map(call => call[0]?.type);
      expect(events.filter(e => e !== 'taskFlowDisabled' && e !== 'modoDeactivated')).toHaveLength(0);
    });
  });

  describe('getActiveModo', () => {
    it('getActiveModo returns null initially', () => {
      expect(modoSection.getActiveModo()).toBe(null);
    });

    it('getActiveModo returns active modo after activation', () => {
      compareToggle.getAttribute = vi.fn(() => 'false');

      const clickHandler = compareToggle.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'click'
      )?.[1] as () => void;

      clickHandler();

      expect(modoSection.getActiveModo()).toBe('compare');
    });
  });
});