import { createHmac, timingSafeEqual } from 'node:crypto';
import { maskBankData } from '@rnr/shared';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

/**
 * WhatsApp Cloud API (Meta).
 * - Webhook: verificación por GET con hub.challenge; cada POST trae la firma X-Hub-Signature-256.
 * - Meta reintenta hasta 36 h, así que llegan duplicados: el id del mensaje es único en la base (ADR-02).
 * - Respuestas libres solo dentro de las 24 h desde el último mensaje del cliente; fuera, plantilla.
 */

export function firmaValida(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(rawBody).digest();
  const recibido = Buffer.from(header.slice(7), 'hex');
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

interface WaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  document?: { id: string; filename?: string; caption?: string };
  audio?: { id: string };
  video?: { id: string; caption?: string };
}

interface WaPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: WaMessage[];
        // Coexistence: mensajes que la dueña manda desde la app Business.
        // Nombre del campo por confirmar con la documentación de Coexistence al dar de alta el número.
        message_echoes?: Array<WaMessage & { to: string }>;
      };
    }>;
  }>;
}

function contenido(m: WaMessage): { texto: string; tipo: string; mediaId: string | null; nombre: string | null } {
  switch (m.type) {
    case 'text':
      return { texto: m.text?.body ?? '', tipo: 'texto', mediaId: null, nombre: null };
    case 'image':
      return { texto: m.image?.caption ?? '', tipo: 'adjunto', mediaId: m.image?.id ?? null, nombre: 'foto' };
    case 'document':
      return { texto: m.document?.caption ?? '', tipo: 'adjunto', mediaId: m.document?.id ?? null, nombre: m.document?.filename ?? 'documento' };
    case 'audio':
      return { texto: '', tipo: 'adjunto', mediaId: m.audio?.id ?? null, nombre: 'audio' };
    case 'video':
      return { texto: m.video?.caption ?? '', tipo: 'adjunto', mediaId: m.video?.id ?? null, nombre: 'video' };
    default:
      return { texto: `[mensaje de tipo ${m.type}]`, tipo: 'texto', mediaId: null, nombre: null };
  }
}

/** Guarda los mensajes del webhook. Devuelve cuántos eran nuevos. */
export async function guardarWebhook(db: Db, payload: WaPayload): Promise<number> {
  let nuevos = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      const nombres = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      const lote: Array<{ m: WaMessage; waId: string; rol: 'cliente' | 'negocio' }> = [
        ...(v.messages ?? []).map((m) => ({ m, waId: m.from, rol: 'cliente' as const })),
        ...(v.message_echoes ?? []).map((m) => ({ m, waId: m.to, rol: 'negocio' as const })),
      ];
      for (const { m, waId, rol } of lote) {
        const enviado = new Date(Number(m.timestamp) * 1000);
        const conv = await db.query(
          `insert into conversaciones (origen, wa_id, cliente_telefono, cliente_nombre, ultimo_mensaje)
           values ('whatsapp', $1, $1, $2, $3)
           on conflict (wa_id) do update set
             ultimo_mensaje = greatest(conversaciones.ultimo_mensaje, excluded.ultimo_mensaje),
             cliente_nombre = coalesce(conversaciones.cliente_nombre, excluded.cliente_nombre)
           returning id`,
          [waId, nombres.get(waId) ?? null, enviado],
        );
        const c = contenido(m);
        const r = await db.query(
          `insert into mensajes (conversacion_id, indice, wa_message_id, rol, autor, texto, tipo, adjunto_nombre, adjunto_media_id, enviado)
           values ($1, (select coalesce(max(indice), -1) + 1 from mensajes where conversacion_id = $1), $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (wa_message_id) do nothing`,
          [conv.rows[0].id, m.id, rol, rol === 'cliente' ? nombres.get(waId) ?? waId : null, maskBankData(c.texto).text, c.tipo, c.nombre, c.mediaId, enviado],
        );
        nuevos += r.rowCount ?? 0;
      }
    }
  }
  return nuevos;
}

export interface WhatsApp {
  readonly disponible: boolean;
  enviarTexto(to: string, texto: string): Promise<void>;
  enviarDocumento(to: string, pdf: Buffer, nombre: string, caption?: string): Promise<void>;
  probar(): Promise<void>;
}

export function crearWhatsApp(config: Config, fetchImpl: typeof fetch = fetch): WhatsApp {
  const base = `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}`;
  const token = config.WHATSAPP_TOKEN;
  const phoneId = config.WHATSAPP_PHONE_NUMBER_ID;

  async function llamar(path: string, init: RequestInit): Promise<any> {
    if (!token || !phoneId) throw new Error('WhatsApp no está configurado.');
    const res = await fetchImpl(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) {
      if (text.includes('131047')) throw new Error('Pasaron más de 24 horas desde el último mensaje del cliente: hace falta una plantilla aprobada.');
      throw new Error(`WhatsApp respondió ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    disponible: Boolean(token && phoneId),
    async enviarTexto(to, texto) {
      await llamar(`/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
      });
    },
    async enviarDocumento(to, pdf, nombre, caption) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'application/pdf');
      form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), nombre);
      const media = await llamar(`/${phoneId}/media`, { method: 'POST', body: form });
      await llamar(`/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { id: media.id, filename: nombre, caption } }),
      });
    },
    async probar() {
      await llamar(`/${phoneId}?fields=display_phone_number`, { method: 'GET' });
    },
  };
}
