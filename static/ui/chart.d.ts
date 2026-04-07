/**
 * Módulo de gráfica temporal (Plotly).
 *
 * Responsabilidades:
 *  - buildTrace()            : construye la configuración de una traza de Plotly.
 *  - plotAllSelectedSeries() : renderiza todas las series activas en la gráfica.
 */
import type { VariableKey, SeriesData } from '../types.js';
interface TraceConfig {
    variable: VariableKey;
    label: string;
    lineColor: string;
    dates: string[];
    values: number[];
    yRange: [number, number];
}
/**
 * Construye la configuración de una traza Plotly para la variable indicada.
 */
export declare function buildTrace(variable: VariableKey, dates: string[], values: number[]): TraceConfig;
/**
 * Renderiza todas las series activas en la gráfica Plotly.
 *
 * @param chartDiv    - Elemento DOM donde se monta Plotly.
 * @param allSeries   - Mapa con los datos de cada variable activa.
 * @param onShow      - Callback llamado cuando la gráfica tiene al menos una serie.
 * @param onHide      - Callback llamado cuando no hay ninguna serie.
 */
export declare function plotAllSelectedSeries(chartDiv: HTMLDivElement, allSeries: Partial<Record<VariableKey, SeriesData | undefined>>, onShow: () => void, onHide: () => void): void;
export {};
//# sourceMappingURL=chart.d.ts.map