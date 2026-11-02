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
    await calendario.actualizar(p.eventoCalendarioId, p, url);
    return;
  }
  const id = await calendario.crear(p, url);
  await db.query('update pedidos set evento_calendario_id = $2 where id = $1', [p.id, id]);
  await registrar(db, 'pedido', p.id, 'evento_creado', 'sistema');
}

export interface Trabajos {
  encolarCalendario(pedidoId: string): Promise<void>;
  detener(): Promise<void>;
}

export async function iniciarTrabajos(config: Config, db: Db, calendario: Calendario, log: { error: (o: unknown, m?: string) => void }): Promise<Trabajos> {
  const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => log.error(e, 'pg-boss'));
  await boss.start();
  await boss.createQueue(COLA_CALENDARIO);

  await boss.work<{ pedidoId: string }>(COLA_CALENDARIO, async ([job]) => {
    if (!calendario.disponible) return; // sin calendario configurado no hay nada que hacer
    await sincronizarEvento(db, calendario, config.PUBLIC_URL, job.data.pedidoId);
  });

  return {
    async encolarCalendario(pedidoId) {
      // Un solo trabajo pendiente por pedido; el trabajador lee el estado más reciente.
      await boss.send(COLA_CALENDARIO, { pedidoId }, {
        singletonKey: pedidoId,
        retryLimit: 8,
        retryDelay: 15,
        retryBackoff: true,
      });
    },
    async detener() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
