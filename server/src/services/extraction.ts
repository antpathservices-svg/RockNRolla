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

/** Un mensaje larguísimo (p. ej. un texto pegado) no debe comerse el espacio del modelo. */
const MAX_CARACTERES_MENSAJE = 1500;

/**
 * Líneas del chat para el modelo: un encabezado por día y solo la hora en cada mensaje
 * (ahorra ~15 caracteres por línea). Hora de Monterrey (UTC-06:00), como la ve el negocio.
 */
export function lineasChat(mensajes: MensajeParaModelo[]): string[] {
  const lineas: string[] = [];
  let dia = '';
  for (const m of mensajes) {
    if (m.rol === 'sistema') continue;
    const local = new Date(Date.parse(m.enviado) - 6 * 3600_000).toISOString();
    if (local.slice(0, 10) !== dia) {
      dia = local.slice(0, 10);
      lineas.push(`— ${dia} —`);
    }
    const quien = m.rol === 'cliente' ? 'CLIENTE' : 'NEGOCIO';
    let contenido = m.tipo === 'texto' ? m.texto : `[${m.tipo}${m.texto ? `: ${m.texto}` : ''}]`;
    if (contenido.length > MAX_CARACTERES_MENSAJE) contenido = `${contenido.slice(0, MAX_CARACTERES_MENSAJE)}… (recortado)`;
    lineas.push(`[${m.indice}] ${local.slice(11, 16)} ${quien}: ${contenido}`);
  }
  return lineas;
}

export function construirTranscripcion(mensajes: MensajeParaModelo[], hoyIso: string): string {
  return `Fecha de hoy: ${hoyIso}\n\nChat:\n${lineasChat(mensajes).join('\n')}`;
}

/**
 * Parte el chat en tramos de a lo más `max` caracteres, sin cortar mensajes. El último tramo
 * (lo más reciente, donde suele cerrarse el pedido) se llena primero, de atrás hacia adelante.
 * Cada tramo repite el encabezado de su día para no perder la fecha.
 */
export function partirChat(lineas: string[], max: number): string[][] {
  const partes: string[][] = [];
  let actual: string[] = [];
  let tam = 0;
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i];
    if (tam + l.length + 1 > max && actual.some((x) => !x.startsWith('— '))) {
      partes.unshift(actual);
      actual = [];
      tam = 0;
    }
    actual.unshift(l);
    tam += l.length + 1;
  }
  if (actual.length) partes.unshift(actual);
  // Encabezado de día al inicio de cada tramo
  let dia = '';
  return partes.map((parte) => {
    const conDia = parte[0]?.startsWith('— ') || !dia ? parte : [dia, ...parte];
    for (const l of parte) if (l.startsWith('— ')) dia = l;
    return conDia;
  });
}

const NOTAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notas'],
  properties: { notas: str },
} as const;

export const NOTAS_PROMPT = `Eres asistente de Rock N Rolla Cakes, una pastelería de Monterrey que vende pasteles personalizados por WhatsApp.
Recibes UNA PARTE de un chat largo entre el negocio y un cliente. Otra lectura usará tus notas junto con la parte más reciente del chat para armar el pedido.
Escribe notas breves en español, en viñetas que empiecen con "- ", con todo lo que sirva para el pedido: nombre del cliente, festejado y edad, fecha y hora de entrega o de la fiesta, entrega a domicilio o recoger y dirección, cada pastel (tema, personas, tipo o pisos, pan, relleno, cubierta, decoración, extras), precios, envío, descuentos, pagos o anticipos, cambios de opinión y acuerdos.
Reglas:
- No inventes nada; si algo cambió dentro de esta parte, anota el valor final y que cambió.
- Termina cada viñeta con el número de mensaje de donde salió, así: [123].
- Omite saludos, plantillas automáticas y charla que no sirva para el pedido.
- Máximo 30 viñetas. Si no hay nada útil, escribe "- Sin datos del pedido en esta parte".
- Los datos bancarios aparecen como [dato bancario oculto]; no los menciones.`;

const NOTA_PARTES = `
El chat puede llegar en dos bloques: "Notas de las partes anteriores", escritas por otra lectura a partir de los mensajes viejos, y "Parte más reciente del chat", con los mensajes tal cual.
- Usa las notas como si fueran el chat anterior. Si un dato de la parte reciente contradice las notas, gana lo más reciente.
- En "fuentes" y "dudas" puedes usar los números de mensaje [n] que citan las notas.`;

export type NombreProveedor = 'claude' | 'openrouter';

/** Lo que se le pide al modelo: instrucciones, texto y la forma del JSON de respuesta. */
interface Peticion {
  system: string;
  usuario: string;
  schema: object;
  nombreSchema: string;
}

/** Un proveedor de modelo: recibe una petición y devuelve el JSON como texto. */
interface Proveedor {
  nombre: NombreProveedor;
  modelo: string;
  generar(pet: Peticion): Promise<string>;
  probar(): Promise<void>;
}

export interface Extractor {
  /** Usa el proveedor principal y, si falla, el de respaldo (si está configurado). */
  extraer(mensajes: MensajeParaModelo[]): Promise<Extraccion>;
  /** Prueba un proveedor; sin nombre, el principal. */
  probar(nombre?: NombreProveedor): Promise<void>;
  readonly disponible: boolean;
  /** Proveedores configurados, en orden de uso. */
  readonly proveedores: ReadonlyArray<{ nombre: NombreProveedor; modelo: string }>;
}

export class ExtractorNoDisponible extends Error {}

const espera = (seg: number) => new Promise((r) => setTimeout(r, Math.min(seg, 30) * 1000));

/**
 * POST con reintentos ante 408, 429 y 5xx (respeta Retry-After). `fatal` decide qué respuestas
 * no vale la pena reintentar, como un tope de gasto o falta de créditos.
 */
async function postConReintentos(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  etiqueta: string,
  fatal: (status: number, text: string) => string | null,
  timeoutSeg = 240,
): Promise<any> {
  for (let intento = 0; ; intento++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutSeg * 1000),
      });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') {
        throw new Error(`${etiqueta} tardó más de ${timeoutSeg} s en responder. Intenta de nuevo; si se repite, usa un modelo más rápido.`);
      }
      throw e;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    const mensajeFatal = fatal(res.status, text);
    if (mensajeFatal) throw new Error(mensajeFatal);
    if ((res.status === 408 || res.status === 429 || res.status >= 500) && intento < 2) {
      await espera(Number(res.headers.get('retry-after')) || 2 ** intento);
      continue;
    }
    throw new Error(`${etiqueta} respondió ${res.status}: ${text.slice(0, 300)}`);
  }
}

function proveedorClaude(config: Config, fetchImpl: typeof fetch): Proveedor | null {
  const key = config.ANTHROPIC_API_KEY;
  if (!key) return null;
  const llamar = (body: unknown) =>
    postConReintentos(fetchImpl, 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, 'Claude',
      (status, text) => (status === 429 && text.includes('enforced_spend_limit_reached') ? 'Se llegó al tope mensual de gasto de Claude. Avísale a Antpath.' : null),
      config.LLM_TIMEOUT_SEG);
  return {
    nombre: 'claude',
    modelo: config.CLAUDE_MODEL,
    async probar() {
      await llamar({ model: config.CLAUDE_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] });
    },
    async generar(pet) {
      const data = await llamar({
        model: config.CLAUDE_MODEL,
        max_tokens: 16000,
        system: pet.system,
        messages: [{ role: 'user', content: pet.usuario }],
        output_config: { format: { type: 'json_schema', schema: pet.schema } },
      });
      if (data.stop_reason === 'refusal') throw new Error('El modelo no pudo procesar este chat.');
      if (data.stop_reason === 'max_tokens') throw new RespuestaCortada('La respuesta de Claude se cortó antes de terminar. Intenta de nuevo.');
      const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text;
      if (!text) throw new Error('Claude no devolvió texto.');
      return text;
    },
  };
}

/**
 * OpenRouter: API compatible con OpenAI que da acceso a muchos modelos con una sola clave.
 * - Salida estructurada con response_format json_schema (strict).
 * - provider.require_parameters: solo usa endpoints que soportan la salida estructurada.
 * - provider.data_collection = deny: solo proveedores que no guardan ni entrenan con los datos,
 *   porque los chats traen datos personales de clientes.
 */
function proveedorOpenRouter(config: Config, fetchImpl: typeof fetch): Proveedor | null {
  const key = config.OPENROUTER_API_KEY;
  if (!key) return null;
  const headers = { authorization: `Bearer ${key}`, 'HTTP-Referer': config.PUBLIC_URL, 'X-Title': 'Rock N Rolla Pedidos' };
  const llamar = (body: unknown) =>
    postConReintentos(fetchImpl, 'https://openrouter.ai/api/v1/chat/completions', headers, body, 'OpenRouter', (status, text) =>
      status === 402 ? 'La cuenta de OpenRouter no tiene créditos. Recárgala en openrouter.ai.'
        : status === 429 && /free-models-per-day|per-day/i.test(text)
          ? 'Se acabó el límite diario de modelos gratuitos de OpenRouter (50 al día; 1,000 con al menos 10 créditos comprados).'
        : status === 401 ? 'La clave de OpenRouter no es válida o está desactivada.'
          : (status === 404 || status === 503) && dataCollection === 'deny' && /data policy|no available provider/i.test(text) && !/requested parameters/i.test(text)
            ? `Ningún proveedor de ${config.OPENROUTER_MODEL} cumple con no guardar los chats. Usa un modelo de pago o, solo para pruebas, OPENROUTER_DATA_COLLECTION=allow.`
            : /context length|context_length|too many tokens|maximum context|prompt is too long/i.test(text)
              ? `El chat no cabe en ${config.OPENROUTER_MODEL}. Baja LLM_TRAMO_CARACTERES para leerlo en partes más chicas, o usa un modelo con más contexto.`
              : null,
      config.LLM_TIMEOUT_SEG);
  // Los modelos gratuitos (p. ej. openrouter/free) casi siempre usan proveedores que guardan o
  // entrenan con los datos: solo funcionan con OPENROUTER_DATA_COLLECTION=allow.
  const dataCollection = config.OPENROUTER_DATA_COLLECTION;
  const proveedor = { require_parameters: true, data_collection: dataCollection };
  let modoInicial = 0;
  return {
    nombre: 'openrouter',
    modelo: config.OPENROUTER_MODEL,
    async probar() {
      const data = await llamar({ model: config.OPENROUTER_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }], provider: { data_collection: dataCollection } });
      if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? 'error desconocido'}`);
    },
    async generar(pet) {
      const MODOS = modos(pet);
      // Se empieza por el modo más estricto. Si OpenRouter dice que ningún endpoint acepta esos
      // parámetros (pasa con enrutadores como openrouter/free), se baja de modo; la respuesta
      // se valida igual en el servidor con el esquema. El modo que funcionó se recuerda.
      for (let i = modoInicial; i < MODOS.length; i++) {
        const modo = MODOS[i];
        // Los modelos de razonamiento gastan parte del límite pensando antes de responder.
        // Si la respuesta se corta, se reintenta una vez con el doble de espacio.
        for (let maxTokens = config.OPENROUTER_MAX_TOKENS; ; maxTokens *= 2) {
          try {
            const data = await llamar({
              model: config.OPENROUTER_MODEL,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: modo.esquemaEnPrompt ? `${pet.system}\n\n${instruccionJson(pet.schema)}` : pet.system },
                { role: 'user', content: pet.usuario },
              ],
              ...(modo.responseFormat ? { response_format: modo.responseFormat } : {}),
              // Razonar poco y no devolver el razonamiento. No se manda en el modo estricto
              // con require_parameters, porque descartaría los modelos que no razonan.
              ...(modo.requireParameters ? {} : { reasoning: { effort: 'low', exclude: true } }),
              provider: modo.requireParameters ? proveedor : { data_collection: dataCollection },
            });
            modoInicial = i;
            return leerRespuesta(data);
          } catch (e) {
            if (e instanceof RespuestaCortada && maxTokens < config.OPENROUTER_MAX_TOKENS * 2) continue;
            const sinEndpoint = /can handle the requested parameters/i.test((e as Error).message);
            if (!sinEndpoint || i === MODOS.length - 1) throw e;
            break;
          }
        }
      }
      throw new Error('OpenRouter no aceptó la petición.');
    },
  };
}

const instruccionJson = (schema: object) =>
  `Responde SOLO con un objeto JSON válido, sin texto antes ni después y sin bloques de código, que cumpla este esquema JSON:\n${JSON.stringify(schema)}`;

/** Modos de pedir el JSON a OpenRouter, del más estricto al más flexible. */
function modos(pet: Peticion): Array<{ responseFormat: unknown; requireParameters: boolean; esquemaEnPrompt: boolean }> {
  const estricto = { type: 'json_schema', json_schema: { name: pet.nombreSchema, strict: true, schema: pet.schema } };
  return [
    { responseFormat: estricto, requireParameters: true, esquemaEnPrompt: false },
    { responseFormat: estricto, requireParameters: false, esquemaEnPrompt: true },
    { responseFormat: { type: 'json_object' }, requireParameters: false, esquemaEnPrompt: true },
    { responseFormat: null, requireParameters: false, esquemaEnPrompt: true },
  ];
}

/** La respuesta llegó incompleta porque se acabó el límite de tokens. */
export class RespuestaCortada extends Error {}

function leerRespuesta(data: any): string {
  // Un error durante la generación puede llegar con estado 200
  if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? 'error desconocido'}`);
  const choice = data.choices?.[0];
  if (choice?.error) throw new Error(`OpenRouter: ${choice.error.message ?? 'error del modelo'}`);
  if (choice?.finish_reason === 'length') {
    const razonamiento = data.usage?.completion_tokens_details?.reasoning_tokens;
    throw new RespuestaCortada(
      `La respuesta del modelo (${data.model ?? 'OpenRouter'}) se cortó antes de terminar` +
        (razonamiento ? `: usó ${razonamiento} tokens razonando.` : '.') +
        ' Intenta de nuevo, sube OPENROUTER_MAX_TOKENS o usa un modelo fijo en lugar de openrouter/free.',
    );
  }
  if (choice?.finish_reason === 'content_filter') throw new Error('El modelo no pudo procesar este chat.');
  const text: unknown = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenRouter no devolvió texto.');
  return text;
}

/** Algunos modelos envuelven el JSON en ```json … ```; se quita antes de leerlo. */
export function leerJson(text: string): unknown {
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(limpio);
  } catch (e) {
    // Modelos sin salida estructurada a veces agregan texto alrededor: se toma el objeto JSON
    const i = limpio.indexOf('{');
    const j = limpio.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(limpio.slice(i, j + 1));
    throw e;
  }
}

export function crearExtractor(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  log: (msg: string) => void = (m) => console.warn(m),
): Extractor {
  const disponibles = [proveedorClaude(config, fetchImpl), proveedorOpenRouter(config, fetchImpl)].filter((p): p is Proveedor => p !== null);
  // Principal: el que diga LLM_PROVIDER; si no se indica, Claude cuando hay clave.
  const principal = config.LLM_PROVIDER ?? disponibles[0]?.nombre;
  const orden = [...disponibles].sort((a, b) => Number(b.nombre === principal) - Number(a.nombre === principal));
  const lista = config.LLM_FALLBACK ? orden : orden.slice(0, 1);

  return {
    disponible: lista.length > 0,
    proveedores: lista.map((p) => ({ nombre: p.nombre, modelo: p.modelo })),
    async probar(nombre) {
      const p = nombre ? disponibles.find((x) => x.nombre === nombre) : lista[0];
      if (!p) throw new ExtractorNoDisponible(nombre ? `${nombre} no está configurado.` : 'No hay ningún modelo configurado.');
      await p.probar();
    },
    async extraer(mensajes) {
      if (lista.length === 0) throw new ExtractorNoDisponible('Falta ANTHROPIC_API_KEY u OPENROUTER_API_KEY en el servidor.');
      const hoy = new Date().toISOString().slice(0, 10);
      const partes = partirChat(lineasChat(mensajes), config.LLM_TRAMO_CARACTERES);
      let ultimoError: unknown;
      for (const p of lista) {
        try {
          if (partes.length <= 1) {
            const usuario = `Fecha de hoy: ${hoy}\n\nChat:\n${(partes[0] ?? []).join('\n')}`;
            return zExtraccion.parse(leerJson(await p.generar({ system: SYSTEM_PROMPT, usuario, schema: EXTRACCION_SCHEMA, nombreSchema: 'pedido' })));
          }
          // Chat largo: las partes viejas se vuelven notas (de dos en dos, para no saturar el
          // límite de peticiones) y la lectura final ve las notas más la parte reciente completa.
          const previas = partes.slice(0, -1);
          const notas: string[] = new Array(previas.length);
          for (let i = 0; i < previas.length; i += 2) {
            await Promise.all(previas.slice(i, i + 2).map(async (parte, k) => {
              const r = z.object({ notas: z.string() }).parse(leerJson(await p.generar({
                system: NOTAS_PROMPT,
                usuario: `Fecha de hoy: ${hoy}\n\nParte ${i + k + 1} de ${partes.length} del chat:\n${parte.join('\n')}`,
                schema: NOTAS_SCHEMA,
                nombreSchema: 'notas',
              })));
              notas[i + k] = r.notas.trim();
            }));
          }
          log(`Chat largo: ${mensajes.length} mensajes leídos en ${partes.length} partes con ${p.nombre}.`);
          const usuario = [
            `Fecha de hoy: ${hoy}`,
            'Notas de las partes anteriores del chat:',
            ...notas.map((n, i) => `Parte ${i + 1}:\n${n}`),
            `Parte más reciente del chat:\n${partes[partes.length - 1].join('\n')}`,
          ].join('\n\n');
          return zExtraccion.parse(leerJson(await p.generar({ system: `${SYSTEM_PROMPT}\n${NOTA_PARTES}`, usuario, schema: EXTRACCION_SCHEMA, nombreSchema: 'pedido' })));
        } catch (e) {
          ultimoError = e;
          const siguiente = lista[lista.indexOf(p) + 1];
          if (siguiente) log(`Extracción con ${p.nombre} falló (${(e as Error).message}); se intenta con ${siguiente.nombre}.`);
        }
      }
      if (ultimoError instanceof SyntaxError || ultimoError instanceof z.ZodError) {
        throw new Error('El modelo devolvió datos con un formato inesperado. Intenta de nuevo.');
      }
      throw ultimoError;
    },
  };
}
