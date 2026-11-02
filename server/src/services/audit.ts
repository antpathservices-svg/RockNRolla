import type { Db } from '../db.js';

/** Bitácora de cambios: quién, qué y cuándo. Nunca guarda valores secretos. */
export async function registrar(
  db: Pick<Db, 'query'>,
  entidad: string,
  entidadId: string | null,
  accion: string,
  usuario: string | null,
  detalle?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'insert into bitacora (entidad, entidad_id, accion, detalle, usuario) values ($1, $2, $3, $4, $5)',
    [entidad, entidadId, accion, detalle ? JSON.stringify(detalle) : null, usuario],
  );
}
