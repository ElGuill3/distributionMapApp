/**
 * Tipos y contratos de datos compartidos entre frontend y backend.
 *
 * Estas interfaces reflejan exactamente las respuestas JSON de los endpoints
 * Flask. Cualquier cambio en el contrato debe actualizarse aquí primero.
 */
// ---------------------------------------------------------------------------
// Configuración de variables — mapeo a claves de respuesta
// ---------------------------------------------------------------------------
/**
 * Mapea cada VariableKey a la clave de datos en TimeseriesResponse/GifResponse.
 * Las variables locales (local_sp, local_bd) usan su propio endpoint y no
 * necesitan esta clave — se incluyen con un valor placeholder ('ndvi') que
 * nunca se usa para ellas.
 */
export const VARIABLE_DATA_KEY = {
    ndvi: 'ndvi',
    temp: 'temp',
    soil: 'soil_pct',
    precip: 'precip_mm',
    water: 'water_ha',
    local_sp: 'ndvi',
    local_bd: 'ndvi',
};
//# sourceMappingURL=types.js.map