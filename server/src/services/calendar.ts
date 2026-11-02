import { JWT } from 'google-auth-library';
import type { Pedido } from '@rnr/shared';
import type { Config } from '../config.js';

/**
 * Google Calendar con una cuenta de servicio (ADR-03). El dueño comparte su calendario con
 * el correo de la cuenta de servicio, con permiso para "Hacer cambios en eventos".
 * No vence a los 7 días ni pide verificación de Google.
 */

export interface Calendario {
  readonly disponible: boolean;
  crear(p: Pedido, urlPedido: string): Promise<string>;
  actualizar(eventId: string, p: Pedido, urlPedido: string): Promise<void>;
  borrar(eventId: string): Promise<void>;
  probar(): Promise<void>;
}

const ZONA = 'America/Monterrey';
const BASE = 'https://www.googleapis.com/calendar/v3';

function sumarMinutos(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + min, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function eventoDesdePedido(p: Pedido, urlPedido: string) {
  const temas = p.pasteles.map((x) => x.tema).filter(Boolean).join(' / ');
  const resumen = [p.folio, p.clienteNombre, temas].filter(Boolean).join(' · ');
  const lineas = p.pasteles.map((x, i) =>
    `Pastel ${i + 1}: ${[x.tema, x.personas ? `${x.personas} personas` : null, x.pan, x.relleno].filter(Boolean).join(', ')}`,
  );
  const descripcion = [
    ...lineas,
    p.tipoEntrega === 'recoger' ? 'Recoge en sucursal' : p.direccion ? `Entrega: ${p.direccion}` : null,
    `Pedido: ${urlPedido}`,
  ].filter(Boolean).join('\n');

  const fecha = p.fechaEntrega!;
  const base = {
    summary: resumen,
    description: descripcion,
    location: p.tipoEntrega === 'domicilio' ? p.direccion ?? undefined : undefined,
    extendedProperties: { private: { pedidoId: p.id, folio: p.folio } },
  };
  if (!p.horaDesde) {
    // Sin hora: evento de todo el día
    const fin = new Date(`${fecha}T00:00:00Z`);
    fin.setUTCDate(fin.getUTCDate() + 1);
    return { ...base, start: { date: fecha }, end: { date: fin.toISOString().slice(0, 10) } };
  }
  const hasta = p.horaHasta && p.horaHasta > p.horaDesde ? p.horaHasta : sumarMinutos(p.horaDesde, 60);
  return {
    ...base,
    start: { dateTime: `${fecha}T${p.horaDesde}:00`, timeZone: ZONA },
    end: { dateTime: `${fecha}T${hasta}:00`, timeZone: ZONA },
  };
}

export function crearCalendario(config: Config, fetchImpl: typeof fetch = fetch): Calendario {
  const calendarId = config.GOOGLE_CALENDAR_ID;
  let jwt: JWT | null = null;
  if (config.GOOGLE_SERVICE_ACCOUNT_JSON && calendarId) {
    const raw = config.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    jwt = new JWT({ email: json.client_email, key: json.private_key, scopes: ['https://www.googleapis.com/auth/calendar.events'] });
  }

  async function llamar(method: string, path: string, body?: unknown): Promise<any> {
    if (!jwt || !calendarId) throw new Error('Google Calendar no está configurado.');
    const { token } = await jwt.getAccessToken();
    const res = await fetchImpl(`${BASE}/calendars/${encodeURIComponent(calendarId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Google Calendar respondió ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    disponible: Boolean(jwt),
    async crear(p, url) {
      const ev = await llamar('POST', '/events', eventoDesdePedido(p, url));
      return ev.id as string;
    },
    async actualizar(id, p, url) {
      await llamar('PUT', `/events/${encodeURIComponent(id)}`, eventoDesdePedido(p, url));
    },
    async borrar(id) {
      try {
        await llamar('DELETE', `/events/${encodeURIComponent(id)}`);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 404 && status !== 410) throw e; // ya no existe: no es error
      }
    },
    async probar() {
      // Listar eventos solo necesita el permiso que también usamos para escribir.
      await llamar('GET', '/events?maxResults=1');
    },
  };
}
