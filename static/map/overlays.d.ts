/**
 * Gestión de overlays del mapa y barras de colores (colorbars).
 *
 * Los tipos de Leaflet se usan a través del UMD global `L` (disponible
 * gracias a allowUmdGlobalAccess + @types/leaflet en tsconfig).
 *
 * Exporta:
 *  - activeOverlay          : overlay GIF activo
 *  - municipalFloodOverlays : overlays de riesgo por municipio
 *  - buildColorbars()       : inicializa todos los controles de colorbar
 *  - switchColorbar()       : activa una colorbar, desactiva las demás
 *  - removeActiveOverlay()  : elimina el overlay GIF activo del mapa
 *  - setActiveOverlay()     : actualiza la referencia al overlay activo
 */
import type { VariableKey } from '../types.js';
export declare let activeOverlay: L.ImageOverlay | null;
export declare function setActiveOverlay(overlay: L.ImageOverlay | null): void;
export declare const municipalFloodOverlays: Record<string, L.ImageOverlay>;
export declare let allColorbars: Partial<Record<VariableKey | 'flood', L.Control>>;
/**
 * Crea e inicializa todos los controles de colorbar.
 * Debe llamarse una sola vez al arrancar la aplicación.
 */
export declare function buildColorbars(): void;
/**
 * Activa la colorbar de la variable indicada y desactiva todas las demás.
 *
 * @param map      - Mapa donde se muestran los controles.
 * @param variable - Variable activa o 'flood'. null desactiva todas.
 */
export declare function switchColorbar(map: L.Map, variable: VariableKey | 'flood' | null): void;
/**
 * Elimina el overlay GIF activo del mapa.
 */
export declare function removeActiveOverlay(map: L.Map): void;
//# sourceMappingURL=overlays.d.ts.map