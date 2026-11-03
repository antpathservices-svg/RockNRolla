import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import type { EventoCalendario } from '../services/calendar.js';
import { listPedidos } from '../services/orders.js';
import { requiereUsuario, usuarioActual } from './auth.js';

const zRango = z
  .object({
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((r) => r.desde <= r.hasta, 'La fecha inicial va antes de la final.')
  .refine((r) => (Date.parse(r.hasta) - Date.parse(r.desde)) / 86400_000 <= 62, 'Pide como máximo dos meses a la vez.');

/** Vista de calendario: pedidos por fecha de entrega más los eventos del calendario de Google. */
export async function calendarioRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.addHook('preHandler', requiereUsuario());

  // Pequeño caché para no llamar a Google en cada cambio de pestaña.
  const cache = new Map<string, { hasta: number; eventos: EventoCalendario[] }>();

  app.get('/api/calendario', async (req) => {
    const { desde, hasta } = zRango.parse(req.query);
    const esDueno = usuarioActual(req)!.rol === 'dueno';

    const pedidos = (await listPedidos(db, { desde, hasta })).filter((p) => p.estado !== 'cancelado');
    const extra = pedidos.length
      ? await db.query<{ id: string; hora_hasta: string | null; evento: boolean; direccion: string | null }>(
          `select id, to_char(hora_hasta, 'HH24:MI') as hora_hasta, evento_calendario_id is not null as evento, direccion
             from pedidos where id = any($1::uuid[])`,
          [pedidos.map((p) => p.id)],
        )
      : { rows: [] };
    const porId = new Map(extra.rows.map((r) => [r.id, r]));

    let google: { estado: 'conectado' | 'sin_configurar' | 'error'; error: string | null } = {
      estado: ctx.calendario.disponible ? 'conectado' : ctx.calendario.error ? 'error' : 'sin_configurar',
      error: ctx.calendario.error,
    };
    let eventos: EventoCalendario[] = [];
    if (ctx.calendario.disponible) {
      const clave = `${desde}|${hasta}`;
      const c = cache.get(clave);
      if (c && c.hasta > Date.now() && (req.query as { fresco?: string }).fresco !== '1') eventos = c.eventos;
      else {
        try {
          eventos = await ctx.calendario.listar(desde, hasta);
          cache.set(clave, { hasta: Date.now() + 30_000, eventos });
          if (cache.size > 50) cache.delete(cache.keys().next().value!);
        } catch (e) {
          req.log.error(e, 'No se pudo leer Google Calendar');
          google = { estado: 'error', error: (e as Error).message };
        }
      }
    }

    // Los eventos que creó la plataforma ya están representados por su pedido.
    const enGoogle = new Set(eventos.filter((e) => e.pedidoId).map((e) => e.pedidoId!));
    const otros = eventos
      .filter((e) => !e.pedidoId)
      // El operador ve el espacio ocupado, no la agenda personal del dueño.
      .map((e) => (esDueno ? e : { ...e, titulo: 'Ocupado', enlace: null, ubicacion: null }));

    return {
      desde,
      hasta,
      google,
      pedidos: pedidos.map((p) => {
        const x = porId.get(p.id);
        const debeTenerEvento = p.estado !== 'cotizando';
        return {
          ...p,
          horaHasta: x?.hora_hasta ?? null,
          direccion: x?.direccion ?? null,
          // conectado | pendiente (aún no llega a Google) | no_aplica (cotización o sin calendario)
          sincronizacion: !debeTenerEvento || google.estado === 'sin_configurar'
            ? 'no_aplica'
            : google.estado === 'conectado'
              ? x?.evento && enGoogle.has(p.id) ? 'conectado' : 'pendiente'
              : x?.evento ? 'conectado' : 'pendiente',
        };
      }),
      eventos: otros,
    };
  });

  /** Vuelve a llevar a Google los pedidos del rango (por si alguien movió o borró eventos a mano). */
  app.post('/api/calendario/sincronizar', async (req, reply) => {
    if (!ctx.calendario.disponible) return reply.code(409).send({ error: ctx.calendario.error ?? 'Google Calendar no está configurado.' });
    const { desde, hasta } = zRango.parse(req.body);
    const pedidos = (await listPedidos(db, { desde, hasta })).filter((p) => !['cotizando', 'cancelado'].includes(p.estado));
    for (const p of pedidos) await ctx.sincronizarCalendario(p.id);
    cache.clear();
    return { encolados: pedidos.length };
  });
}
