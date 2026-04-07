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
    /** Duración fija de cada frame en ms (sobreescribe el delay nativo del GIF). */
    frameIntervalMs: number;
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
    /**
     * Detiene el bucle de animación sin liberar los GifPlayers.
     * Usar cuando se quiere parar la sincronización pero conservar los frames
     * de cada panel para reutilizarlos (p. ej. al regenerar un solo panel).
     */
    stop(): void;
    /** Destruye el bucle y libera recursos de ambos GifPlayer. */
    destroy(): void;
    private tick;
    private showFrame;
}
/**
 * Controlador de reproducción para un único panel.
 *
 * Anima un GifPlayer sobre un L.imageOverlay usando el mismo bucle
 * requestAnimationFrame que SyncPlayer, pero sin necesitar el segundo panel.
 * Comparte la misma interfaz pública (play/pause/stop/goToFrame/isPlaying)
 * para que los controles de reproducción funcionen con ambos tipos de player.
 */
export declare class SoloPlayer {
    onFrameChange?: (current: number, total: number) => void;
    /** Duración fija de cada frame en ms (sobreescribe el delay nativo del GIF). */
    frameIntervalMs: number;
    private player;
    private overlay;
    private currentFrame;
    private _isPlaying;
    private lastTime;
    private rafId;
    get isPlaying(): boolean;
    get frameCount(): number;
    start(player: GifPlayer, overlay: L.ImageOverlay): void;
    play(): void;
    pause(): void;
    stop(): void;
    goToFrame(n: number): void;
    private tick;
    private showFrame;
}
//# sourceMappingURL=gifPlayer.d.ts.map