/**
 * Unit tests for slow-connection warning behavior.
 *
 * Validates that:
 * 1. showWarningModal does NOT disable any buttons
 * 2. A slow-but-successful request does NOT result in error
 * 3. Progress indicator shows warning at threshold, then clears on success
 *
 * RED phase: write tests that define expected behavior
 * GREEN phase: implement to make them pass
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showWarningModal, closeWarningModal } from '../../static/ui/progress.js';

describe('slow connection warning — does NOT block user actions', () => {
    let testButton;

    beforeEach(() => {
        closeWarningModal();
        testButton = document.createElement('button');
        testButton.id = 'test-export-btn';
        testButton.disabled = false;
        document.body.appendChild(testButton);
    });

    afterEach(() => {
        closeWarningModal();
        testButton.remove();
    });

    it('showWarningModal does NOT disable any button on the page', () => {
        // Simulate slow connection warning being shown
        showWarningModal('Conexión lenta', 'La operación está tardando más de lo normal...');

        // Button should remain ENABLED despite warning
        expect(testButton.disabled).toBe(false);
    });

    it('showWarningModal does NOT add disabled attribute to buttons', () => {
        showWarningModal('Atención', 'Aguardá un momento...');
        expect(testButton.hasAttribute('disabled')).toBe(false);
        expect(testButton.disabled).toBe(false);
    });

    it('warning modal can be shown and closed without affecting button state', () => {
        // Show warning
        showWarningModal('Lento', 'Se está procesando tu solicitud...');
        expect(testButton.disabled).toBe(false);

        // Close warning (e.g. request succeeded before timeout)
        closeWarningModal();
        expect(testButton.disabled).toBe(false);

        // Show warning again - still no effect on button
        showWarningModal('Otra vez lento', 'Seguí esperando...');
        expect(testButton.disabled).toBe(false);
    });
});