import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { firmaValida, guardarWebhook } from '../services/whatsapp.js';

/**
 * Webhook de WhatsApp (ADR-02): verifica la firma, guarda el mensaje y responde 200 de inmediato.
 * Se registra en su propio contexto para leer el cuerpo crudo, que hace falta para la firma.
 */
export async function webhookRoutes(app: FastifyInstance, ctx: Ctx) {
  const { config, db } = ctx;

  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get<{ Querystring: Record<string, string> }>('/webhook/whatsapp', async (req, reply) => {
    const q = req.query;
    if (q['hub.mode'] === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge']);
    }
    return reply.code(403).send('Token de verificación incorrecto.');
  });

  app.post('/webhook/whatsapp', { config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.body as Buffer;
    if (!config.WHATSAPP_APP_SECRET) return reply.code(503).send();
    if (!firmaValida(config.WHATSAPP_APP_SECRET, raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      req.log.warn('Webhook con firma inválida');
      return reply.code(401).send();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.code(400).send();
    }
    try {
      await guardarWebhook(db, payload as Parameters<typeof guardarWebhook>[1]);
    } catch (e) {
      // Si no se pudo guardar, Meta lo reintenta: responder error.
      req.log.error(e, 'No se pudo guardar el webhook');
      return reply.code(500).send();
    }
    return reply.code(200).send();
  });
}
