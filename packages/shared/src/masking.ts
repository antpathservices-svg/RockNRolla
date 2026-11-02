/**
 * Oculta números de tarjeta (13 a 19 dígitos) y CLABE (18 dígitos) antes de guardar
 * el texto para análisis y antes de mandarlo al modelo. Los teléfonos (10 dígitos)
 * y los códigos postales no se tocan.
 */

export const MASK = '[dato bancario oculto]';

// Secuencias de 13 a 19 dígitos, con espacios o guiones opcionales entre ellos.
const RE_BANCARIO = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

export interface MaskResult {
  text: string;
  count: number;
}

export function maskBankData(text: string): MaskResult {
  let count = 0;
  const out = text.replace(RE_BANCARIO, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    count++;
    return MASK;
  });
  return { text: out, count };
}
