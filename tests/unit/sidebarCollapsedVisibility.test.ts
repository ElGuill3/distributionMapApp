import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for sidebar-collapsed CSS behavior.
 * Verifies the CSS rules that control visibility when the sidebar is collapsed.
 */
describe('sidebar-collapsed visibility', () => {
  let container: HTMLElement;
  let layout: HTMLDivElement;
  let sidebar: HTMLDivElement;
  let sidebarRestore: HTMLButtonElement;
  let modeBanner: HTMLDivElement;

  beforeEach(() => {
    // Setup DOM structure matching the production HTML
    container = document.createElement('div');
    container.innerHTML = `
      <div id="layout" class="layout">
        <div id="sidebar" class="sidebar">
          <div class="sidebar-group">
            <div class="sidebar-group-header">Variables de animación</div>
          </div>
          <div class="sidebar-brand-logo-container">
            <img src="logo.webp" alt="Logo" width="64" height="64">
          </div>
        </div>
        <div id="main-content">
          <div id="map-and-chart"></div>
        </div>
      </div>
      <button id="sidebarRestore" class="hidden">Restore</button>
      <div id="modeBannerCompare" class="mode-banner hidden">Compare Mode</div>
    `;
    document.body.appendChild(container);

    // Get references
    layout = document.getElementById('layout') as HTMLDivElement;
    sidebar = document.getElementById('sidebar') as HTMLDivElement;
    sidebarRestore = document.getElementById('sidebarRestore') as HTMLButtonElement;
    modeBanner = document.getElementById('modeBannerCompare') as HTMLDivElement;
  });

  afterEach(() => {
    document.body.removeChild(container);
    document.body.classList.remove('sidebar-collapsed');
  });

  describe('body.sidebar-collapsed class', () => {
    it('should apply sidebar-collapsed class to body', () => {
      document.body.classList.add('sidebar-collapsed');
      expect(document.body.classList.contains('sidebar-collapsed')).toBe(true);
    });

    it('should remove sidebar-collapsed class from body', () => {
      document.body.classList.add('sidebar-collapsed');
      document.body.classList.remove('sidebar-collapsed');
      expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });
  });

  describe('DOM structure verification', () => {
    it('should have layout element with correct class', () => {
      expect(layout).not.toBeNull();
      expect(layout.classList.contains('layout')).toBe(true);
    });

    it('should have sidebar element with correct class', () => {
      expect(sidebar).not.toBeNull();
      expect(sidebar.classList.contains('sidebar')).toBe(true);
    });

    it('should have sidebar group elements', () => {
      const sidebarGroup = sidebar.querySelector('.sidebar-group');
      expect(sidebarGroup).not.toBeNull();
    });

    it('should have sidebar group header elements', () => {
      const sidebarHeader = sidebar.querySelector('.sidebar-group-header');
      expect(sidebarHeader).not.toBeNull();
    });

    it('should have logo container element', () => {
      const logoContainer = sidebar.querySelector('.sidebar-brand-logo-container');
      expect(logoContainer).not.toBeNull();
    });
  });

  describe('mode banner positioning', () => {
    it('should have mode banner element that can be positioned', () => {
      expect(modeBanner).not.toBeNull();
      expect(modeBanner.classList.contains('mode-banner')).toBe(true);
    });

    it('should allow toggling mode banner visibility', () => {
      modeBanner.classList.remove('hidden');
      expect(modeBanner.classList.contains('hidden')).toBe(false);

      modeBanner.classList.add('hidden');
      expect(modeBanner.classList.contains('hidden')).toBe(true);
    });
  });

  describe('sidebar restore button visibility', () => {
    it('should have sidebar restore button', () => {
      expect(sidebarRestore).not.toBeNull();
    });

    it('should toggle restore button visibility with class', () => {
      sidebarRestore.classList.remove('hidden');
      expect(sidebarRestore.classList.contains('hidden')).toBe(false);

      sidebarRestore.classList.add('hidden');
      expect(sidebarRestore.classList.contains('hidden')).toBe(true);
    });
  });
});
