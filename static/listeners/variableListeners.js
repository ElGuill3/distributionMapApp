/**
 * Factory de event listeners para las variables hidrometeorológicas.
 *
 * Reemplaza los 5 bloques if-then casi idénticos del main.ts original por una
 * función genérica `registerVariableListener` que acepta la configuración de
 * cada variable como parámetro.
 */
/**
 * Registra un event listener en el botón de la variable indicada.
 *
 * Valida fechas y bbox antes de llamar a onRequest. Si alguna validación
 * falla, muestra un alert y no llama al callback.
 */
export function registerVariableListener(cfg) {
    const { variable, startInput, endInput, button, getBbox, onRequest } = cfg;
    if (!startInput || !endInput || !button)
        return;
    button.addEventListener('click', () => {
        const start = startInput.value;
        const end = endInput.value;
        if (!start || !end) {
            alert('Selecciona fecha inicio y fecha fin.');
            return;
        }
        const bbox = getBbox();
        if (!bbox) {
            alert('Dibuja primero un rectángulo (bounding box) en el mapa.');
            return;
        }
        onRequest(variable, start, end, bbox);
    });
}
//# sourceMappingURL=variableListeners.js.map