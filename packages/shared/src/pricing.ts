/**
 * Montos del pedido, en centavos para evitar errores de redondeo.
 *
 * Regla tomada de las notas reales:
 *   anticipo = porcentaje de (pasteles − descuento); el envío se cobra con el saldo.
 *   Ej. Lourdes: pasteles $3,550, envío $250 → total $3,800, anticipo $1,775, saldo $2,025.
 */

export interface MontosInput {
  preciosCentavos: Array<number | null | undefined>;
  envioCentavos?: number | null;
  descuentoCentavos?: number | null;
  anticipoPct?: number | null;
}

export interface Montos {
  costo: number;
  descuento: number;
  envio: number;
  total: number;
  anticipo: number;
  saldo: number;
}

export function calcularMontos(input: MontosInput): Montos {
  const costo = input.preciosCentavos.reduce<number>((s, p) => s + (p ?? 0), 0);
  const envio = Math.max(0, input.envioCentavos ?? 0);
  const descuento = Math.min(Math.max(0, input.descuentoCentavos ?? 0), costo);
  const pct = Math.min(100, Math.max(0, input.anticipoPct ?? 50));
  const base = costo - descuento;
  const anticipo = Math.round((base * pct) / 100);
  const total = base + envio;
  return { costo, descuento, envio, total, anticipo, saldo: total - anticipo };
}

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
