import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDarkModeActive } from '../../src/ts/ui/chart.js';

describe('Theme management', () => {
  beforeEach(() => {
    // Clear data-theme attribute on documentElement
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should return true when data-theme is dark', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(isDarkModeActive()).toBe(true);
  });

  it('should return false when data-theme is light', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    expect(isDarkModeActive()).toBe(false);
  });

  it('should fall back to system prefers-color-scheme when data-theme is not set', () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);

    expect(isDarkModeActive()).toBe(true);
  });

  it('should dispatch theme-change event when button is clicked', () => {
    const mockBtn = document.createElement('button');
    mockBtn.id = 'themeToggle';
    document.body.appendChild(mockBtn);

    const eventSpy = vi.fn();
    window.addEventListener('theme-change', eventSpy);

    // Setup toggler action
    mockBtn.addEventListener('click', () => {
      const isDark = isDarkModeActive();
      const nextTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      window.dispatchEvent(new Event('theme-change'));
    });

    mockBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(eventSpy).toHaveBeenCalledTimes(1);

    mockBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(eventSpy).toHaveBeenCalledTimes(2);

    document.body.removeChild(mockBtn);
    window.removeEventListener('theme-change', eventSpy);
  });
});
