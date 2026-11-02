import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { ExtractorNoDisponible } from '../services/extraction.js';
import { crearPedido, generarLink, pedidoDesdeExtraccion } from '../services/orders.js';
import { borrarConversacion, getConversacion, importarChat, listarConversaciones, vistaPrevia } from '../services/conversations.js';
import { getAjustes } from '../services/settings.js';
import { requiereUsuario, usuarioActual } from './auth.js';

const MAX_TEXTO = 2 * 1024 * 1024; // 2 MB

/** Error del proveedor del modelo: se registra completo y la pantalla recibe el motivo, sin "Ocurrió un error". */
function errorDelModelo(req: FastifyRequest, reply: FastifyReply, e: unknown) {
  req.log.error(e, 'Falló el modelo');
  const msg = (e as Error).message ?? 'Error desconocido';
  return reply.code(502).send({ error: `No se pudo leer el chat con el modelo. ${msg.slice(0, 300)}` });
}

const zVista = z.object({ texto: z.string().min(1).max(MAX_TEXTO) });
const zImportar = z.object({
  texto: z.string().min(1).max(MAX_TEXTO),
  origen: z.enum(['archivo', 'texto']),
  nombreArchivo: z.string().max(255).nullish(),
  clienteAutor: z.string().max(120).nullish(),
  desdeIndice: z.number().int().min(0).nullish(),
  hastaIndice: z.number().int().min(0).nullish(),
});

export async function conversacionesRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.addHook('preHandler', requiereUsuario());

  app.get<{ Querystring: { q?: string } }>('/api/conversaciones', async (req) => listarConversaciones(db, req.query.q?.trim() || undefined));

  app.get<{ Params: { id: string } }>('/api/conversaciones/:id', async (req, reply) => {
    const c = await getConversacion(db, req.params.id);
    return c ?? reply.code(404).send({ error: 'No existe la conversación.' });
  });

  app.delete<{ Params: { id: string } }>('/api/conversaciones/:id', async (req, reply) => {
    const ok = await borrarConversacion(db, req.params.id, usuarioActual(req)!.email);
    return ok ? { ok } : reply.code(404).send({ error: 'Solo se pueden borrar conversaciones de prueba.' });
  });

  app.post('/api/importar/vista-previa', { bodyLimit: MAX_TEXTO + 10_000 }, async (req) => {
    const { texto } = zVista.parse(req.body);
    const aj = await getAjustes(db);
    return vistaPrevia(texto, aj.nombre_negocio, aj.pausa_tramos_dias);
  });

  app.post('/api/importar', { bodyLimit: MAX_TEXTO + 10_000 }, async (req) => {
    const input = zImportar.parse(req.body);
    const aj = await getAjustes(db);
    const id = await importarChat(db, input, aj.nombre_negocio, usuarioActual(req)!.email);
    return { id };
  });

  /** Resume el chat y guarda la extracción en la conversación. */
  app.post<{ Params: { id: string } }>('/api/conversaciones/:id/resumen', async (req, reply) => {
    const c = await getConversacion(db, req.params.id);
    if (!c) return reply.code(404).send({ error: 'No existe la conversación.' });
    try {
      const ext = await ctx.extractor.extraer(
        c.mensajes.map((m) => ({ indice: m.indice, rol: m.rol, enviado: m.enviado, texto: m.texto, tipo: m.tipo })),
      );
      await db.query('update conversaciones set resumen = $2, extraccion = $3, cliente_nombre = coalesce(cliente_nombre, nullif($4, \'\')) where id = $1', [
        c.conversacion.id, ext.resumen, JSON.stringify(ext), ext.cliente_nombre,
      ]);
      return { resumen: ext.resumen, extraccion: ext };
    } catch (e) {
      if (e instanceof ExtractorNoDisponible) return reply.code(503).send({ error: e.message });
      return errorDelModelo(req, reply, e);
    }
  });

  /** Crea el pedido borrador a partir de la extracción (la hace si falta). */
  app.post<{ Params: { id: string } }>('/api/conversaciones/:id/pedido', async (req, reply) => {
    const c = await getConversacion(db, req.params.id);
    if (!c) return reply.code(404).send({ error: 'No existe la conversación.' });
    if (c.conversacion.pedidoId) return { id: c.conversacion.pedidoId, existente: true };
    let ext = c.extraccion as Parameters<typeof pedidoDesdeExtraccion>[0] | null;
    try {
      if (!ext) {
        ext = await ctx.extractor.extraer(
          c.mensajes.map((m) => ({ indice: m.indice, rol: m.rol, enviado: m.enviado, texto: m.texto, tipo: m.tipo })),
        );
        await db.query('update conversaciones set resumen = $2, extraccion = $3 where id = $1', [c.conversacion.id, ext.resumen, JSON.stringify(ext)]);
      }
    } catch (e) {
      if (e instanceof ExtractorNoDisponible) return reply.code(503).send({ error: e.message });
      return errorDelModelo(req, reply, e);
    }
    const datos = pedidoDesdeExtraccion(ext);
    const p = await crearPedido(
      db,
      {
        ...datos,
        clienteNombre: datos.clienteNombre ?? c.conversacion.clienteNombre,
        clienteTelefono: c.conversacion.clienteTelefono,
        conversacionId: c.conversacion.id,
        esPrueba: c.conversacion.esPrueba,
      },
      usuarioActual(req)!.email,
    );
    return { id: p.id, existente: false };
  });

  /** Link para que el cliente llene su pedido. Crea un pedido vacío si la conversación no tiene. */
  app.post<{ Params: { id: string } }>('/api/conversaciones/:id/link', async (req, reply) => {
    const c = await getConversacion(db, req.params.id);
    if (!c) return reply.code(404).send({ error: 'No existe la conversación.' });
    const usuario = usuarioActual(req)!.email;
    let pedidoId = c.conversacion.pedidoId;
    if (!pedidoId) {
      const p = await crearPedido(db, {
        conversacionId: c.conversacion.id,
        clienteNombre: c.conversacion.clienteNombre,
        clienteTelefono: c.conversacion.clienteTelefono,
        esPrueba: c.conversacion.esPrueba,
      }, usuario);
      pedidoId = p.id;
    }
    const aj = await getAjustes(db);
    const token = await generarLink(db, pedidoId, aj.link_dias_validez, usuario);
    return { pedidoId, url: `${ctx.config.PUBLIC_URL}/p/${token}` };
  });
}
