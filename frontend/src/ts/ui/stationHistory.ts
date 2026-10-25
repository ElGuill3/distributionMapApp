/** These markers use IPCET recent levels, not local historical CSV files. */
const FORECAST_ONLY_IDS = new Set([
  'MACTB_hidro',
  'SAACP_hidro',
  'PNVTB_hidro',
  'TAPTB_hidro',
]);
export function hasStationHistory(id: string): boolean {
  return !FORECAST_ONLY_IDS.has(id);
}
