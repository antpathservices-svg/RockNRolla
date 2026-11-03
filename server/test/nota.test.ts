import { describe, expect, it } from 'vitest';
import type { Pedido } from '@rnr/shared';
import { AJUSTES_INICIALES } from '../src/services/settings.js';
import { vistaNota, type FotoNota } from '../src/services/pdf.js';

const pastel = (tema: string) => ({ tema, festejado: null, edad: null, personas: 20, tipo: null, pan: 'Vainilla', relleno: 'Cajeta', cubierta: null, decoracion: null, extras: [], precioCentavos: 100000, precioConfirmado: true });
const pedido = (n = 1) => ({
  id: 'p', folio: '#0001_NOV', estado: 'cotizando', clienteNombre: 'Ana', fechaEntrega: '2026-11-20', horaDesde: null, horaHasta: null,
  tipoEntrega: 'recoger', direccion: null, envioCentavos: 0, descuentoCentavos: 0, anticipoPct: 50, vigenciaHasta: null,
  pasteles: Array.from({ length: n }, (_, i) => pastel(`Tema ${i + 1}`)), notas: [],
}) as unknown as Pedido;
const fotos = (n: number, mime = 'image/jpeg'): FotoNota[] => Array.from({ length: n }, (_, i) => ({ src: `data:${mime};base64,${i}`, mime }));
const vista = (f: FotoNota[], n = 1) => vistaNota(pedido(n), AJUSTES_INICIALES as never, 'data:image/png;base64,', f);

describe('fotos en la nota', () => {
  it('muestra 1 a 4 fotos con su acomodo', () => {
    for (const n of [1, 2, 3, 4]) {
      const v = vista(fotos(n));
      expect(v.referencias).toHaveLength(n);
      expect(v.referencias_clase).toBe(`n${n}`);
    }
    expect(vista(fotos(1)).referencias_leyenda).toBe('Referencia del diseño');
    expect(vista(fotos(3)).referencias_leyenda).toBe('Referencias del diseño');
  });

  it('con más de 4 avisa cuántas quedaron fuera', () => {
    const v = vista(fotos(6));
    expect(v.referencias).toHaveLength(4);
    expect(v.referencias_leyenda).toContain('2 fotos más en el pedido');
  });

  it('omite HEIC (no se imprime) y lo dice', () => {
    const v = vista([...fotos(2), ...fotos(1, 'image/heic')]);
    expect(v.referencias).toHaveLength(2);
    expect(v.referencias_leyenda).toContain('1 foto está en un formato que no se puede imprimir');
  });

  it('sin fotos no hay leyenda', () => {
    const v = vista([]);
    expect(v.referencias).toHaveLength(0);
    expect(v.referencias_leyenda).toBeNull();
  });

  it('agrupa los detalles por pastel y marca varios pasteles', () => {
    const uno = vista([], 1);
    expect(uno.varios_pasteles).toBe(false);
    expect(uno.pasteles[0].subtitulo).toBeNull();
    const tres = vista([], 3);
    expect(tres.varios_pasteles).toBe(true);
    expect(tres.pasteles.map((p) => p.subtitulo)).toEqual(['Pastel 1 · Tema 1', 'Pastel 2 · Tema 2', 'Pastel 3 · Tema 3']);
    expect(tres.pasteles[0].filas.map((f) => f.etiqueta)).toEqual(['Pan', 'Relleno']);
  });
});
