/**
 * Módulo de reproducción sincronizada de GIFs.
 *
 * Responsabilidades:
 *  - GifPlayer   : descarga un GIF, decodifica sus frames con gifuct-js y los
 *                  pre-renderiza como blob URLs listos para usar en L.imageOverlay.
 *  - SyncPlayer  : bucle requestAnimationFrame compartido que avanza ambos
 *                  GifPlayer al mismo frame y actualiza los L.imageOverlay.
 */
/**
 * Carga un GIF desde una URL, decodifica sus frames con gifuct-js y
 * pre-renderiza cada uno como un blob URL de imagen PNG para poder
 * actualizar L.imageOverlay.setUrl() sin re-descargar nada.
 */
export declare class GifPlayer {
    private blobUrls;
    private delays;
    private width;
    private height;
    /** Descarga y pre-renderiza todos los frames del GIF indicado. */
    load(gifUrl: string): Promise<void>;
    /** Número de frames decodificados. */
    get frameCount(): number;
    /** Blob URL para el frame en el índice dado (seguro para L.imageOverlay.setUrl). */
    getFrameUrl(index: number): string;
    /** Delay del frame en ms. */
    getFrameDelay(index: number): number;
    /** Libera todos los blob URLs de memoria. Llamar al destruir el player. */
    dispose(): void;
}
/**
 * Controlador de reproducción sincronizada.
 *
 * Gestiona un único bucle requestAnimationFrame que avanza ambos GifPlayer
 * al mismo frame e invoca L.imageOverlay.setUrl() en los dos overlays.
 */
export declare class SyncPlayer {
    /** Callback invocado cada vez que avanza el frame (frame actual, total frames). */
    onFrameChange?: (current: number, total: number) => void;
    private playerA;
    private playerB;
    private overlayA;
    private overlayB;
    private currentFrame;
    private totalFrames;
    private _isPlaying;
    private lastTime;
    private rafId;
    /**
     * Inicia la reproducción sincronizada.
     * Llama a play() internamente tras configurar los overlays.
     */
    start(playerA: GifPlayer, overlayA: L.ImageOverlay, playerB: GifPlayer, overlayB: L.ImageOverlay): void;
    /** Salta directamente al frame indicado (sin detener la reproducción). */
    goToFrame(n: number): void;
    /** Arranca o reanuda la reproducción. */
    play(): void;
    /** Detiene la reproducción (mantiene el frame actual). */
    pause(): void;
    /** Indica si la reproducción está activa. */
    get isPlaying(): boolean;
    /** Destruye el bucle y libera recursos de ambos GifPlayer. */
    destroy(): void;
    private tick;
    private showFrame;
}
//# sourceMappingURL=gifPlayer.d.ts.map