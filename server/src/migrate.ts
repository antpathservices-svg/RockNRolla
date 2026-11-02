import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Aplica en orden los archivos .sql que falten. Cada uno corre en su propia transacción. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<void> {
  await db.query(`create table if not exists schema_migrations (nombre text primary key, aplicada timestamptz not null default now())`);
  const done = new Set((await db.query<{ nombre: string }>('select nombre from schema_migrations')).rows.map((r) => r.nombre));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('insert into schema_migrations (nombre) values ($1)', [f]);
      await client.query('COMMIT');
      log(`Migración aplicada: ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

// Uso directo: npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadConfig } = await import('./config.js');
  const { createPool } = await import('./db.js');
  const db = createPool(loadConfig().DATABASE_URL);
  await migrate(db);
  await db.end();
}
