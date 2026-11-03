import { describe, expect, it } from 'vitest';
import type { Pedido } from '@rnr/shared';
import { loadConfig } from '../src/config.js';
import { crearCalendario, eventoDesdePedido, leerLlave } from '../src/services/calendar.js';

const LLAVE = {
  type: 'service_account',
  client_email: 'rnr-calendario@proyecto.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
};

const cfg = (extra: Record<string, string>) =>
  loadConfig({ DATABASE_URL: 'postgres://x', SESSION_SECRET: 'a'.repeat(64), ...extra } as NodeJS.ProcessEnv);

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  id: 'p1', folio: '#0012_NOV', estado: 'aceptado', clienteNombre: 'Cliente Ejemplo', clienteTelefono: '8100000000',
  fechaEntrega: '2026-11-20', horaDesde: '16:00', horaHasta: null, tipoEntrega: 'domicilio', direccion: 'Calle Ejemplo 1',
  esPrueba: false, pasteles: [{ tema: 'Spiderman', personas: 30, pan: 'Vainilla', relleno: 'Fresa' }],
  ...extra,
} as unknown as Pedido);

/** Google de mentira: guarda las llamadas y responde según la ruta. */
function googleFalso(responder: (method: string, url: string) => { status: number; body?: unknown }) {
  const llamadas: Array<{ method: string; url: string; body: any }> = [];
  const f = (async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    llamadas.push({ method, url, body: init.body ? JSON.parse(init.body as string) : null });
    const r = responder(method, url);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

describe('leerLlave', () => {
  it('acepta JSON, base64 y saltos de línea escapados', () => {
    const json = JSON.stringify(LLAVE);
    expect(leerLlave(json).client_email).toBe(LLAVE.client_email);
    expect(leerLlave(Buffer.from(json).toString('base64')).client_email).toBe(LLAVE.client_email);
    const escapada = json.replace(/\\n/g, '\\\\n'); // "\n" literal dentro de la llave
    expect(leerLlave(escapada).private_key).toContain('\nABC\n');
    expect(leerLlave(`'${json}'`).client_email).toBe(LLAVE.client_email);
  });

  it('explica los errores comunes', () => {
    expect(() => leerLlave('{"client_email": "x"')).toThrow(/incompleto/);
    expect(() => leerLlave(JSON.stringify({ type: 'authorized_user' }))).toThrow(/service_account/);
    expect(() => leerLlave('hola')).toThrow(/ni un JSON/);
  });
});

describe('calendario con cuenta de servicio', () => {
  const token = async () => 'tok';

  it('una llave mal pegada no tumba el servidor y se reporta', () => {
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: '{mal', GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }));
    expect(c.disponible).toBe(false);
    expect(c.error).toMatch(/JSON/);
  });

  it('avisa si falta el ID del calendario y muestra la cuenta', () => {
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE) }), fetch, token);
    expect(c.disponible).toBe(false);
    expect(c.cuenta).toBe(LLAVE.client_email);
    expect(c.error).toMatch(/GOOGLE_CALENDAR_ID/);
  });

  it('crea el evento con hora de Monterrey y sin mandar invitaciones', async () => {
    const g = googleFalso(() => ({ status: 200, body: { id: 'evt-9' } }));
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE), GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }), g.f, token);
    expect(await c.crear(pedido(), 'https://app/pedidos/p1')).toBe('evt-9');
    const [ll] = g.llamadas;
    expect(ll.url).toBe('https://www.googleapis.com/calendar/v3/calendars/dueno%40gmail.com/events?sendUpdates=none');
    expect(ll.body.start).toEqual({ dateTime: '2026-11-20T16:00:00', timeZone: 'America/Monterrey' });
    expect(ll.body.end.dateTime).toBe('2026-11-20T17:00:00');
    expect(ll.body.summary).toBe('#0012_NOV · Cliente Ejemplo · Spiderman');
  });

  it('si borraron el evento a mano, al actualizar lo vuelve a crear', async () => {
    const g = googleFalso((m) => (m === 'PUT' ? { status: 404, body: { error: { message: 'Not Found' } } } : { status: 200, body: { id: 'evt-nuevo' } }));
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE), GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }), g.f, token);
    expect(await c.actualizar('evt-viejo', pedido(), 'u')).toBe('evt-nuevo');
  });

  it('borrar un evento que ya no existe no es error', async () => {
    const g = googleFalso(() => ({ status: 410 }));
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE), GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }), g.f, token);
    await expect(c.borrar('x')).resolves.toBeUndefined();
  });

  it('probar crea y borra un evento, y traduce los errores de Google', async () => {
    const ok = googleFalso((m) => (m === 'POST' ? { status: 200, body: { id: 'tmp' } } : { status: 204 }));
    const c = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE), GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }), ok.f, token);
    await c.probar();
    expect(ok.llamadas.map((l) => l.method)).toEqual(['POST', 'DELETE']);

    const casos: Array<[number, string, RegExp]> = [
      [404, 'Not Found', /compartido con rnr-calendario@/],
      [403, 'requiredAccessLevel: writer', /Hacer cambios en eventos/],
      [403, 'Google Calendar API has not been used in project', /no está habilitada/],
    ];
    for (const [status, msg, esperado] of casos) {
      const g = googleFalso(() => ({ status, body: { error: { message: msg } } }));
      const c2 = crearCalendario(cfg({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(LLAVE), GOOGLE_CALENDAR_ID: 'dueno@gmail.com' }), g.f, token);
      await expect(c2.probar()).rejects.toThrow(esperado);
    }
  });

  it('los pedidos de prueba se marcan y los que no tienen hora son de todo el día', () => {
    const ev = eventoDesdePedido(pedido({ esPrueba: true, horaDesde: null }), 'u') as any;
    expect(ev.summary.startsWith('[PRUEBA]')).toBe(true);
    expect(ev.start).toEqual({ date: '2026-11-20' });
    expect(ev.end).toEqual({ date: '2026-11-21' });
  });
});
