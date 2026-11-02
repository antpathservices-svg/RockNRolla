import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import type { Ctx, SesionUsuario } from '../context.js';
import { registrar } from '../services/audit.js';

/**
 * Inicio de sesión con Google: solo nombre, correo y perfil (openid email profile).
 * Con esos permisos la app no necesita revisión de Google ni vence a los 7 días.
 * Solo entran los correos dados de alta en la tabla usuarios.
 */

export function usuarioActual(req: FastifyRequest): SesionUsuario | null {
  return req.session.get('user') ?? null;
}

export function requiereUsuario(rol?: 'dueno') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const u = usuarioActual(req);
    if (!u) return reply.code(401).send({ error: 'Inicia sesión para continuar.' });
    if (rol && u.rol !== rol) return reply.code(403).send({ error: 'Solo el dueño puede hacer esto.' });
  };
}

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { config, db } = ctx;
  const redirectUri = `${config.PUBLIC_URL}/auth/google/callback`;
  const client = config.GOOGLE_CLIENT_ID ? new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, redirectUri) : null;

  async function iniciar(req: FastifyRequest, email: string): Promise<SesionUsuario | null> {
    const { rows } = await db.query('select email, nombre, rol from usuarios where lower(email) = lower($1) and activo', [email]);
    if (!rows[0]) return null;
    const u: SesionUsuario = { email: rows[0].email, nombre: rows[0].nombre, rol: rows[0].rol };
    req.session.set('user', u);
    await registrar(db, 'sesion', null, 'inicio', u.email);
    return u;
  }

  app.get('/auth/google', async (req, reply) => {
    if (!client) return reply.code(503).send('El inicio de sesión con Google no está configurado.');
    const state = randomBytes(16).toString('hex');
    req.session.set('oauthState', state);
    const url = client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' });
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/google/callback', async (req, reply) => {
    if (!client) return reply.code(503).send('El inicio de sesión con Google no está configurado.');
    const { code, state, error } = req.query;
    const esperado = req.session.get('oauthState');
    req.session.set('oauthState', undefined as unknown as string);
    if (error || !code || !state || state !== esperado) return reply.redirect('/entrar?error=cancelado');
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: config.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) return reply.redirect('/entrar?error=correo');
    const u = await iniciar(req, payload.email);
    if (!u) return reply.redirect('/entrar?error=sin_acceso');
    if (!u.nombre && payload.name) await db.query('update usuarios set nombre = $2 where lower(email) = lower($1)', [u.email, payload.name]);
    return reply.redirect('/');
  });

  // Solo en desarrollo: entrar sin Google con el correo de DEV_LOGIN_EMAIL.
  if (config.NODE_ENV !== 'production' && config.DEV_LOGIN_EMAIL) {
    app.post('/auth/dev', async (req, reply) => {
      const u = await iniciar(req, config.DEV_LOGIN_EMAIL!);
      if (!u) return reply.code(403).send({ error: 'DEV_LOGIN_EMAIL no está en la tabla de usuarios.' });
      return u;
    });
  }

  app.post('/auth/salir', async (req) => {
    req.session.delete();
    return { ok: true };
  });

  app.get('/api/yo', async (req, reply) => {
    const u = usuarioActual(req);
    if (!u) {
      return reply.code(401).send({
        error: 'Sin sesión',
        google: Boolean(client),
        dev: config.NODE_ENV !== 'production' && Boolean(config.DEV_LOGIN_EMAIL),
      });
    }
    return u;
  });
}
