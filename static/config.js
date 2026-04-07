/**
 * Configuración de la aplicación frontend.
 * Todas las constantes de UI y de llamadas a la API viven aquí.
 */
// ---------------------------------------------------------------------------
// Años disponibles por variable
// ---------------------------------------------------------------------------
function _yearsRange(from, to) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
/** Array de años disponibles para cada variable. */
export const VARIABLE_YEARS = {
    ndvi: _yearsRange(2000, 2024),
    temp: _yearsRange(2000, 2024),
    soil: _yearsRange(2000, 2024),
    precip: _yearsRange(2000, 2024),
    water: _yearsRange(2015, 2024),
    local_sp: _yearsRange(2000, 2024),
    local_bd: _yearsRange(2000, 2024),
};
/** Opciones de temporada disponibles (misma lógica que backend). */
export const SEASONS = [
    { value: 'invierno', label: 'Invierno (dic–feb)' },
    { value: 'primavera', label: 'Primavera (mar–may)' },
    { value: 'verano', label: 'Verano (jun–ago)' },
    { value: 'otono', label: 'Otoño (sep–nov)' },
    { value: 'anual', label: 'Año completo (ene–dic)' },
];
export const DEFAULT_CENTER = [17.8409, -92.6189];
export const DEFAULT_ZOOM = 8;
export const MAX_SPAN_DEG = 8.0;
/** Mapa de VariableKey → URL base del endpoint gif-bbox */
export const GIF_ENDPOINT = {
    ndvi: '/api/ndvi-gif-bbox',
    temp: '/api/era5-temp-gif-bbox',
    soil: '/api/era5-soil-gif-bbox',
    precip: '/api/imerg-precip-gif-bbox',
    water: '/api/water-gif-bbox',
};
/** Mapa de VariableKey → URL base del endpoint timeseries-bbox */
export const TS_ENDPOINT = {
    ndvi: '/api/ndvi-timeseries-bbox',
    temp: '/api/era5-temp-timeseries-bbox',
    soil: '/api/era5-soil-timeseries-bbox',
    precip: '/api/imerg-precip-timeseries-bbox',
    water: '/api/water-timeseries-bbox',
};
//# sourceMappingURL=config.js.map