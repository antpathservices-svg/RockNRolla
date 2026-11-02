import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { has } from '../config.js';
import type { Ctx } from '../context.js';
import { registrar } from '../services/audit.js';
import { AJUSTES_INICIALES, AJUSTES_OPERADOR, getAjustes, setAjuste, type ClaveAjuste } from '../services/settings.js';
import { requiereUsuario, usuarioActual } from './auth.js';

const zLista = z.array(z.string().trim().min(1).max(120)).max(50);
const zTextoCorto = z.string().trim().max(500);

/** Validación de cada ajuste editable. */
const VALIDADORES: Record<ClaveAjuste, z.ZodTypeAny> = {
  nombre_negocio: z.string().trim().min(1).max(80),
  vigencia_dias: z.number().int().min(1).max(120),
  anticipo_pct: z.number().min(0).max(100),
  cuentas_cobro: zLista,
  origenes: zLista,
  formulario: z.object({
    tipos: zLista, panes: zLista, rellenos: zLista, extras: zLista,
    max_extras: z.number().int().min(1).max(20),
    aviso: zTextoCorto,
    aviso_privacidad_url: z.string().url().or(z.literal('')),
  }),
  nota: z.object({ subtitulo: zTextoCorto, contacto: z.array(zTextoCorto).max(4), agradecimiento: zTextoCorto, lema: zTextoCorto }),
  link_dias_validez: z.number().int().min(1).max(180),
  pausa_tramos_dias: z.number().int().min(1).max(60),
};

type EstadoConexion = 'conectado' | 'sin_configurar' | 'error' | 'modo_prueba';

export async function ajustesRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, config } = ctx;
  app.addHook('preHandler', requiereUsuario());

  app.get('/api/ajustes', async () => getAjustes(db));

  app.put('/api/ajustes', async (req, reply) => {
    const u = usuarioActual(req)!;
    const body = z.record(z.string(), z.unknown()).parse(req.body);
    const cambios: Partial<Record<ClaveAjuste, unknown>> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(k in AJUSTES_INICIALES)) return reply.code(400).send({ error: `Ajuste desconocido: ${k}` });
      const clave = k as ClaveAjuste;
      if (u.rol !== 'dueno' && !AJUSTES_OPERADOR.includes(clave)) return reply.code(403).send({ error: 'Solo el dueño puede cambiar este ajuste.' });
      cambios[clave] = VALIDADORES[clave].parse(v);
    }
    for (const [k, v] of Object.entries(cambios)) await setAjuste(db, k as ClaveAjuste, v, u.email);
    await registrar(db, 'ajustes', null, 'editado', u.email, { claves: Object.keys(cambios) });
    return getAjustes(db);
  });

  /** Estado de las conexiones. Nunca devuelve valores de las claves. */
  app.get('/api/conexiones', async () => {
    const ultimoRespaldo = await db
      .query<{ valor: string }>("select valor #>> '{}' as valor from ajustes where clave = 'ultimo_respaldo'")
      .then((r) => r.rows[0]?.valor ?? null)
      .catch(() => null);
    const estado = (ok: boolean): EstadoConexion => (ok ? 'conectado' : 'sin_configurar');
    return {
      whatsapp: { estado: has.whatsapp(config) ? 'conectado' : ('modo_prueba' as EstadoConexion), webhook: `${config.PUBLIC_URL}/webhook/whatsapp` },
      claude: { estado: estado(has.claude(config)), modelo: config.CLAUDE_MODEL },
      calendario: { estado: estado(has.calendar(config)), calendarioId: config.GOOGLE_CALENDAR_ID ? '(configurado)' : null },
      login: { estado: estado(has.googleLogin(config)) },
      ultimoRespaldo,
    };
  });

  app.post<{ Params: { nombre: string } }>('/api/conexiones/:nombre/probar', { preHandler: requiereUsuario('dueno') }, async (req, reply) => {
    const pruebas: Record<string, () => Promise<void>> = {
      claude: () => ctx.extractor.probar(),
      calendario: () => ctx.calendario.probar(),
      whatsapp: () => ctx.whatsapp.probar(),
    };
    const probar = pruebas[req.params.nombre];
    if (!probar) return reply.code(404).send({ error: 'Conexión desconocida.' });
    try {
      await probar();
      await registrar(db, 'conexion', req.params.nombre, 'prueba_ok', usuarioActual(req)!.email);
      return { ok: true };
    } catch (e) {
      await registrar(db, 'conexion', req.params.nombre, 'prueba_fallida', usuarioActual(req)!.email);
      return { ok: false, error: (e as Error).message };
    }
  });

  // ---- Usuarios (solo el dueño) ----
  app.get('/api/usuarios', { preHandler: requiereUsuario('dueno') }, async () => {
    const { rows } = await db.query('select id, email, nombre, rol, activo from usuarios order by rol, email');
    return rows;
  });

  app.post('/api/usuarios', { preHandler: requiereUsuario('dueno') }, async (req) => {
    const d = z.object({ email: z.string().email(), rol: z.enum(['dueno', 'operador']), nombre: z.string().max(80).optional() }).parse(req.body);
    await db.query(
      `insert into usuarios (email, rol, nombre) values (lower($1), $2, $3)
       on conflict (email) do update set rol = excluded.rol, activo = true`,
      [d.email, d.rol, d.nombre ?? null],
    );
    await registrar(db, 'usuario', d.email, 'acceso_dado', usuarioActual(req)!.email, { rol: d.rol });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/usuarios/:id', { preHandler: requiereUsuario('dueno') }, async (req, reply) => {
    const u = usuarioActual(req)!;
    const { rows } = await db.query('select email from usuarios where id = $1', [Number(req.params.id)]);
    if (!rows[0]) return reply.code(404).send({ error: 'No existe el usuario.' });
    if (rows[0].email === u.email) return reply.code(422).send({ error: 'No puedes quitarte el acceso a ti mismo.' });
    await db.query('update usuarios set activo = false where id = $1', [Number(req.params.id)]);
    await registrar(db, 'usuario', rows[0].email, 'acceso_quitado', u.email);
    return { ok: true };
  });
}
