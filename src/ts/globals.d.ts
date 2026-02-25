/**
 * Declaraciones globales para APIs cargadas desde CDN.
 *
 * IMPORTANTE: El `export {}` al final convierte este archivo en un módulo,
 * lo que permite que `declare module 'leaflet'` funcione como augmentation
 * (extensión) en lugar de redeclaración.
 *
 * - @types/leaflet se incluye vía tsconfig "types": ["leaflet"] y
 *   allowUmdGlobalAccess: true, dando acceso al namespace global L con tipos.
 * - leaflet-draw no tiene @types; se augmenta aquí.
 * - Plotly se declara como global any (CDN sin tipos npm).
 */

// Module augmentation: extiende @types/leaflet con tipos de leaflet-draw
declare module 'leaflet' {
  namespace Control {
    interface DrawConstructorOptions {
      draw?: {
        marker?:       boolean | object;
        circle?:       boolean | object;
        polyline?:     boolean | object;
        polygon?:      boolean | object;
        circlemarker?: boolean | object;
        rectangle?:    boolean | { shapeOptions?: object };
      };
      edit?: {
        featureGroup: FeatureGroup;
        edit?:        boolean;
        remove?:      boolean;
      };
    }

    /** Control de dibujo de leaflet-draw */
    class Draw extends Control {
      constructor(options?: Control.DrawConstructorOptions);
    }
  }

  namespace Draw {
    namespace Event {
      const CREATED:   string;
      const EDITED:    string;
      const DELETED:   string;
      const DRAWSTART: string;
      const DRAWSTOP:  string;
    }
  }
}

// Plotly como global (CDN, sin @types)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Plotly: any;
}

// Convierte este archivo en módulo para que declare module sea augmentation
export {};
