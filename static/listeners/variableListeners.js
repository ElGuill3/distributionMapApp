/**
 * Factory de event listeners para las variables hidrometeorológicas.
 *
 * Reemplaza los inputs de fecha libre por selectores de año + temporada.
 * Exporta además `seasonToDates` e `isLeapYear` para uso en main.ts.
 */
import { VARIABLE_YEARS, SEASONS } from '../config.js';
// ---------------------------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------------------------
export function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
/**
 * Convierte año + temporada a un rango de fechas ISO.
 *
 * Temporadas:
 *   invierno  → Y-12-01 .. (Y+1)-02-28/29
 *   primavera → Y-03-01 .. Y-05-31
 *   verano    → Y-06-01 .. Y-08-31
 *   otono     → Y-09-01 .. Y-11-30
 *   anual     → Y-01-01 .. Y-12-31
 */
export function seasonToDates(year, season) {
    switch (season) {
        case 'invierno': {
            const endYear = year + 1;
            const endDay = isLeapYear(endYear) ? 29 : 28;
            return {
                start: `${year}-12-01`,
                end: `${endYear}-02-${String(endDay).padStart(2, '0')}`,
            };
        }
        case 'primavera': return { start: `${year}-03-01`, end: `${year}-05-31` };
        case 'verano': return { start: `${year}-06-01`, end: `${year}-08-31` };
        case 'otono': return { start: `${year}-09-01`, end: `${year}-11-30` };
        case 'anual': return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
}
// ---------------------------------------------------------------------------
// Helpers internos de población de selects
// ---------------------------------------------------------------------------
function _populateYearSelect(select, years) {
    for (const year of years) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        select.appendChild(opt);
    }
}
function _populateSeasonSelect(select) {
    for (const s of SEASONS) {
        const opt = document.createElement('option');
        opt.value = s.value;
        opt.textContent = s.label;
        select.appendChild(opt);
    }
}
// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------
/**
 * Registra el comportamiento completo de una variable:
 *  1. Puebla los selects de año y temporada.
 *  2. Habilita/deshabilita reactivamente temporada y botón.
 *  3. Al pulsar el botón convierte año+temporada a fechas ISO y llama a onRequest.
 */
export function registerVariableListener(cfg) {
    const { variable, yearSelect, seasonSelect, button, getBbox, onRequest } = cfg;
    if (!yearSelect || !seasonSelect || !button)
        return;
    _populateYearSelect(yearSelect, VARIABLE_YEARS[variable]);
    _populateSeasonSelect(seasonSelect);
    const syncButtonState = () => {
        button.disabled = !yearSelect.value || !seasonSelect.value;
    };
    yearSelect.addEventListener('change', () => {
        const hasYear = Boolean(yearSelect.value);
        seasonSelect.disabled = !hasYear;
        if (!hasYear)
            seasonSelect.value = '';
        syncButtonState();
    });
    seasonSelect.addEventListener('change', syncButtonState);
    button.addEventListener('click', () => {
        const year = Number(yearSelect.value);
        const season = seasonSelect.value;
        if (!year || !season) {
            alert('Selecciona año y temporada.');
            return;
        }
        const bbox = getBbox();
        if (!bbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        const { start, end } = seasonToDates(year, season);
        onRequest(variable, start, end, bbox);
    });
}
//# sourceMappingURL=variableListeners.js.map