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
import type { ParsedFrame } from 'gifuct-js';

// ---------------------------------------------------------------------------
// GifPlayer
// ---------------------------------------------------------------------------

/**
 * Carga un GIF desde una URL, decodifica sus frames con gifuct-js y
 * pre-renderiza cada uno como un blob URL de imagen PNG para poder
 * actualizar L.imageOverlay.setUrl() sin re-descargar nada.
 */
export class GifPlayer {
  private blobUrls: string[] = [];
  private delays:   number[]  = [];
  private width  = 0;
  private height = 0;

  /** Descarga y pre-renderiza todos los frames del GIF indicado. */
  async load(gifUrl: string): Promise<void> {
    const resp   = await fetch(gifUrl);
    const buffer = await resp.arrayBuffer();

    const parsed = parseGIF(buffer);
    const frames: ParsedFrame[] = decompressFrames(parsed, true);

    this.width  = parsed.lsd.width;
    this.height = parsed.lsd.height;

    // Canvas reutilizable para componer cada frame
    const canvas = document.createElement('canvas');
    canvas.width  = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('GifPlayer: no se pudo obtener 2D context del canvas.');

    // Pre-renderizamos cada frame sobre el canvas acumulativo (disposal 0/1)
    // y capturamos un blob URL por frame.
    this.blobUrls = [];
    this.delays   = [];

    for (const frame of frames) {
      const { dims, patch, delay, disposalType } = frame;

      // Disposal type 2 → limpiar canvas antes de pintar
      if (disposalType === 2) {
        ctx.clearRect(0, 0, this.width, this.height);
      }

      // Cast necesario: gifuct-js tipifica patch como Uint8ClampedArray<ArrayBufferLike>
      // pero ImageData espera Uint8ClampedArray<ArrayBuffer>.
      const imageData = new ImageData(patch as unknown as Uint8ClampedArray<ArrayBuffer>, dims.width, dims.height);
      ctx.putImageData(imageData, dims.left, dims.top);

      const url = await canvasToBlobUrl(canvas);
      this.blobUrls.push(url);
      // delay ya viene en ms desde gifuct-js (multiplica el campo gce por 10)
      this.delays.push(delay > 0 ? delay : 100);
    }
  }

  /** Número de frames decodificados. */
  get frameCount(): number {
    return this.blobUrls.length;
  }

  /** Blob URL para el frame en el índice dado (seguro para L.imageOverlay.setUrl). */
  getFrameUrl(index: number): string {
    return this.blobUrls[index] ?? '';
  }

  /** Delay del frame en ms. */
  getFrameDelay(index: number): number {
    return this.delays[index] ?? 100;
  }

  /** Libera todos los blob URLs de memoria. Llamar al destruir el player. */
  dispose(): void {
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    this.delays   = [];
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
  /** Callback invocado cada vez que avanza el frame (frame actual, total frames). */
  onFrameChange?: (current: number, total: number) => void;

  private playerA!: GifPlayer;
  private playerB!: GifPlayer;
  private overlayA!: L.ImageOverlay;
  private overlayB!: L.ImageOverlay;

  private currentFrame = 0;
  private totalFrames  = 0;
  private _isPlaying   = false;
  private lastTime     = 0;
  private rafId        = 0;

  /**
   * Inicia la reproducción sincronizada.
   * Llama a play() internamente tras configurar los overlays.
   */
  start(
    playerA: GifPlayer, overlayA: L.ImageOverlay,
    playerB: GifPlayer, overlayB: L.ImageOverlay,
  ): void {
    this.playerA  = playerA;
    this.playerB  = playerB;
    this.overlayA = overlayA;
    this.overlayB = overlayB;

    // Usamos el máximo de frames entre ambos GIFs; cada player cicla por separado
    this.totalFrames  = Math.max(playerA.frameCount, playerB.frameCount);
    this.currentFrame = 0;
    this.lastTime     = 0;

    this.showFrame(0);
    this.play();
  }

  /** Salta directamente al frame indicado (sin detener la reproducción). */
  goToFrame(n: number): void {
    this.currentFrame = Math.max(0, Math.min(n, this.totalFrames - 1));
    this.showFrame(this.currentFrame);
  }

  /** Arranca o reanuda la reproducción. */
  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.lastTime   = 0;
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  /** Detiene la reproducción (mantiene el frame actual). */
  pause(): void {
    this._isPlaying = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Indica si la reproducción está activa. */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Detiene el bucle de animación sin liberar los GifPlayers.
   * Usar cuando se quiere parar la sincronización pero conservar los frames
   * de cada panel para reutilizarlos (p. ej. al regenerar un solo panel).
   */
  stop(): void {
    this.pause();
  }

  /** Destruye el bucle y libera recursos de ambos GifPlayer. */
  destroy(): void {
    this.pause();
    this.playerA?.dispose();
    this.playerB?.dispose();
  }

  // -------------------------------------------------------------------------
  // Privado
  // -------------------------------------------------------------------------

  private tick(time: number): void {
    if (!this._isPlaying) return;

    if (this.lastTime === 0) this.lastTime = time;
    const elapsed = time - this.lastTime;
    const delay   = this.playerA.getFrameDelay(this.currentFrame % this.playerA.frameCount);

    if (elapsed >= delay) {
      this.lastTime     = time;
      this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
      this.showFrame(this.currentFrame);
    }

    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  private showFrame(n: number): void {
    const frameA = this.playerA.frameCount > 0 ? n % this.playerA.frameCount : 0;
    const frameB = this.playerB.frameCount > 0 ? n % this.playerB.frameCount : 0;

    const urlA = this.playerA.getFrameUrl(frameA);
    const urlB = this.playerB.getFrameUrl(frameB);

    if (urlA) this.overlayA.setUrl(urlA);
    if (urlB) this.overlayB.setUrl(urlB);

    this.onFrameChange?.(n, this.totalFrames);
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
  onFrameChange?: (current: number, total: number) => void;

  private player!: GifPlayer;
  private overlay!: L.ImageOverlay;

  private currentFrame = 0;
  private _isPlaying   = false;
  private lastTime     = 0;
  private rafId        = 0;

  get isPlaying(): boolean  { return this._isPlaying; }
  get frameCount(): number  { return this.player?.frameCount ?? 0; }

  start(player: GifPlayer, overlay: L.ImageOverlay): void {
    this.player       = player;
    this.overlay      = overlay;
    this.currentFrame = 0;
    this.lastTime     = 0;
    this.showFrame(0);
    this.play();
  }

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.lastTime   = 0;
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  pause(): void {
    this._isPlaying = false;
    cancelAnimationFrame(this.rafId);
  }

  stop(): void {
    this.pause();
  }

  goToFrame(n: number): void {
    this.currentFrame = Math.max(0, Math.min(n, this.frameCount - 1));
    this.showFrame(this.currentFrame);
  }

  private tick(time: number): void {
    if (!this._isPlaying) return;
    if (this.lastTime === 0) this.lastTime = time;
    const elapsed = time - this.lastTime;
    const delay   = this.player.getFrameDelay(this.currentFrame);
    if (elapsed >= delay) {
      this.lastTime     = time;
      this.currentFrame = (this.currentFrame + 1) % this.frameCount;
      this.showFrame(this.currentFrame);
    }
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  private showFrame(n: number): void {
    const url = this.player.getFrameUrl(n);
    if (url) this.overlay.setUrl(url);
    this.onFrameChange?.(n, this.frameCount);
  }
}

// ---------------------------------------------------------------------------
// Utilidad interna
// ---------------------------------------------------------------------------

/** Convierte el contenido actual de un canvas en un blob URL (asíncrono). */
function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('canvas.toBlob devolvió null.')); return; }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}
