import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ESTADOS, type Estado, type Pedido } from '@rnr/shared';
import type { Ctx } from '../context.js';
import { registrar } from '../services/audit.js';
import {
  actualizarPedido,
  cambiarEstado,
  crearPedido,
  desactivarLink,
  eliminarPedido,
  ErrorDeNegocio,
  generarLink,
  getPedido,
  listPedidos,
  pendientesParaAprobar,
  zPedidoPatch,
} from '../services/orders.js';
import { MAX_FOTOS_NOTA, MIME_EN_NOTA, vistaNota, type FotoNota } from '../services/pdf.js';
import { getAjustes } from '../services/settings.js';
import { requiereUsuario, usuarioActual } from './auth.js';

const zLista = z.object({
  estado: z.enum(ESTADOS).optional(),
  q: z.string().max(100).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orden: z.enum(['fecha', 'estado']).optional(),
});

export const TIPOS_IMAGEN: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
export const MAX_IMAGEN = 8 * 1024 * 1024;

/** Guarda una imagen de referencia del pedido y devuelve su id. */
export async function guardarReferencia(ctx: Ctx, pedidoId: string, mime: string, data: Buffer): Promise<string> {
  const ext = TIPOS_IMAGEN[mime];
  if (!ext) throw new ErrorDeNegocio('Solo se aceptan fotos JPG, PNG, WEBP o HEIC.');
  if (data.length > MAX_IMAGEN) throw new ErrorDeNegocio('La foto pesa más de 8 MB.');
  const id = randomUUID();
  const rel = join('referencias', pedidoId, `${id}${ext}`);
  await mkdir(join(ctx.config.STORAGE_DIR, 'referencias', pedidoId), { recursive: true });
  await writeFile(join(ctx.config.STORAGE_DIR, rel), data);
  await ctx.db.query('insert into referencias (id, pedido_id, archivo, mime) values ($1, $2, $3, $4)', [id, pedidoId, rel, mime]);
  return id;
}

function rutaSegura(storage: string, rel: string): string {
  const abs = normalize(join(storage, rel));
  if (!abs.startsWith(normalize(storage))) throw new Error('Ruta inválida');
  return abs;
}

export async function pedidosRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, config } = ctx;
  app.addHook('preHandler', requiereUsuario());
  const yo = (req: Parameters<typeof usuarioActual>[0]) => usuarioActual(req)!.email;

  /**
   * Fotos para la nota: solo se leen del disco las que se van a imprimir (hasta 4 dibujables);
   * de las demás basta el formato para que la leyenda diga cuántas quedaron fuera.
   */
  async function fotosNota(pedidoId: string): Promise<FotoNota[]> {
    const { rows } = await db.query<{ archivo: string; mime: string }>('select archivo, mime from referencias where pedido_id = $1 order by creado', [pedidoId]);
    let leidas = 0;
    return Promise.all(rows.map(async (r) => {
      if (!MIME_EN_NOTA.has(r.mime) || leidas++ >= MAX_FOTOS_NOTA) return { src: '', mime: r.mime };
      const datos = await readFile(rutaSegura(config.STORAGE_DIR, r.archivo)).catch(() => null);
      return datos ? { src: `data:${r.mime};base64,${datos.toString('base64')}`, mime: r.mime } : { src: '', mime: 'faltante' };
    }));
  }

  app.get('/api/pedidos', async (req) => listPedidos(db, zLista.parse(req.query)));

  /** El pedido con sus fotos y lo que falta para aprobarlo: misma forma en GET y PATCH. */
  async function detalle(p: Pedido) {
    const refs = await db.query('select id from referencias where pedido_id = $1 order by creado', [p.id]);
    return { ...p, referencias: refs.rows.map((r) => ({ id: r.id, url: `/api/pedidos/${p.id}/referencias/${r.id}` })), pendientes: pendientesParaAprobar(p) };
  }

  app.get<{ Params: { id: string } }>('/api/pedidos/:id', async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    return detalle(p);
  });

  app.post('/api/pedidos', async (req) => {
    const datos = zPedidoPatch.parse(req.body ?? {});
    const p = await crearPedido(db, datos, yo(req));
    return { id: p.id };
  });

  app.patch<{ Params: { id: string } }>('/api/pedidos/:id', async (req, reply) => {
    const patch = zPedidoPatch.parse(req.body);
    const p = await actualizarPedido(db, req.params.id, patch, yo(req));
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    if (p.eventoCalendarioId || !['cotizando', 'cancelado'].includes(p.estado)) await ctx.sincronizarCalendario(p.id);
    return detalle(p);
  });

  app.post<{ Params: { id: string }; Body: { estado: Estado; motivo?: string } }>('/api/pedidos/:id/estado', async (req, reply) => {
    const { estado, motivo } = z.object({ estado: z.enum(ESTADOS), motivo: z.string().max(500).optional() }).parse(req.body);
    const r = await cambiarEstado(db, req.params.id, estado, yo(req), motivo);
    if (!r) return reply.code(404).send({ error: 'No existe el pedido.' });
    await ctx.sincronizarCalendario(r.pedido.id);
    return r.pedido;
  });

  /** Aprueba el pedido y genera una nueva versión de la nota en PDF. */
  app.post<{ Params: { id: string } }>('/api/pedidos/:id/aprobar', async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    const faltan = pendientesParaAprobar(p);
    if (faltan.length) return reply.code(422).send({ error: 'Faltan datos para aprobar.', pendientes: faltan });

    const ajustes = await getAjustes(db);
    const vista = vistaNota(p, ajustes, await ctx.pdf.logoDataUri(), await fotosNota(p.id));
    const version = p.notas.length + 1;
    const nombre = `${p.folio.replace('#', '')}_v${version}.pdf`;
    const rel = await ctx.pdf.generar(vista, nombre);
    await db.query('insert into notas (pedido_id, version, archivo, creado_por) values ($1, $2, $3, $4)', [p.id, version, rel, yo(req)]);
    await db.query('update pedidos set aprobado_en = now(), aprobado_por = $2, actualizado = now() where id = $1', [p.id, yo(req)]);
    await registrar(db, 'pedido', p.id, 'nota_generada', yo(req), { version });
    return { version, url: `/api/pedidos/${p.id}/notas/${version}` };
  });

  app.get<{ Params: { id: string; version: string } }>('/api/pedidos/:id/notas/:version', async (req, reply) => {
    const { rows } = await db.query('select n.archivo, p.folio from notas n join pedidos p on p.id = n.pedido_id where n.pedido_id = $1 and n.version = $2', [
      req.params.id, Number(req.params.version),
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'No existe esa versión de la nota.' });
    const pdf = await readFile(rutaSegura(config.STORAGE_DIR, rows[0].archivo));
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="Nota ${rows[0].folio.replace('#', '')}.pdf"`)
      .send(pdf);
  });

  /** Vista previa en HTML de la nota, sin guardar versión. */
  app.get<{ Params: { id: string } }>('/api/pedidos/:id/nota-preview', async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    const vista = vistaNota(p, await getAjustes(db), await ctx.pdf.logoDataUri(), await fotosNota(p.id));
    return reply.type('text/html').send(await ctx.pdf.html(vista));
  });

  app.post<{ Params: { id: string } }>('/api/pedidos/:id/enviar-nota', async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    if (!ctx.whatsapp.disponible) return reply.code(503).send({ error: 'WhatsApp aún no está conectado. Descarga la nota y mándala desde la app.' });
    if (!p.clienteTelefono) return reply.code(422).send({ error: 'El pedido no tiene teléfono del cliente.' });
    const ultima = p.notas[p.notas.length - 1];
    if (!ultima) return reply.code(422).send({ error: 'Primero aprueba el pedido para generar la nota.' });
    const { rows } = await db.query('select archivo from notas where pedido_id = $1 and version = $2', [p.id, ultima.version]);
    const pdf = await readFile(rutaSegura(config.STORAGE_DIR, rows[0].archivo));
    await ctx.whatsapp.enviarDocumento(p.clienteTelefono, pdf, `Nota ${p.folio.replace('#', '')}.pdf`, `Tu nota de pedido ${p.folio}`);
    await registrar(db, 'pedido', p.id, 'nota_enviada', yo(req), { version: ultima.version });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/pedidos/:id/link', async (req, reply) => {
    const aj = await getAjustes(db);
    const token = await generarLink(db, req.params.id, aj.link_dias_validez, yo(req));
    if (!token) return reply.code(404).send({ error: 'No existe el pedido.' });
    return { url: `${config.PUBLIC_URL}/p/${token}` };
  });

  /** Solo el dueño. Borra también el evento de Google Calendar y los archivos en disco. */
  app.delete<{ Params: { id: string } }>('/api/pedidos/:id', { preHandler: requiereUsuario('dueno') }, async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });

    // El evento se borra antes que el pedido: después ya no habría con qué encontrarlo.
    let avisoCalendario: string | null = null;
    if (p.eventoCalendarioId) {
      if (!ctx.calendario.disponible) avisoCalendario = 'Google Calendar no está conectado: borra el evento a mano.';
      else {
        try {
          await ctx.calendario.borrar(p.eventoCalendarioId);
        } catch (e) {
          req.log.error(e, 'No se pudo borrar el evento del pedido eliminado');
          avisoCalendario = `No se pudo borrar el evento de Google Calendar (${(e as Error).message.slice(0, 160)}). Bórralo a mano.`;
        }
      }
    }

    const r = await eliminarPedido(db, p.id, yo(req));
    if (!r) return reply.code(404).send({ error: 'No existe el pedido.' });
    for (const a of r.archivos) await rm(rutaSegura(config.STORAGE_DIR, a), { force: true }).catch((e) => req.log.warn(e, 'Archivo no borrado'));
    await rm(rutaSegura(config.STORAGE_DIR, join('referencias', p.id)), { recursive: true, force: true }).catch(() => undefined);
    return { ok: true, folio: r.folio, avisoCalendario };
  });

  app.delete<{ Params: { id: string } }>('/api/pedidos/:id/link', async (req) => {
    await desactivarLink(db, req.params.id, yo(req));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/pedidos/:id/referencias', async (req, reply) => {
    const p = await getPedido(db, req.params.id);
    if (!p) return reply.code(404).send({ error: 'No existe el pedido.' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No llegó ninguna foto.' });
    const id = await guardarReferencia(ctx, p.id, file.mimetype, await file.toBuffer());
    return { id, url: `/api/pedidos/${p.id}/referencias/${id}` };
  });

  app.get<{ Params: { id: string; ref: string } }>('/api/pedidos/:id/referencias/:ref', async (req, reply) => {
    const { rows } = await db.query('select archivo, mime from referencias where pedido_id = $1 and id = $2', [req.params.id, req.params.ref]);
    if (!rows[0]) return reply.code(404).send({ error: 'No existe la foto.' });
    return reply.type(rows[0].mime).header('cache-control', 'private, max-age=86400').send(await readFile(rutaSegura(config.STORAGE_DIR, rows[0].archivo)));
  });

  app.delete<{ Params: { id: string; ref: string } }>('/api/pedidos/:id/referencias/:ref', async (req) => {
    await db.query('delete from referencias where pedido_id = $1 and id = $2', [req.params.id, req.params.ref]);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/pedidos/:id/bitacora', async (req) => {
    const { rows } = await db.query(
      `select accion, detalle, usuario, creado from bitacora where entidad = 'pedido' and entidad_id = $1 order by creado desc limit 100`,
      [req.params.id],
    );
    return rows;
  });
}
