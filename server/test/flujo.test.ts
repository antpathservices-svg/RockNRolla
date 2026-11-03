/**
 * Prueba de punta a punta contra una base Postgres real (TEST_DATABASE_URL).
 * El modelo, el calendario y WhatsApp se reemplazan por dobles; el PDF se genera de verdad.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/rnr_test npm test -w server
 */
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Extraccion, Pedido } from '@rnr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import type { Calendario, EventoCalendario } from '../src/services/calendar.js';
import { sincronizarEvento } from '../src/services/jobs.js';
import { GeneradorPdf } from '../src/services/pdf.js';

const URL = process.env.TEST_DATABASE_URL;
const NBSP = ' ';

const CHAT = [
  `21/10/2026, 8:34${NBSP}a.${NBSP}m. - Ana Pruebas: Quería dos pasteles para el 20 de noviembre`,
  `21/10/2026, 8:36${NBSP}a.${NBSP}m. - Ana Pruebas: Uno de Cars para Nico, 4 años, y uno de princesas para Mari, 4 años`,
  `21/10/2026, 11:56${NBSP}a.${NBSP}m. - Rock n Rolla Cakes: Sería de $1800 incluye coches coleccionables`,
  `21/10/2026, 11:57${NBSP}a.${NBSP}m. - Rock n Rolla Cakes: Sería de $1750`,
  `21/10/2026, 12:34${NBSP}p.${NBSP}m. - Rock n Rolla Cakes: Tarjeta 4111111111111111`,
  `21/10/2026, 1:25${NBSP}p.${NBSP}m. - Rock n Rolla Cakes: Se cobran $250 de envío`,
].join('\n');

const EXTRACCION: Extraccion = {
  resumen: 'Dos pasteles de 20 personas para el 20 de noviembre.',
  cliente_nombre: 'Ana Pruebas',
  fecha_entrega: '2026-11-20',
  hora_desde: '11:00',
  hora_hasta: '12:00',
  tipo_entrega: 'domicilio',
  direccion: 'Calle Falsa 123, Monterrey',
  envio: '250',
  anticipo_recibido: false,
  pasteles: [
    { tema: 'Cars', festejado: 'Nico', edad: '4', personas: '20', tipo: '1 piso', pan: 'Cremoso de vainilla', relleno: 'Cajeta', cubierta: '', decoracion: '', extras: [], precio: '1800' },
    { tema: 'Princesas', festejado: 'Mari', edad: '4', personas: '20', tipo: '1 piso', pan: 'Cremoso de vainilla', relleno: 'Cajeta', cubierta: '', decoracion: '', extras: [], precio: '1750' },
  ],
  dudas: [
    { campo: 'pasteles[0].precio', motivo: 'No queda claro qué precio es de cuál pastel.', mensaje_indice: 2 },
    { campo: 'pasteles[1].precio', motivo: 'No queda claro qué precio es de cuál pastel.', mensaje_indice: 3 },
  ],
  fuentes: [{ campo: 'fecha_entrega', mensaje_indice: 0 }],
};

describe.skipIf(!URL)('flujo completo', () => {
  let app: FastifyInstance;
  let db: Db;
  let ctx: Ctx;
  let cookie = '';
  const eventos: string[] = [];
  const eventosGoogle: EventoCalendario[] = [];
  const recibidoPorModelo: string[] = [];

  const calendario: Calendario = {
    disponible: true,
    cuenta: 'prueba@proyecto.iam.gserviceaccount.com',
    error: null,
    async crear(p) { eventos.push(`crear ${p.folio}`); return 'evt-1'; },
    async actualizar(id) { eventos.push(`actualizar ${id}`); return id; },
    async borrar(id) { eventos.push(`borrar ${id}`); },
    async probar() {},
    async listar() { return eventosGoogle; },
  };

  const pedir = async (method: string, url: string, body?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, payload: body as object, headers: { cookie } });
    return { status: res.statusCode, json: () => res.json(), res };
  };

  beforeAll(async () => {
    const storage = await mkdtemp(join(tmpdir(), 'rnr-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: URL!,
      SESSION_SECRET: 'a'.repeat(64),
      STORAGE_DIR: storage,
      DEV_LOGIN_EMAIL: 'duena@ejemplo.mx',
      WHATSAPP_APP_SECRET: 'secreto',
      WHATSAPP_VERIFY_TOKEN: 'verifica',
      PUBLIC_URL: 'http://localhost:3000',
    } as NodeJS.ProcessEnv);
    db = createPool(URL!);
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, () => undefined);
    await db.query(`insert into usuarios (email, rol) values ('duena@ejemplo.mx', 'dueno')`);
    ctx = {
      config,
      db,
      extractor: {
        disponible: true,
        proveedores: [{ nombre: 'claude', modelo: 'prueba' }],
        async probar() {},
        async extraer(ms) {
          recibidoPorModelo.push(...ms.map((m) => m.texto));
          return EXTRACCION;
        },
      },
      calendario,
      whatsapp: { disponible: false, async enviarTexto() {}, async enviarDocumento() {}, async probar() {} },
      pdf: new GeneradorPdf(storage),
      sincronizarCalendario: (id) => sincronizarEvento(db, calendario, config.PUBLIC_URL, id),
    };
    app = await buildApp(ctx, { logger: false });
    const login = await app.inject({ method: 'POST', url: '/auth/dev' });
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers['set-cookie']).split(';')[0];
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await ctx?.pdf.cerrar();
    await db?.end();
  });

  it('pide sesión en el panel', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/pedidos' });
    expect(r.statusCode).toBe(401);
  });

  let conversacionId = '';
  let pedido: Pedido & { pendientes: string[] };

  it('muestra la vista previa e importa el chat sin datos bancarios', async () => {
    const vp = await pedir('POST', '/api/importar/vista-previa', { texto: CHAT });
    expect(vp.status).toBe(200);
    expect(vp.json()).toMatchObject({ formato: 'android', mensajes: 6, datosBancariosOcultos: 1, propuesta: { cliente: 'Ana Pruebas' } });

    const imp = await pedir('POST', '/api/importar', { texto: CHAT, origen: 'texto' });
    expect(imp.status).toBe(200);
    conversacionId = imp.json().id;

    const c = (await pedir('GET', `/api/conversaciones/${conversacionId}`)).json();
    expect(c.conversacion.esPrueba).toBe(true);
    expect(c.mensajes.some((m: { texto: string }) => m.texto.includes('4111'))).toBe(false);
  });

  it('crea el pedido borrador con los precios por confirmar', async () => {
    const r = await pedir('POST', `/api/conversaciones/${conversacionId}/pedido`);
    expect(r.status).toBe(200);
    expect(recibidoPorModelo.join(' ')).not.toContain('4111');
    pedido = (await pedir('GET', `/api/pedidos/${r.json().id}`)).json();
    expect(pedido.folio).toMatch(/^#0001_[A-Z]{3}$/);
    expect(pedido.pasteles).toHaveLength(2);
    expect(pedido.pasteles.every((p) => !p.precioConfirmado)).toBe(true);
    expect(pedido.envioCentavos).toBe(25000);
    expect(pedido.pendientes).toEqual(['Confirma el precio del pastel 1.', 'Confirma el precio del pastel 2.']);
  });

  it('no aprueba mientras falten los precios', async () => {
    const r = await pedir('POST', `/api/pedidos/${pedido.id}/aprobar`);
    expect(r.status).toBe(422);
  });

  it('aprueba y genera la nota en PDF', async () => {
    const pasteles = pedido.pasteles.map(({ id: _id, posicion: _p, ...x }) => ({ ...x, precioConfirmado: true }));
    const r = await pedir('PATCH', `/api/pedidos/${pedido.id}`, { pasteles });
    expect(r.status).toBe(200);
    expect(r.json().pendientes).toEqual([]);

    const a = await pedir('POST', `/api/pedidos/${pedido.id}/aprobar`);
    expect(a.status).toBe(200);
    expect(a.json().version).toBe(1);
    const pdf = await pedir('GET', a.json().url);
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers['content-type']).toBe('application/pdf');
    expect(pdf.res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  }, 60_000);

  it('la vista previa de la nota lleva folio, vigencia y montos', async () => {
    const r = await pedir('GET', `/api/pedidos/${pedido.id}/nota-preview`);
    const html = r.res.body;
    expect(html).toContain(pedido.folio);
    expect(html).toContain('Cotización vigente hasta el');
    expect(html).toContain('$3,550');
    expect(html).toContain('$3,800');
    expect(html).toContain('$1,775');
    expect(html).toContain('$2,025');
  });

  it('crea el evento al aceptar y lo borra al cancelar', async () => {
    let r = await pedir('POST', `/api/pedidos/${pedido.id}/estado`, { estado: 'aceptado' });
    expect(r.status).toBe(200);
    expect(r.json().anticipoRecibidoEn).not.toBeNull();
    expect(eventos).toEqual([`crear ${pedido.folio}`]);

    r = await pedir('POST', `/api/pedidos/${pedido.id}/estado`, { estado: 'cancelado' });
    expect(r.status).toBe(422); // falta el motivo

    r = await pedir('POST', `/api/pedidos/${pedido.id}/estado`, { estado: 'cancelado', motivo: 'Cambio de fecha' });
    expect(r.status).toBe(200);
    expect(eventos).toEqual([`crear ${pedido.folio}`, 'borrar evt-1']);
  });

  it('filtra y busca en la lista', async () => {
    const r = await pedir('GET', '/api/pedidos?estado=cancelado&q=nico');
    expect(r.json()).toHaveLength(1);
    const vacia = await pedir('GET', '/api/pedidos?estado=cotizando');
    expect(vacia.json()).toHaveLength(0);
  });

  it('el cliente llena su pedido desde el link', async () => {
    const conv = await pedir('POST', '/api/importar', { texto: CHAT.split('\n').slice(0, 2).join('\n'), origen: 'archivo' });
    const link = await pedir('POST', `/api/conversaciones/${conv.json().id}/link`);
    expect(link.status).toBe(200);
    const token = link.json().url.split('/p/')[1];

    const pub = await app.inject({ method: 'GET', url: `/api/publico/${token}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ estado: 'cotizando', enviado: false, prellenado: { clienteNombre: 'Ana Pruebas' } });

    const sinPrivacidad = await app.inject({ method: 'POST', url: `/api/publico/${token}`, payload: { clienteNombre: 'Ana' } });
    expect(sinPrivacidad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/publico/${token}`,
      payload: {
        clienteNombre: 'Ana Pruebas', fechaEvento: '2026-11-20', horaEvento: '16:00', tipoEntrega: 'recoger', aceptaPrivacidad: true,
        pasteles: [{ tipo: '1 piso', personas: 20, pan: 'Chocolate', relleno: 'Nutella', extras: ['Cake topper'], festejado: 'Nico', edad: '4', descripcion: 'Cars' }],
      },
    });
    expect(ok.statusCode).toBe(200);
    const despues = (await app.inject({ method: 'GET', url: `/api/publico/${token}` })).json();
    expect(despues.enviado).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/publico/no-existe' })).statusCode).toBe(404);
  });

  it('el webhook rechaza firmas falsas y no duplica mensajes', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '5218110000000', profile: { name: 'Cliente WA' } }],
        messages: [{ id: 'wamid.1', from: '5218110000000', timestamp: '1793300000', type: 'text', text: { body: 'Hola' } }],
      } }] }],
    });
    const firma = `sha256=${createHmac('sha256', 'secreto').update(body).digest('hex')}`;
    const enviar = (sig: string) => app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });

    expect((await enviar('sha256=00')).statusCode).toBe(401);
    expect((await enviar(firma)).statusCode).toBe(200);
    expect((await enviar(firma)).statusCode).toBe(200); // reintento de Meta
    const { rows } = await db.query("select count(*)::int as n from mensajes where wa_message_id = 'wamid.1'");
    expect(rows[0].n).toBe(1);

    const verif = await app.inject({ method: 'GET', url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=123' });
    expect(verif.body).toBe('123');
  });

  it('el calendario junta pedidos y eventos de Google sin duplicar', async () => {
    const nuevo = await pedir('POST', '/api/pedidos', { clienteNombre: 'Calendario Ejemplo', fechaEntrega: '2026-12-10', horaDesde: '15:00' });
    const id = nuevo.json().id;
    const r0 = await pedir('POST', `/api/pedidos/${id}/estado`, { estado: 'aceptado' });
    expect(r0.status).toBe(200);
    const ext = { fechaFin: '2026-12-10', horaDesde: null, horaHasta: null, todoElDia: true, enlace: 'https://calendar.google.com/x', ubicacion: 'Casa' };
    eventosGoogle.push(
      { ...ext, id: 'g-ped', titulo: 'evento del pedido', fecha: '2026-12-10', pedidoId: id },
      { ...ext, id: 'g-otro', titulo: 'Cita personal', fecha: '2026-12-10', pedidoId: null },
    );
    const r = await pedir('GET', '/api/calendario?desde=2026-12-01&hasta=2026-12-31');
    expect(r.status).toBe(200);
    const v = r.json();
    expect(v.google.estado).toBe('conectado');
    expect(v.pedidos.map((p: { id: string }) => p.id)).toEqual([id]);
    expect(v.pedidos[0]).toMatchObject({ sincronizacion: 'conectado', horaDesde: '15:00' });
    expect(v.eventos).toHaveLength(1); // el del pedido no se repite
    expect(v.eventos[0].titulo).toBe('Cita personal');

    expect((await pedir('GET', '/api/calendario?desde=2026-12-01&hasta=2027-06-01')).status).toBe(400);
    const s = await pedir('POST', '/api/calendario/sincronizar', { desde: '2026-12-01', hasta: '2026-12-31' });
    expect(s.json()).toEqual({ encolados: 1 });
  });

  it('el operador no puede cambiar ajustes del dueño', async () => {
    await db.query(`insert into usuarios (email, rol) values ('operador@ejemplo.mx', 'operador')`);
    await db.query(`update usuarios set email = 'otro@ejemplo.mx' where email = 'duena@ejemplo.mx'`);
    await db.query(`update usuarios set email = 'duena@ejemplo.mx' where email = 'operador@ejemplo.mx'`);
    const login = await app.inject({ method: 'POST', url: '/auth/dev' });
    const cookieOp = String(login.headers['set-cookie']).split(';')[0];
    const r = await app.inject({ method: 'PUT', url: '/api/ajustes', payload: { vigencia_dias: 30 }, headers: { cookie: cookieOp } });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PUT', url: '/api/ajustes', payload: { nota: { subtitulo: 'Nota', contacto: [], agradecimiento: 'Gracias', lema: '' } }, headers: { cookie: cookieOp } });
    expect(ok.statusCode).toBe(200);
    // En el calendario ve que el dueño está ocupado, no su agenda personal
    const cal = await app.inject({ method: 'GET', url: '/api/calendario?desde=2026-12-01&hasta=2026-12-31&fresco=1', headers: { cookie: cookieOp } });
    expect(cal.json().eventos[0]).toMatchObject({ titulo: 'Ocupado', enlace: null, ubicacion: null });
  });

  it('existe el PDF en disco', () => {
    expect(existsSync(join(ctx.config.STORAGE_DIR, 'notas'))).toBe(true);
  });
});
