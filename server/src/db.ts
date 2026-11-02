import pg from 'pg';

// Las columnas DATE se devuelven como texto 'YYYY-MM-DD' para no moverlas de día por la zona horaria.
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC como número de JS (solo se usa para porcentajes).
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
