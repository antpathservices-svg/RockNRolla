import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Ctx } from './context.js';
import { calendarioRoutes } from './routes/calendario.js';
import { ajustesRoutes } from './routes/ajustes.js';
import { authRoutes } from './routes/auth.js';
import { conversacionesRoutes } from './routes/conversaciones.js';
import { pedidosRoutes } from './routes/pedidos.js';
import { publicoRoutes } from './routes/publico.js';
import { webhookRoutes } from './routes/webhook.js';
import { ErrorDeNegocio } from './services/orders.js';
import { MAX_IMAGEN } from './routes/pedidos.js';

const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true, // detrás de Traefik (Easypanel)
    bodyLimit: 3 * 1024 * 1024,
  });

  // Registros sin datos secretos
  app.log.info({ modelos: ctx.extractor.proveedores.map((p) => p.nombre), calendario: ctx.calendario.disponible, whatsapp: ctx.whatsapp.disponible }, 'Conexiones');

  await app.register(secureSession, {
    key: Buffer.from(config.SESSION_SECRET, 'hex'),
    cookieName: 'rnr_sesion',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // sesión larga: 30 días
    },
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGEN, files: 1 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos.', detalles: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (err instanceof ErrorDeNegocio) return reply.code(422).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Ocurrió un error. Intenta de nuevo.' : err.message });
  });

  app.get('/api/salud', async () => {
    await ctx.db.query('select 1');
    return { ok: true };
  });

  await app.register(async (s) => authRoutes(s, ctx));
  await app.register(async (s) => conversacionesRoutes(s, ctx));
  await app.register(async (s) => pedidosRoutes(s, ctx));
  await app.register(async (s) => ajustesRoutes(s, ctx));
  await app.register(async (s) => calendarioRoutes(s, ctx));
  await app.register(async (s) => publicoRoutes(s, ctx));
  await app.register(async (s) => webhookRoutes(s, ctx));

  // Panel web (React) compilado
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/auth/') && !req.url.startsWith('/webhook/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'No encontrado.' });
    });
  }

  return app;
}
