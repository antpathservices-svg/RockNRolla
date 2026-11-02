export const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'] as const;

/**
 * Folio con el formato del Excel del negocio: #0004_JUN.
 * El número es consecutivo y no se reinicia cada mes; el mes es el de captura.
 */
export function formatFolio(numero: number, fecha: Date = new Date()): string {
  const mes = MESES_CORTOS[monterreyParts(fecha).month - 1];
  return `#${String(numero).padStart(4, '0')}_${mes}`;
}

/** Año, mes y día en hora de Monterrey (UTC-06:00). */
export function monterreyParts(fecha: Date): { year: number; month: number; day: number } {
  const local = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/** Fecha (YYYY-MM-DD) de hoy más `dias`, en hora de Monterrey. */
export function fechaMasDias(dias: number, desde: Date = new Date()): string {
  const { year, month, day } = monterreyParts(desde);
  const d = new Date(Date.UTC(year, month - 1, day + dias));
  return d.toISOString().slice(0, 10);
}
