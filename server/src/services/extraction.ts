import { z } from 'zod';
import type { Extraccion } from '@rnr/shared';
import type { Config } from '../config.js';

/**
 * Resumen y extracción del pedido con Claude (ADR-05).
 * - Salida estructurada con un esquema JSON: siempre la misma forma.
 * - Todos los campos son texto obligatorio; "" significa "no está en el chat".
 *   Así el esquema no usa uniones ni campos opcionales, que tienen límite en la API.
 * - Las reglas de montos y fechas se validan en el servidor, no en el esquema.
 * - El chat llega con los datos bancarios ya ocultos (ADR-06).
 */

export interface MensajeParaModelo {
  indice: number;
  rol: 'cliente' | 'negocio' | 'sistema';
  enviado: string;
  texto: string;
  tipo: string;
}

const str = { type: 'string' } as const;

const PASTEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tema', 'festejado', 'edad', 'personas', 'tipo', 'pan', 'relleno', 'cubierta', 'decoracion', 'extras', 'precio'],
  properties: {
    tema: str, festejado: str, edad: str, personas: str, tipo: str, pan: str, relleno: str,
    cubierta: str, decoracion: str, extras: { type: 'array', items: str }, precio: str,
  },
} as const;

export const EXTRACCION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'resumen', 'cliente_nombre', 'fecha_entrega', 'hora_desde', 'hora_hasta', 'tipo_entrega',
    'direccion', 'envio', 'anticipo_recibido', 'pasteles', 'dudas', 'fuentes',
  ],
  properties: {
    resumen: str,
    cliente_nombre: str,
    fecha_entrega: str,
    hora_desde: str,
    hora_hasta: str,
    tipo_entrega: { type: 'string', enum: ['domicilio', 'recoger', ''] },
    direccion: str,
    envio: str,
    anticipo_recibido: { type: 'boolean' },
    pasteles: { type: 'array', items: PASTEL_SCHEMA },
    dudas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['campo', 'motivo', 'mensaje_indice'],
        properties: { campo: str, motivo: str, mensaje_indice: { type: 'integer' } },
      },
    },
    fuentes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['campo', 'mensaje_indice'],
        properties: { campo: str, mensaje_indice: { type: 'integer' } },
      },
    },
  },
} as const;

const zPastel = z.object({
  tema: z.string(), festejado: z.string(), edad: z.string(), personas: z.string(), tipo: z.string(),
  pan: z.string(), relleno: z.string(), cubierta: z.string(), decoracion: z.string(),
  extras: z.array(z.string()), precio: z.string(),
});

export const zExtraccion = z.object({
  resumen: z.string(),
  cliente_nombre: z.string(),
  fecha_entrega: z.string(),
  hora_desde: z.string(),
  hora_hasta: z.string(),
  tipo_entrega: z.string(),
  direccion: z.string(),
  envio: z.string(),
  anticipo_recibido: z.boolean(),
  pasteles: z.array(zPastel),
  dudas: z.array(z.object({ campo: z.string(), motivo: z.string(), mensaje_indice: z.number().int() })),
  fuentes: z.array(z.object({ campo: z.string(), mensaje_indice: z.number().int() })),
});

export const SYSTEM_PROMPT = `Eres asistente de Rock N Rolla Cakes, una pastelería de Monterrey que vende pasteles personalizados por WhatsApp.
Recibes un chat entre el negocio y un cliente. Tu trabajo:
1. Escribir un resumen en español de México, de 2 a 4 frases, con lo que el cliente pidió y en qué quedaron.
2. Extraer los datos del pedido.

Reglas:
- No inventes nada. Si un dato no está en el chat, deja el texto vacío ("").
- Si un dato es ambiguo (por ejemplo, dos precios y no queda claro cuál es de qué pastel), llénalo con tu mejor lectura y agrega una entrada en "dudas" con el campo y el motivo.
- Un pedido puede tener varios pasteles: uno por elemento de "pasteles".
- "fecha_entrega" en formato AAAA-MM-DD. Si el cliente no dice el año, usa el próximo que tenga sentido con la fecha de los mensajes.
- "hora_desde" y "hora_hasta" en 24 horas, HH:MM, para la entrega (no la hora de la fiesta, salvo que no haya otra).
- "precio" y "envio" solo con números, sin signo de pesos ni comas (ej. "1800").
- "personas" solo con el número.
- "anticipo_recibido" es true solo si el cliente mandó comprobante o el negocio confirmó el pago.
- Ignora los mensajes automáticos del negocio (plantillas de pago, avisos de ausencia) como acuerdos.
- En "fuentes" indica, para cada campo que llenaste, el número de mensaje [n] de donde salió. Usa nombres de campo como "fecha_entrega", "direccion" o "pasteles[0].precio".
- Los datos bancarios aparecen como [dato bancario oculto]; no los menciones.`;

export function construirTranscripcion(mensajes: MensajeParaModelo[], hoyIso: string): string {
  const lineas = mensajes
    .filter((m) => m.rol !== 'sistema')
    .map((m) => {
      const quien = m.rol === 'cliente' ? 'CLIENTE' : 'NEGOCIO';
      const contenido = m.tipo === 'texto' ? m.texto : `[${m.tipo}${m.texto ? `: ${m.texto}` : ''}]`;
      // Hora de Monterrey (UTC-06:00), como la ve el negocio
      const local = new Date(Date.parse(m.enviado) - 6 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
      return `[${m.indice}] ${local} ${quien}: ${contenido}`;
    });
  return `Fecha de hoy: ${hoyIso}\n\nChat:\n${lineas.join('\n')}`;
}

export interface Extractor {
  extraer(mensajes: MensajeParaModelo[]): Promise<Extraccion>;
  probar(): Promise<void>;
  readonly disponible: boolean;
}

export class ExtractorNoDisponible extends Error {}

export function crearExtractor(config: Config, fetchImpl: typeof fetch = fetch): Extractor {
  const key = config.ANTHROPIC_API_KEY;

  async function llamar(body: unknown): Promise<any> {
    if (!key) throw new ExtractorNoDisponible('Falta ANTHROPIC_API_KEY en el servidor.');
    let intento = 0;
    for (;;) {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return res.json();
      const text = await res.text();
      // Tope mensual: no tiene caso reintentar (ver Referencias de APIs).
      if (res.status === 429 && text.includes('enforced_spend_limit_reached')) {
        throw new Error('Se llegó al tope mensual de gasto de Claude. Avísale a Antpath.');
      }
      if ((res.status === 429 || res.status >= 500) && intento < 3) {
        const espera = Number(res.headers.get('retry-after')) || 2 ** intento;
        await new Promise((r) => setTimeout(r, Math.min(espera, 30) * 1000));
        intento++;
        continue;
      }
      throw new Error(`Claude respondió ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  return {
    disponible: Boolean(key),
    async probar() {
      await llamar({ model: config.CLAUDE_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] });
    },
    async extraer(mensajes) {
      const hoy = new Date().toISOString().slice(0, 10);
      const data = await llamar({
        model: config.CLAUDE_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: construirTranscripcion(mensajes, hoy) }],
        output_config: { format: { type: 'json_schema', schema: EXTRACCION_SCHEMA } },
      });
      if (data.stop_reason === 'refusal') throw new Error('El modelo no pudo procesar este chat.');
      if (data.stop_reason === 'max_tokens') throw new Error('El chat es demasiado largo; elige un tramo más corto.');
      const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text;
      if (!text) throw new Error('El modelo no devolvió texto.');
      return zExtraccion.parse(JSON.parse(text));
    },
  };
}
