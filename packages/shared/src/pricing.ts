/**
 * Montos del pedido, en centavos para evitar errores de redondeo.
 *
 * El anticipo se define por porcentaje o por monto fijo (lo que el negocio haya escrito al
 * último) sobre una base que puede incluir o no el envío:
 *   - Regla de las notas originales: 50% de (pasteles − descuento); el envío va en el saldo.
 *     Ej. Lourdes: pasteles $3,550, envío $250 → total $3,800, anticipo $1,775, saldo $2,025.
 *   - Con "incluir envío": 50% de $3,800 → anticipo $1,900, saldo $1,900.
 *   - Pago completo: 100% con envío → anticipo $3,800, saldo $0.
 * Si ya se registraron pagos, el saldo es lo que falta: total − pagado.
 */

export interface MontosInput {
  preciosCentavos: Array<number | null | undefined>;
  envioCentavos?: number | null;
  descuentoCentavos?: number | null;
  anticipoPct?: number | null;
  /** Monto fijo del anticipo; si viene, manda sobre el porcentaje. */
  anticipoCentavos?: number | null;
  /** El anticipo se calcula sobre pasteles + envío (y no solo pasteles). */
  anticipoIncluyeEnvio?: boolean | null;
  /** Suma de los pagos registrados. */
  pagadoCentavos?: number | null;
}

export interface Montos {
  costo: number;
  descuento: number;
  envio: number;
  total: number;
  /** Sobre qué se calcula el anticipo */
  baseAnticipo: number;
  anticipo: number;
  /** Porcentaje real del anticipo sobre su base (con decimales si el monto se fijó a mano) */
  anticipoPct: number;
  /** El anticipo cubre todo el pedido */
  pagoCompleto: boolean;
  pagado: number;
  /** Lo que falta del anticipo (0 si ya se cubrió) */
  faltaAnticipo: number;
  /** Lo que se cobra al entregar: total − anticipo, o total − pagado si ya hay pagos */
  saldo: number;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

export function calcularMontos(input: MontosInput): Montos {
  const costo = input.preciosCentavos.reduce<number>((s, p) => s + (p ?? 0), 0);
  const envio = Math.max(0, input.envioCentavos ?? 0);
  const descuento = Math.min(Math.max(0, input.descuentoCentavos ?? 0), costo);
  const total = costo - descuento + envio;
  const baseAnticipo = costo - descuento + (input.anticipoIncluyeEnvio ? envio : 0);
  const pct = Math.min(100, Math.max(0, input.anticipoPct ?? 50));
  const anticipo = input.anticipoCentavos != null
    ? Math.min(Math.max(0, input.anticipoCentavos), baseAnticipo)
    : Math.round((baseAnticipo * pct) / 100);
  const anticipoPct = input.anticipoCentavos != null && baseAnticipo > 0 ? redondear2((anticipo / baseAnticipo) * 100) : pct;
  const pagado = Math.max(0, input.pagadoCentavos ?? 0);
  return {
    costo, descuento, envio, total, baseAnticipo, anticipo, anticipoPct,
    pagoCompleto: total > 0 && anticipo >= total,
    pagado,
    faltaAnticipo: Math.max(0, anticipo - pagado),
    saldo: Math.max(0, total - (pagado > 0 ? pagado : anticipo)),
  };
}

/** Porcentaje ↔ monto del anticipo, para los dos campos ligados de la pantalla. */
export const montoDePorcentaje = (base: number, pct: number) => Math.round((base * Math.min(100, Math.max(0, pct))) / 100);
export const porcentajeDeMonto = (base: number, centavos: number) => (base > 0 ? redondear2((Math.min(centavos, base) / base) * 100) : 0);

/** "$3,550" a partir de centavos; muestra centavos solo si los hay. */
export function formatoPesos(centavos: number | null | undefined): string {
  if (centavos == null) return '';
  const pesos = centavos / 100;
  const decimals = Number.isInteger(pesos) ? 0 : 2;
  return `$${pesos.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Interpreta "$1,800", "1800", "1 800.50" como centavos. Devuelve null si no es número. */
export function parsePesos(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  const clean = value.replace(/[$\s,]/g, '');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
