/**
 * Módulo de reproducción sincronizada de GIFs.
 *
 * Responsabilidades:
 *  - GifPlayer   : descarga un GIF, decodifica sus frames con gifuct-js y los
 *                  pre-renderiza como blob URLs listos para usar en L.imageOverlay.
 *  - SyncPlayer  : bucle requestAnimationFrame compartido que avanza ambos
 *                  GifPlayer al mismo frame y actualiza los L.imageOverlay.
 */
import { parseGIF, decompressFrames } from 'gifuct-js';
// ---------------------------------------------------------------------------
// GifPlayer
// ---------------------------------------------------------------------------
/**
 * Carga un GIF desde una URL, decodifica sus frames con gifuct-js y
 * pre-renderiza cada uno como un blob URL de imagen PNG para poder
 * actualizar L.imageOverlay.setUrl() sin re-descargar nada.
 */
export class GifPlayer {
    constructor() {
        this.blobUrls = [];
        this.delays = [];
        this.width = 0;
        this.height = 0;
    }
    /** Descarga y pre-renderiza todos los frames del GIF indicado. */
    async load(gifUrl) {
        const resp = await fetch(gifUrl);
        const buffer = await resp.arrayBuffer();
        const parsed = parseGIF(buffer);
        const frames = decompressFrames(parsed, true);
        this.width = parsed.lsd.width;
        this.height = parsed.lsd.height;
        // Canvas reutilizable para componer cada frame
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('GifPlayer: no se pudo obtener 2D context del canvas.');
        // Pre-renderizamos cada frame sobre el canvas acumulativo (disposal 0/1)
        // y capturamos un blob URL por frame.
        this.blobUrls = [];
        this.delays = [];
        for (const frame of frames) {
            const { dims, patch, delay, disposalType } = frame;
            // Disposal type 2 → limpiar canvas antes de pintar
            if (disposalType === 2) {
                ctx.clearRect(0, 0, this.width, this.height);
            }
            // Cast necesario: gifuct-js tipifica patch como Uint8ClampedArray<ArrayBufferLike>
            // pero ImageData espera Uint8ClampedArray<ArrayBuffer>.
            const imageData = new ImageData(patch, dims.width, dims.height);
            ctx.putImageData(imageData, dims.left, dims.top);
            const url = await canvasToBlobUrl(canvas);
            this.blobUrls.push(url);
            // delay ya viene en ms desde gifuct-js (multiplica el campo gce por 10)
            this.delays.push(delay > 0 ? delay : 100);
        }
    }
    /** Número de frames decodificados. */
    get frameCount() {
        return this.blobUrls.length;
    }
    /** Blob URL para el frame en el índice dado (seguro para L.imageOverlay.setUrl). */
    getFrameUrl(index) {
        var _a;
        return (_a = this.blobUrls[index]) !== null && _a !== void 0 ? _a : '';
    }
    /** Delay del frame en ms. */
    getFrameDelay(index) {
        var _a;
        return (_a = this.delays[index]) !== null && _a !== void 0 ? _a : 100;
    }
    /** Libera todos los blob URLs de memoria. Llamar al destruir el player. */
    dispose() {
        for (const url of this.blobUrls)
            URL.revokeObjectURL(url);
        this.blobUrls = [];
        this.delays = [];
    }
}
// ---------------------------------------------------------------------------
// SyncPlayer
// ---------------------------------------------------------------------------
/**
 * Controlador de reproducción sincronizada.
 *
 * Gestiona un único bucle requestAnimationFrame que avanza ambos GifPlayer
 * al mismo frame e invoca L.imageOverlay.setUrl() en los dos overlays.
 */
export class SyncPlayer {
    constructor() {
        /** Duración fija de cada frame en ms (sobreescribe el delay nativo del GIF). */
        this.frameIntervalMs = 1000;
        this.currentFrame = 0;
        this.totalFrames = 0;
        this._isPlaying = false;
        this.lastTime = 0;
        this.rafId = 0;
    }
    /**
     * Inicia la reproducción sincronizada.
     * Llama a play() internamente tras configurar los overlays.
     */
    start(playerA, overlayA, playerB, overlayB) {
        this.playerA = playerA;
        this.playerB = playerB;
        this.overlayA = overlayA;
        this.overlayB = overlayB;
        // Usamos el máximo de frames entre ambos GIFs; cada player cicla por separado
        this.totalFrames = Math.max(playerA.frameCount, playerB.frameCount);
        this.currentFrame = 0;
        this.lastTime = 0;
        this.showFrame(0);
        this.play();
    }
    /** Salta directamente al frame indicado (sin detener la reproducción). */
    goToFrame(n) {
        this.currentFrame = Math.max(0, Math.min(n, this.totalFrames - 1));
        this.showFrame(this.currentFrame);
    }
    /** Arranca o reanuda la reproducción. */
    play() {
        if (this._isPlaying)
            return;
        this._isPlaying = true;
        this.lastTime = 0;
        this.rafId = requestAnimationFrame(this.tick.bind(this));
    }
    /** Detiene la reproducción (mantiene el frame actual). */
    pause() {
        this._isPlaying = false;
        cancelAnimationFrame(this.rafId);
    }
    /** Indica si la reproducción está activa. */
    get isPlaying() {
        return this._isPlaying;
    }
    /**
     * Detiene el bucle de animación sin liberar los GifPlayers.
     * Usar cuando se quiere parar la sincronización pero conservar los frames
     * de cada panel para reutilizarlos (p. ej. al regenerar un solo panel).
     */
    stop() {
        this.pause();
    }
    /** Destruye el bucle y libera recursos de ambos GifPlayer. */
    destroy() {
        var _a, _b;
        this.pause();
        (_a = this.playerA) === null || _a === void 0 ? void 0 : _a.dispose();
        (_b = this.playerB) === null || _b === void 0 ? void 0 : _b.dispose();
    }
    // -------------------------------------------------------------------------
    // Privado
    // -------------------------------------------------------------------------
    tick(time) {
        if (!this._isPlaying)
            return;
        if (this.lastTime === 0)
            this.lastTime = time;
        const elapsed = time - this.lastTime;
        if (elapsed >= this.frameIntervalMs) {
            this.lastTime = time;
            this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
            this.showFrame(this.currentFrame);
        }
        this.rafId = requestAnimationFrame(this.tick.bind(this));
    }
    showFrame(n) {
        var _a;
        const frameA = this.playerA.frameCount > 0 ? n % this.playerA.frameCount : 0;
        const frameB = this.playerB.frameCount > 0 ? n % this.playerB.frameCount : 0;
        const urlA = this.playerA.getFrameUrl(frameA);
        const urlB = this.playerB.getFrameUrl(frameB);
        if (urlA)
            this.overlayA.setUrl(urlA);
        if (urlB)
            this.overlayB.setUrl(urlB);
        (_a = this.onFrameChange) === null || _a === void 0 ? void 0 : _a.call(this, n, this.totalFrames);
    }
}
// ---------------------------------------------------------------------------
// SoloPlayer
// ---------------------------------------------------------------------------
/**
 * Controlador de reproducción para un único panel.
 *
 * Anima un GifPlayer sobre un L.imageOverlay usando el mismo bucle
 * requestAnimationFrame que SyncPlayer, pero sin necesitar el segundo panel.
 * Comparte la misma interfaz pública (play/pause/stop/goToFrame/isPlaying)
 * para que los controles de reproducción funcionen con ambos tipos de player.
 */
export class SoloPlayer {
    constructor() {
        /** Duración fija de cada frame en ms (sobreescribe el delay nativo del GIF). */
        this.frameIntervalMs = 1000;
        this.currentFrame = 0;
        this._isPlaying = false;
        this.lastTime = 0;
        this.rafId = 0;
    }
    get isPlaying() { return this._isPlaying; }
    get frameCount() { var _a, _b; return (_b = (_a = this.player) === null || _a === void 0 ? void 0 : _a.frameCount) !== null && _b !== void 0 ? _b : 0; }
    start(player, overlay) {
        this.player = player;
        this.overlay = overlay;
        this.currentFrame = 0;
        this.lastTime = 0;
        this.showFrame(0);
        this.play();
    }
    play() {
        if (this._isPlaying)
            return;
        this._isPlaying = true;
        this.lastTime = 0;
        this.rafId = requestAnimationFrame(this.tick.bind(this));
    }
    pause() {
        this._isPlaying = false;
        cancelAnimationFrame(this.rafId);
    }
    stop() {
        this.pause();
    }
    goToFrame(n) {
        this.currentFrame = Math.max(0, Math.min(n, this.frameCount - 1));
        this.showFrame(this.currentFrame);
    }
    tick(time) {
        if (!this._isPlaying)
            return;
        if (this.lastTime === 0)
            this.lastTime = time;
        const elapsed = time - this.lastTime;
        if (elapsed >= this.frameIntervalMs) {
            this.lastTime = time;
            this.currentFrame = (this.currentFrame + 1) % this.frameCount;
            this.showFrame(this.currentFrame);
        }
        this.rafId = requestAnimationFrame(this.tick.bind(this));
    }
    showFrame(n) {
        var _a;
        const url = this.player.getFrameUrl(n);
        if (url)
            this.overlay.setUrl(url);
        (_a = this.onFrameChange) === null || _a === void 0 ? void 0 : _a.call(this, n, this.frameCount);
    }
}
// ---------------------------------------------------------------------------
// Utilidad interna
// ---------------------------------------------------------------------------
/** Convierte el contenido actual de un canvas en un blob URL (asíncrono). */
function canvasToBlobUrl(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error('canvas.toBlob devolvió null.'));
                return;
            }
            resolve(URL.createObjectURL(blob));
        }, 'image/png');
    });
}
//# sourceMappingURL=gifPlayer.js.map