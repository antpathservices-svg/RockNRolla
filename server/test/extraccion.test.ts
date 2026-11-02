/**
 * Proveedores del modelo (Claude y OpenRouter) con un fetch falso: forma de la petición,
 * lectura de la respuesta y paso al proveedor de respaldo. No necesita base de datos.
 */
import { describe, expect, it } from 'vitest';
import type { Extraccion } from '@rnr/shared';
import { loadConfig } from '../src/config.js';
import { crearExtractor, leerJson } from '../src/services/extraction.js';

const BASE = { DATABASE_URL: 'postgres://x', SESSION_SECRET: 'a'.repeat(64), PUBLIC_URL: 'https://rnr.antpath.mx' };
const config = (extra: Record<string, string>) => loadConfig({ ...BASE, ...extra } as NodeJS.ProcessEnv);

const EXT: Extraccion = {
  resumen: 'Un pastel.', cliente_nombre: 'Ana', fecha_entrega: '2026-11-20', hora_desde: '', hora_hasta: '',
  tipo_entrega: '', direccion: '', envio: '', anticipo_recibido: false, pasteles: [], dudas: [], fuentes: [],
};
const MSGS = [{ indice: 0, rol: 'cliente' as const, enviado: '2026-10-21T14:34:00.000Z', texto: 'Hola', tipo: 'texto' }];

interface Llamada { url: string; headers: Record<string, string>; body: any }

function fetchFalso(respuestas: Record<string, Array<{ status: number; json?: unknown; text?: string }>>) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const host = new URL(url).host;
    const r = respuestas[host].shift()!;
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status, headers: { 'retry-after': '0' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

const okClaude = { status: 200, json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(EXT) }] } };
const okOpenRouter = (texto = JSON.stringify(EXT)) => ({ status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: texto } }] } });

describe('OpenRouter', () => {
  it('manda el esquema estricto y pide proveedores que no guardan datos', async () => {
    const { f, llamadas } = fetchFalso({ 'openrouter.ai': [okOpenRouter()] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'sk-or-x' }), f, () => undefined);
    expect(ex.proveedores).toEqual([{ nombre: 'openrouter', modelo: 'anthropic/claude-sonnet-5.5' }]);
    expect(await ex.extraer(MSGS)).toEqual(EXT);
    const { url, headers, body } = llamadas[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk-or-x');
    expect(headers['HTTP-Referer']).toBe('https://rnr.antpath.mx');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    expect(body.messages[0].role).toBe('system');
    // Hora de Monterrey en la transcripción
    expect(body.messages[1].content).toContain('[0] 2026-10-21 08:34 CLIENTE: Hola');
  });

  it('acepta el JSON envuelto en ```json', () => {
    expect(leerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('avisa claro cuando no hay créditos', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [{ status: 402, json: { error: { code: 402, message: 'Insufficient credits' } } }] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('no tiene créditos');
  });

  it('detecta un error que llega con estado 200', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [{ status: 200, json: { error: { code: 502, message: 'Provider down' } } }] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('Provider down');
  });
});

describe('Claude con OpenRouter de respaldo', () => {
  it('usa Claude primero si están las dos claves', async () => {
    const { f, llamadas } = fetchFalso({ 'api.anthropic.com': [okClaude], 'openrouter.ai': [] });
    const ex = crearExtractor(config({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o' }), f, () => undefined);
    expect(ex.proveedores.map((p) => p.nombre)).toEqual(['claude', 'openrouter']);
    await ex.extraer(MSGS);
    expect(llamadas.map((l) => new URL(l.url).host)).toEqual(['api.anthropic.com']);
  });

  it('pasa a OpenRouter si Claude llega al tope de gasto', async () => {
    const avisos: string[] = [];
    const { f, llamadas } = fetchFalso({
      'api.anthropic.com': [{ status: 429, text: '{"error":{"details":{"error_code":"enforced_spend_limit_reached"}}}' }],
      'openrouter.ai': [okOpenRouter()],
    });
    const ex = crearExtractor(config({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o' }), f, (m) => avisos.push(m));
    expect(await ex.extraer(MSGS)).toEqual(EXT);
    expect(llamadas.map((l) => new URL(l.url).host)).toEqual(['api.anthropic.com', 'openrouter.ai']);
    expect(avisos[0]).toContain('se intenta con openrouter');
  });

  it('pasa al respaldo si el principal devuelve JSON inválido', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [okOpenRouter('no es json')], 'api.anthropic.com': [okClaude] });
    const ex = crearExtractor(config({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o', LLM_PROVIDER: 'openrouter' }), f, () => undefined);
    expect(ex.proveedores.map((p) => p.nombre)).toEqual(['openrouter', 'claude']);
    expect(await ex.extraer(MSGS)).toEqual(EXT);
  });

  it('sin respaldo, el error del formato es claro', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [okOpenRouter('{"a":1}')] });
    const ex = crearExtractor(config({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o', LLM_PROVIDER: 'openrouter', LLM_FALLBACK: 'false' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('formato inesperado');
  });

  it('sin ninguna clave no está disponible', async () => {
    const ex = crearExtractor(config({}), fetch, () => undefined);
    expect(ex.disponible).toBe(false);
    await expect(ex.extraer(MSGS)).rejects.toThrow('ANTHROPIC_API_KEY u OPENROUTER_API_KEY');
  });
});

describe('OpenRouter gratuito', () => {
  it('con OPENROUTER_DATA_COLLECTION=allow lo manda así', async () => {
    const { f, llamadas } = fetchFalso({ 'openrouter.ai': [okOpenRouter()] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openrouter/free', OPENROUTER_DATA_COLLECTION: 'allow' }), f, () => undefined);
    await ex.extraer(MSGS);
    expect(llamadas[0].body.model).toBe('openrouter/free');
    expect(llamadas[0].body.provider).toEqual({ require_parameters: true, data_collection: 'allow' });
  });

  it('explica cuando ningún proveedor cumple la política de datos', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [{ status: 404, json: { error: { code: 404, message: 'No endpoints found matching your data policy' } } }] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openrouter/free' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('OPENROUTER_DATA_COLLECTION=allow');
  });

  it('explica el límite diario de modelos gratuitos', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [{ status: 429, json: { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } } }] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openrouter/free', OPENROUTER_DATA_COLLECTION: 'allow' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('límite diario');
  });
});

describe('OpenRouter con enrutador (openrouter/free)', () => {
  const sinEndpoint = { status: 404, json: { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } } };
  const cfg = () => config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openrouter/free', OPENROUTER_DATA_COLLECTION: 'allow' });

  it('si no acepta require_parameters, reintenta sin él y recuerda el modo', async () => {
    const { f, llamadas } = fetchFalso({ 'openrouter.ai': [sinEndpoint, okOpenRouter(), okOpenRouter()] });
    const ex = crearExtractor(cfg(), f, () => undefined);
    expect(await ex.extraer(MSGS)).toEqual(EXT);
    expect(llamadas[0].body.provider.require_parameters).toBe(true);
    expect(llamadas[1].body.provider).toEqual({ data_collection: 'allow' });
    expect(llamadas[1].body.messages[0].content).toContain('Responde SOLO con un objeto JSON');
    await ex.extraer(MSGS); // segunda vez empieza en el modo que funcionó
    expect(llamadas).toHaveLength(3);
    expect(llamadas[2].body.provider).toEqual({ data_collection: 'allow' });
  });

  it('llega hasta pedir el JSON solo en el texto y lo extrae aunque traiga texto alrededor', async () => {
    const { f, llamadas } = fetchFalso({ 'openrouter.ai': [sinEndpoint, sinEndpoint, sinEndpoint, okOpenRouter(`Claro, aquí está:\n${JSON.stringify(EXT)}\nSaludos`)] });
    const ex = crearExtractor(cfg(), f, () => undefined);
    expect(await ex.extraer(MSGS)).toEqual(EXT);
    expect(llamadas[2].body.response_format).toEqual({ type: 'json_object' });
    expect(llamadas[3].body.response_format).toBeUndefined();
  });

  it('no confunde ese 404 con la política de datos', async () => {
    const { f } = fetchFalso({ 'openrouter.ai': [sinEndpoint, sinEndpoint, sinEndpoint, sinEndpoint] });
    const ex = crearExtractor(config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openrouter/free' }), f, () => undefined);
    await expect(ex.extraer(MSGS)).rejects.toThrow('requested parameters');
  });
});
