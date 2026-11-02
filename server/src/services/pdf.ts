import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Mustache from 'mustache';
import { calcularMontos, formatoPesos, type Pedido } from '@rnr/shared';
import type { Browser } from 'playwright';
import type { Ajustes } from './settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = join(root, 'templates', 'nota.html');
const LOGO = join(root, 'assets', 'logo.png');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suf = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suf}` : `${h12}${suf}`;
}

export function rangoHora(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return `${hora12(desde)} a ${hora12(hasta)}`;
  if (desde) return hora12(desde);
  return '';
}

const unir = (vals: Array<string | number | null | undefined>, sep = ' / ') => {
  const v = vals.filter((x) => x != null && String(x).trim() !== '').map(String);
  if (v.length === 0) return '';
  return new Set(v).size === 1 && vals.length > 1 ? v[0] : v.join(sep);
};

interface Campo { etiqueta: string; valor: string }
type Detalle = Campo | { subtitulo: string };

/** Arma el "view-model" de la plantilla Mustache a partir del pedido. */
export function vistaNota(p: Pedido, ajustes: Ajustes, logoDataUri: string, referencias: string[]) {
  const ps = p.pasteles;
  const montos = calcularMontos({
    preciosCentavos: ps.map((x) => x.precioCentavos),
    envioCentavos: p.envioCentavos,
    descuentoCentavos: p.descuentoCentavos,
    anticipoPct: p.anticipoPct,
  });

  const personas = ps.length > 1
    ? `${ps.length} pasteles ${unir(ps.map((x) => (x.personas ? `${x.personas} p` : null)))}${new Set(ps.map((x) => x.personas)).size === 1 ? ' c/u' : ''}`
    : ps[0]?.personas ? `${ps[0].personas} porciones` : '';

  const campos: Campo[] = [
    { etiqueta: 'Fecha', valor: fechaLarga(p.fechaEntrega) },
    { etiqueta: 'Hora', valor: rangoHora(p.horaDesde, p.horaHasta) },
    { etiqueta: 'Dirección', valor: p.tipoEntrega === 'recoger' ? 'Recoge en sucursal' : p.direccion ?? '' },
    { etiqueta: 'Tema', valor: unir(ps.map((x) => x.tema)) },
    { etiqueta: 'Cantidad', valor: personas },
    { etiqueta: 'Pisos', valor: unir(ps.map((x) => x.tipo)) },
    { etiqueta: 'Edad', valor: unir(ps.map((x) => x.edad)) },
    { etiqueta: 'Nombre', valor: unir(ps.map((x) => x.festejado)) },
  ].filter((c) => c.valor);

  const detalles: Detalle[] = [];
  for (const [i, x] of ps.entries()) {
    if (ps.length > 1) detalles.push({ subtitulo: `Pastel ${i + 1}${x.tema ? ` · ${x.tema}` : ''}` });
    const filas: Campo[] = [
      { etiqueta: 'Pan', valor: x.pan ?? '' },
      { etiqueta: 'Relleno', valor: x.relleno ?? '' },
      { etiqueta: 'Cubierta', valor: x.cubierta ?? '' },
      { etiqueta: 'Decoración', valor: x.decoracion ?? '' },
      { etiqueta: 'Extras', valor: x.extras.join(', ') },
    ];
    detalles.push(...filas.filter((f) => f.valor));
  }

  return {
    marca: {
      nombre: 'ROCK N ROLLA CAKES',
      subtitulo: ajustes.nota.subtitulo,
      contacto: ajustes.nota.contacto,
      logo: logoDataUri,
      agradecimiento: ajustes.nota.agradecimiento,
      lema: ajustes.nota.lema,
    },
    cliente: (p.clienteNombre ?? '').toUpperCase(),
    folio: p.folio,
    vigencia: p.estado === 'cotizando' && p.vigenciaHasta ? fechaLarga(p.vigenciaHasta) : null,
    campos,
    referencias: referencias.slice(0, 2).map((src) => ({ src })),
    referencias_leyenda: referencias.length ? 'Referencia del diseño' : null,
    detalles,
    costo: formatoPesos(montos.costo - montos.descuento),
    envio: montos.envio ? formatoPesos(montos.envio) : null,
    total: formatoPesos(montos.total),
    anticipo: formatoPesos(montos.anticipo),
    saldo: formatoPesos(montos.saldo),
  };
}

/**
 * Genera PDFs de uno en uno: en un VPS de 2 GB, dos Chromium a la vez pueden agotar la memoria.
 */
export class GeneradorPdf {
  private browser: Promise<Browser> | null = null;
  private cola: Promise<unknown> = Promise.resolve();
  private plantilla: string | null = null;
  private logo: string | null = null;

  constructor(private readonly storageDir: string) {}

  private async navegador(): Promise<Browser> {
    if (!this.browser) {
      this.browser = import('playwright').then(({ chromium }) => chromium.launch({ args: ['--disable-dev-shm-usage'] }));
      this.browser.catch(() => (this.browser = null));
    }
    return this.browser;
  }

  async html(vista: ReturnType<typeof vistaNota>): Promise<string> {
    this.plantilla ??= await readFile(TEMPLATE, 'utf8');
    return Mustache.render(this.plantilla, vista);
  }

  async logoDataUri(): Promise<string> {
    this.logo ??= `data:image/png;base64,${(await readFile(LOGO)).toString('base64')}`;
    return this.logo;
  }

  /** Renderiza y guarda el PDF; devuelve la ruta relativa dentro de STORAGE_DIR. */
  generar(vista: ReturnType<typeof vistaNota>, nombre: string): Promise<string> {
    const tarea = this.cola.then(async () => {
      const html = await this.html(vista);
      const browser = await this.navegador();
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const rel = join('notas', nombre);
        const abs = join(this.storageDir, rel);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, pdf);
        return rel;
      } finally {
        await page.close();
      }
    });
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  async cerrar(): Promise<void> {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
