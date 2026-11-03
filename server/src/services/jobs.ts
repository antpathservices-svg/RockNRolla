import PgBoss from 'pg-boss';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Calendario } from './calendar.js';
import { registrar } from './audit.js';
import { getPedido } from './orders.js';

export const COLA_CALENDARIO = 'calendario';

/**
 * Lleva el evento del calendario al estado del pedido (ADR-04):
 * - Aceptado en adelante, con fecha: el evento existe y está al día.
 * - Cotizando o Cancelado: el evento no existe.
 */
export async function sincronizarEvento(db: Db, calendario: Calendario, publicUrl: string, pedidoId: string): Promise<void> {
  const p = await getPedido(db, pedidoId);
  if (!p) return;
  const url = `${publicUrl}/pedidos/${p.id}`;
  const debeExistir = !['cotizando', 'cancelado'].includes(p.estado) && Boolean(p.fechaEntrega);

  if (!debeExistir) {
    if (p.eventoCalendarioId) {
      await calendario.borrar(p.eventoCalendarioId);
      await db.query('update pedidos set evento_calendario_id = null where id = $1', [p.id]);
      await registrar(db, 'pedido', p.id, 'evento_borrado', 'sistema');
    }
    return;
  }
  if (p.eventoCalendarioId) {
    const id = await calendario.actualizar(p.eventoCalendarioId, p, url);
    if (id !== p.eventoCalendarioId) {
      await db.query('update pedidos set evento_calendario_id = $2 where id = $1', [p.id, id]);
      await registrar(db, 'pedido', p.id, 'evento_creado', 'sistema', { motivo: 'el evento anterior ya no existía' });
    }
    return;
  }
  const id = await calendario.crear(p, url);
  await db.query('update pedidos set evento_calendario_id = $2 where id = $1', [p.id, id]);
  await registrar(db, 'pedido', p.id, 'evento_creado', 'sistema');
}

/**
 * Pedidos que deberían tener evento y no lo tienen: los aceptados antes de conectar el
 * calendario, o los que fallaron demasiadas veces. Solo de hoy en adelante.
 */
export async function pedidosSinEvento(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from pedidos
      where estado in ('aceptado', 'en_preparacion', 'listo')
        and fecha_entrega is not null
        and fecha_entrega >= (now() at time zone 'America/Monterrey')::date
        and evento_calendario_id is null`,
  );
  return rows.map((r) => r.id);
}

export interface Trabajos {
  encolarCalendario(pedidoId: string): Promise<void>;
  detener(): Promise<void>;
}

export async function iniciarTrabajos(
  config: Config,
  db: Db,
  calendario: Calendario,
  log: { error: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void },
): Promise<Trabajos> {
  const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => log.error(e, 'pg-boss'));
  await boss.start();
  await boss.createQueue(COLA_CALENDARIO);

  await boss.work<{ pedidoId: string }>(COLA_CALENDARIO, async ([job]) => {
    if (!calendario.disponible) return; // sin calendario configurado no hay nada que hacer
    await sincronizarEvento(db, calendario, config.PUBLIC_URL, job.data.pedidoId);
  });

  const encolarCalendario = async (pedidoId: string) => {
    // Un solo trabajo pendiente por pedido; el trabajador lee el estado más reciente.
    await boss.send(COLA_CALENDARIO, { pedidoId }, {
      singletonKey: pedidoId,
      retryLimit: 8,
      retryDelay: 15,
      retryBackoff: true,
    });
  };

  if (calendario.disponible) {
    const pendientes = await pedidosSinEvento(db);
    for (const id of pendientes) await encolarCalendario(id);
    if (pendientes.length) log.info({ pedidos: pendientes.length }, 'Calendario: pedidos aceptados sin evento puestos en cola');
  } else if (calendario.error) {
    log.error({ motivo: calendario.error }, 'Google Calendar no quedó conectado');
  }

  return {
    encolarCalendario,
    async detener() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
