/**
 * Mapa de errores crudos del backend → mensajes UX legibles.
 *
 * Traduce los strings de error que vienen del servidor a una estructura
 * { title, message } lista para mostrar al usuario. Incluye fallback
 * para errores desconocidos.
 */

/**
 * Error estructurado para la capa de presentación.
 */
export interface UxError {
  title: string;
  message: string;
}

/**
 * Mapa estático de claves de error conocidas → estructura UX.
 * Las claves son substrings o strings exactas que el backend devuelve
 * en el campo `error` de las respuestas JSON.
 */
const ERROR_MAP: Record<string, UxError> = {
  'bbox too large': {
    title: 'Área demasiado grande',
    message: 'El bounding box es demasiado grande. Intentá con un área menor.',
  },
  'no data': {
    title: 'Sin datos disponibles',
    message: 'No hay datos para la región y período seleccionados.',
  },
  'no data for region': {
    title: 'Sin datos disponibles',
    message: 'No hay datos para la región y período seleccionados.',
  },
  'invalid region': {
    title: 'Región inválida',
    message: 'La región seleccionada no es válida. Verificá el rectángulo en el mapa.',
  },
  'invalid bbox': {
    title: 'Bounding box inválido',
    message: 'El rectángulo dibujado no es válido. Intentá de nuevo.',
  },
};

/**
 * Traduce un error crudo del backend a un UxError estructurado.
 *
 * @param rawError - El string de error tal cual llega del servidor.
 * @returns UxError con title y message; fallback si la clave no se conoce.
 */
export function translateBackendError(rawError: string): UxError {
  if (!rawError || typeof rawError !== 'string') {
    return { title: 'Error', message: 'Ocurrió un error inesperado.' };
  }

  const normalized = rawError.toLowerCase().trim();

  // Búsqueda por substring (primer match)
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  // Fallback: devolver el mensaje original envuelto
  return { title: 'Error', message: rawError };
}
