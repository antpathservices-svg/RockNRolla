import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { crearCalendario } from './services/calendar.js';
import { crearExtractor } from './services/extraction.js';
import { iniciarTrabajos } from './services/jobs.js';
import { GeneradorPdf } from './services/pdf.js';
import { crearWhatsApp } from './services/whatsapp.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);

// El primer dueño se instala con el servidor (no hay página de arranque).
if (config.OWNER_EMAIL) {
  await db.query(
    `insert into usuarios (email, rol) values (lower($1), 'dueno') on conflict (email) do update set rol = 'dueno', activo = true`,
    [config.OWNER_EMAIL],
  );
}

// Una lectura con IA que estaba corriendo cuando se apagó el servidor ya no va a terminar.
await db.query("update conversaciones set lectura_inicio = null, lectura_error = 'Se reinició el servidor mientras se leía el chat. Vuelve a intentarlo.' where lectura_inicio is not null");

const calendario = crearCalendario(config);
const pdf = new GeneradorPdf(config.STORAGE_DIR);

// Los trabajos se inician después de crear la app para usar su registro.
let encolar: (id: string) => Promise<void> = async () => undefined;

const ctx: Ctx = {
  config,
  db,
  extractor: crearExtractor(config),
  calendario,
  whatsapp: crearWhatsApp(config),
  pdf,
  sincronizarCalendario: (id) => encolar(id),
};

const app = await buildApp(ctx);
const trabajos = await iniciarTrabajos(config, db, calendario, app.log);
encolar = (id) => trabajos.encolarCalendario(id);

await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`Recibí ${signal}, cerrando…`);
    await app.close();
    await trabajos.detener();
    await pdf.cerrar();
    await db.end();
    process.exit(0);
  });
}
