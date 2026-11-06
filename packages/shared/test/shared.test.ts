import { describe, expect, it } from 'vitest';
import {
  calcularMontos,
  montoDePorcentaje,
  porcentajeDeMonto,
  fechaMasDias,
  formatFolio,
  formatoPesos,
  guessRoles,
  maskBankData,
  MASK,
  parseChat,
  parsePesos,
  splitSegments,
} from '../src/index.js';
import { ANDROID, COPIADO, IOS } from './fixtures.js';

describe('parseChat · Android', () => {
  const r = parseChat(ANDROID);

  it('detecta el formato y los autores', () => {
    expect(r.format).toBe('android');
    expect(r.authors).toEqual(['Ana Pruebas', 'Rock n Rolla Cakes']);
  });

  it('separa las líneas del sistema', () => {
    expect(r.messages[0].kind).toBe('sistema');
    expect(r.messages[1].kind).toBe('sistema');
    expect(r.messages[1].text).toBe('Ana Pruebas es un contacto.');
  });

  it('convierte la hora a 24 h en zona de Monterrey', () => {
    expect(r.messages[2].sentAt).toBe('2026-09-07T11:29:00-06:00');
    const ultimo = r.messages[r.messages.length - 1];
    expect(ultimo.sentAt).toBe('2026-10-21T13:01:00-06:00');
  });

  it('reconoce adjuntos y multimedia omitida, y une las líneas de continuación', () => {
    const adj = r.messages.find((m) => m.kind === 'adjunto');
    expect(adj?.attachmentName).toBe('IMG-20260907-WA0003.jpg');
    const om = r.messages.find((m) => m.kind === 'multimedia_omitida');
    expect(om).toBeUndefined(); // tiene texto debajo, así que queda como texto
    const conTexto = r.messages.find((m) => m.text.startsWith('<Multimedia omitido>'));
    expect(conTexto?.text).toContain('Te muestro:');
  });

  it('quita la marca de editado', () => {
    const ed = r.messages.find((m) => m.edited);
    expect(ed?.text).toBe('20 personas cada uno');
  });

  it('mensajes de varias líneas', () => {
    const m = r.messages.find((x) => x.text.startsWith('Sería de $1750'));
    expect(m?.text).toBe('Sería de $1750\nPan cremoso vainilla');
  });
});

describe('parseChat · copiado e iPhone', () => {
  it('lee el texto copiado de la app', () => {
    const r = parseChat(COPIADO);
    expect(r.format).toBe('copiado');
    expect(r.messages).toHaveLength(3);
    expect(r.messages[2].sentAt).toBe('2026-10-21T12:03:00-06:00');
  });

  it('lee la exportación de iPhone', () => {
    const r = parseChat(IOS);
    expect(r.format).toBe('ios');
    expect(r.messages[0].sentAt).toBe('2026-10-21T08:34:12-06:00');
    expect(r.messages[1].kind).toBe('adjunto');
  });

  it('texto sin formato queda como un solo mensaje', () => {
    const r = parseChat('hola\nquiero un pastel');
    expect(r.format).toBe('desconocido');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].author).toBeNull();
  });
});

describe('maskBankData', () => {
  it('oculta tarjeta y CLABE pero no teléfonos', () => {
    const r = parseChat(ANDROID);
    const plantilla = r.messages.find((m) => m.text.includes('Antes de realizar'))!;
    const masked = maskBankData(plantilla.text);
    expect(masked.count).toBe(2);
    expect(masked.text).not.toContain('4111111111111111');
    expect(masked.text).toContain(MASK);
    const tel = maskBankData('tel 8112345678 y CP 64710');
    expect(tel.count).toBe(0);
  });

  it('reconoce tarjetas con espacios', () => {
    expect(maskBankData('4111 1111 1111 1111').count).toBe(1);
  });
});

describe('tramos y roles', () => {
  it('divide por pausas de más de 7 días', () => {
    const r = parseChat(ANDROID);
    const s = splitSegments(r.messages);
    expect(s).toHaveLength(2);
    expect(s[1].from.startsWith('2026-10-21')).toBe(true);
  });

  it('propone negocio y cliente', () => {
    expect(guessRoles(['Ana Pruebas', 'Rock n Rolla Cakes'], 'Rock N Rolla Cakes')).toEqual({
      negocio: 'Rock n Rolla Cakes',
      cliente: 'Ana Pruebas',
    });
  });
});

describe('montos', () => {
  it('reproduce la nota de Lourdes', () => {
    const m = calcularMontos({ preciosCentavos: [180000, 175000], envioCentavos: 25000, anticipoPct: 50 });
    expect(m).toMatchObject({ costo: 355000, descuento: 0, envio: 25000, total: 380000, anticipo: 177500, saldo: 202500, anticipoPct: 50, pagoCompleto: false });
  });

  it('el anticipo puede incluir el envío', () => {
    const m = calcularMontos({ preciosCentavos: [355000], envioCentavos: 25000, anticipoPct: 50, anticipoIncluyeEnvio: true });
    expect(m).toMatchObject({ baseAnticipo: 380000, anticipo: 190000, saldo: 190000 });
  });

  it('pago completo con envío deja el saldo en cero', () => {
    const m = calcularMontos({ preciosCentavos: [355000], envioCentavos: 25000, anticipoPct: 100, anticipoIncluyeEnvio: true });
    expect(m).toMatchObject({ anticipo: 380000, saldo: 0, pagoCompleto: true });
    // Sin incluir el envío, el 100 % de los pasteles deja el envío en el saldo
    expect(calcularMontos({ preciosCentavos: [355000], envioCentavos: 25000, anticipoPct: 100 })).toMatchObject({ anticipo: 355000, saldo: 25000, pagoCompleto: false });
  });

  it('un monto fijo manda sobre el porcentaje y da el porcentaje real', () => {
    const m = calcularMontos({ preciosCentavos: [355000], envioCentavos: 25000, anticipoPct: 50, anticipoCentavos: 100000 });
    expect(m).toMatchObject({ anticipo: 100000, anticipoPct: 28.17, saldo: 280000 });
    // No puede pasar de su base
    expect(calcularMontos({ preciosCentavos: [100000], anticipoCentavos: 500000 }).anticipo).toBe(100000);
  });

  it('con pagos registrados el saldo es lo que falta', () => {
    const m = calcularMontos({ preciosCentavos: [355000], envioCentavos: 25000, anticipoPct: 50, pagadoCentavos: 100000 });
    expect(m).toMatchObject({ pagado: 100000, faltaAnticipo: 77500, saldo: 280000 });
    expect(montoDePorcentaje(380000, 25)).toBe(95000);
    expect(porcentajeDeMonto(380000, 95000)).toBe(25);
  });

  it('reproduce la nota de Mildred', () => {
    const m = calcularMontos({ preciosCentavos: [650000], envioCentavos: 45000 });
    expect(m.total).toBe(695000);
    expect(m.anticipo).toBe(325000);
    expect(m.saldo).toBe(370000);
  });

  it('aplica el descuento antes del anticipo', () => {
    const m = calcularMontos({ preciosCentavos: [100000], descuentoCentavos: 20000, anticipoPct: 50 });
    expect(m.anticipo).toBe(40000);
    expect(m.total).toBe(80000);
  });

  it('formatea y lee pesos', () => {
    expect(formatoPesos(355000)).toBe('$3,550');
    expect(formatoPesos(12550)).toBe('$125.50');
    expect(parsePesos('$1,800')).toBe(180000);
    expect(parsePesos('')).toBeNull();
    expect(parsePesos('abc')).toBeNull();
  });
});

describe('folio y vigencia', () => {
  it('usa el formato del Excel', () => {
    expect(formatFolio(12, new Date('2026-11-03T18:00:00Z'))).toBe('#0012_NOV');
  });

  it('usa el mes de Monterrey, no el de UTC', () => {
    // 1 de nov 03:00 UTC es todavía 31 de oct en Monterrey
    expect(formatFolio(4, new Date('2026-11-01T03:00:00Z'))).toBe('#0004_OCT');
  });

  it('suma días para la vigencia', () => {
    expect(fechaMasDias(15, new Date('2026-10-30T18:00:00Z'))).toBe('2026-11-14');
  });
});
