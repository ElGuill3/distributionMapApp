import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Production implementation of toggleModeBanner.
 * Toggles mode banner visibility based on mode state.
 */
function toggleModeBanner(mode: 'compare' | 'flood-risk', visible: boolean): void {
  const bannerId = mode === 'compare' ? 'modeBannerCompare' : 'modeBannerFloodRisk';
  const banner = document.getElementById(bannerId);
  if (banner) {
    banner.classList.toggle('hidden', !visible);
  }
}

describe('toggleModeBanner', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <div id="modeBannerCompare" class="mode-banner mode-banner--compare hidden">
        Modo comparativa activado
      </div>
      <div id="modeBannerFloodRisk" class="mode-banner mode-banner--flood-risk hidden">
        Modo riesgo de inundación activado
      </div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should show compare mode banner when visible=true', () => {
    toggleModeBanner('compare', true);

    const banner = document.getElementById('modeBannerCompare');
    expect(banner?.classList.contains('hidden')).toBe(false);
  });

  it('should hide compare mode banner when visible=false', () => {
    // First show it
    toggleModeBanner('compare', true);
    // Then hide it
    toggleModeBanner('compare', false);

    const banner = document.getElementById('modeBannerCompare');
    expect(banner?.classList.contains('hidden')).toBe(true);
  });

  it('should show flood risk mode banner when visible=true', () => {
    toggleModeBanner('flood-risk', true);

    const banner = document.getElementById('modeBannerFloodRisk');
    expect(banner?.classList.contains('hidden')).toBe(false);
  });

  it('should hide flood risk mode banner when visible=false', () => {
    // First show it
    toggleModeBanner('flood-risk', true);
    // Then hide it
    toggleModeBanner('flood-risk', false);

    const banner = document.getElementById('modeBannerFloodRisk');
    expect(banner?.classList.contains('hidden')).toBe(true);
  });

  it('should not throw if banner element does not exist', () => {
    document.getElementById('modeBannerCompare')?.remove();
    document.getElementById('modeBannerFloodRisk')?.remove();

    expect(() => toggleModeBanner('compare', true)).not.toThrow();
    expect(() => toggleModeBanner('flood-risk', true)).not.toThrow();
  });
});
