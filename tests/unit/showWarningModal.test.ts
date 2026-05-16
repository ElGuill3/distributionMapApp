/**
 * Unit tests for showWarningModal — non-blocking warning modal.
 *
 * Tests:
 * 1. Modal renders with title and message
 * 2. Modal is NOT blocking (no overlay covering whole screen)
 * 3. Modal does NOT disable any buttons
 * 4. Modal closes when button is clicked
 * 5. Modal closes on Escape key
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showWarningModal, closeWarningModal } from '../../static/ui/progress.js';

describe('showWarningModal — non-blocking warning', () => {
    let closeBtn;

    beforeEach(() => {
        // Remove any existing modals
        closeWarningModal();
    });

    afterEach(() => {
        closeWarningModal();
    });

    it('renders a modal with the given title and message', () => {
        showWarningModal('Atención', 'La conexión es lenta. Aguardá que termine la operación.');
        const modal = document.getElementById('warning-modal');
        expect(modal).not.toBeNull();
        expect(modal.textContent).toContain('Atención');
        expect(modal.textContent).toContain('La conexión es lenta');
    });

    it('modal is NOT blocking (no dark overlay background)', () => {
        showWarningModal('Test', 'Test message');
        const modal = document.getElementById('warning-modal');
        const style = modal.style.cssText || window.getComputedStyle(modal).cssText;
        // warning modal should NOT have background: rgba(0,0,0,0.9) like error modal
        const computedStyle = window.getComputedStyle(modal);
        expect(computedStyle.background).not.toContain('rgba(0,0,0,0.9)');
    });

    it('modal does NOT have tabindex or focus trap like error modal', () => {
        showWarningModal('Test', 'Test message');
        const modal = document.getElementById('warning-modal');
        expect(modal.getAttribute('tabindex')).not.toBe('-1');
        expect(modal.getAttribute('role')).not.toBe('alertdialog');
    });

    it('closes when close button is clicked', () => {
        showWarningModal('Test', 'Test message');
        closeBtn = document.getElementById('warning-modal-close');
        closeBtn.click();
        const modal = document.getElementById('warning-modal');
        expect(modal).toBeNull();
    });

    it('closes on Escape key', () => {
        showWarningModal('Test', 'Test message');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const modal = document.getElementById('warning-modal');
        expect(modal).toBeNull();
    });

    it('calling showWarningModal twice replaces the first modal', () => {
        showWarningModal('First', 'Message 1');
        showWarningModal('Second', 'Message 2');
        const modal = document.getElementById('warning-modal');
        expect(modal.textContent).toContain('Second');
        expect(modal.textContent).not.toContain('First');
    });
});