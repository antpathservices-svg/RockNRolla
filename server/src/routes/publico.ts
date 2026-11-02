import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ETIQUETA_ESTADO_CLIENTE } from '@rnr/shared';
import type { Ctx } from '../context.js';
import { registrar } from '../services/audit.js';
import { actualizarPedido, ErrorDeNegocio, pedidoPorToken, zPastelInput } from '../services/orders.js';
import { getAjustes } from '../services/settings.js';
import { guardarReferencia } from './pedidos.js';

/**
 * Link público del cliente (RF-31 a RF-43). Sin inicio de sesión: la clave larga del link
 * identifica el pedido y solo muestra ese pedido. Límite de envíos para evitar spam.
 */

const zEnvio = z.object({
  clienteNombre: z.string().trim().min(1).max(120),
  clienteTelefono: z.string().trim().max(30).optional(),
  fechaEvento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaEvento: z.string().regex(/^\d{2}:\d{2}$/),
  tipoEntrega: z.enum(['domicilio', 'recoger']),
  direccion: z.string().trim().max(500).optional(),
  aceptaPrivacidad: z.literal(true),
  pasteles: z
    .array(
      z.object({
        tipo: z.string().trim().min(1).max(60),
        personas: z.number().int().min(1).max(2000),
        pan: z.string().trim().min(1).max(60),
        relleno: z.string().trim().min(1).max(120),
        extras: z.array(z.string().trim().max(60)).max(10).default([]),
        festejado: z.string().trim().max(80).optional(),
        edad: z.string().trim().max(20).optional(),
        descripcion: z.string().trim().max(1500).optional(),
      }),
    )
    .min(1)
    .max(10),
});

export async function publicoRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const limite = { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } };

  app.get<{ Params: { token: string } }>('/api/publico/:token', { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await pedidoPorToken(db, req.params.token);
    if (!p) return reply.code(404).send({ error: 'Este link ya no está activo. Escríbenos por WhatsApp para recibir uno nuevo.' });
    const aj = await getAjustes(db);
    return {
      folio: p.folio,
      estado: p.estado,
      estadoEtiqueta: ETIQUETA_ESTADO_CLIENTE[p.estado],
      enviado: Boolean(p.formularioRecibidoEn),
      negocio: aj.nombre_negocio,
      // Lo que ya se sabe del chat, para no volver a preguntarlo
      prellenado: {
        clienteNombre: p.clienteNombre,
        necesitaTelefono: !p.clienteTelefono,
        fechaEvento: p.fechaEntrega,
        horaEvento: p.horaEvento,
        tipoEntrega: p.tipoEntrega,
        direccion: p.direccion,
      },
      resumen: p.formularioRecibidoEn
        ? { fechaEntrega: p.fechaEntrega, totalPasteles: p.pasteles.length }
        : null,
      opciones: aj.formulario,
    };
  });

  app.post<{ Params: { token: string } }>('/api/publico/:token', limite, async (req, reply) => {
    const p = await pedidoPorToken(db, req.params.token);
    if (!p) return reply.code(404).send({ error: 'Este link ya no está activo.' });
    if (p.estado !== 'cotizando') return reply.code(409).send({ error: 'Tu pedido ya está confirmado. Para cambios escríbenos por WhatsApp.' });
    const d = zEnvio.parse(req.body);
    if (d.tipoEntrega === 'domicilio' && !d.direccion) return reply.code(422).send({ error: 'Escribe la dirección de entrega.' });

    await actualizarPedido(
      db,
      p.id,
      {
        clienteNombre: d.clienteNombre,
        ...(d.clienteTelefono ? { clienteTelefono: d.clienteTelefono } : {}),
        fechaEntrega: d.fechaEvento,
        horaEvento: d.horaEvento,
        tipoEntrega: d.tipoEntrega,
        direccion: d.tipoEntrega === 'domicilio' ? d.direccion ?? null : null,
        pasteles: d.pasteles.map((x, i) =>
          zPastelInput.parse({
            // Conserva lo que la dueña ya capturó en esa posición (tema, precio)
            tema: p.pasteles[i]?.tema ?? null,
            cubierta: p.pasteles[i]?.cubierta ?? null,
            precioCentavos: p.pasteles[i]?.precioCentavos ?? null,
            precioConfirmado: p.pasteles[i]?.precioConfirmado ?? false,
            tipo: x.tipo,
            personas: x.personas,
            pan: x.pan,
            relleno: x.relleno,
            extras: x.extras,
            festejado: x.festejado ?? null,
            edad: x.edad ?? null,
            decoracion: x.descripcion ?? null,
          }),
        ),
      },
      'cliente (link)',
    );
    await db.query('update pedidos set formulario_recibido_en = now() where id = $1', [p.id]);
    await registrar(db, 'pedido', p.id, 'formulario_recibido', 'cliente (link)');
    return { ok: true, folio: p.folio };
  });

  app.post<{ Params: { token: string } }>('/api/publico/:token/fotos', limite, async (req, reply) => {
    const p = await pedidoPorToken(db, req.params.token);
    if (!p) return reply.code(404).send({ error: 'Este link ya no está activo.' });
    const { rows } = await db.query('select count(*)::int as n from referencias where pedido_id = $1', [p.id]);
    if (rows[0].n >= 6) return reply.code(422).send({ error: 'Ya recibimos el máximo de fotos para este pedido.' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No llegó ninguna foto.' });
    try {
      await guardarReferencia(ctx, p.id, file.mimetype, await file.toBuffer());
    } catch (e) {
      if (e instanceof ErrorDeNegocio) return reply.code(422).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });
}
