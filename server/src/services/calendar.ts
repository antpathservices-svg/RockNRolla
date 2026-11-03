import { JWT } from 'google-auth-library';
import type { Pedido } from '@rnr/shared';
import type { Config } from '../config.js';

/**
 * Google Calendar con una cuenta de servicio (ADR-03). El dueño comparte su calendario con
 * el correo de la cuenta de servicio, con permiso para "Hacer cambios en eventos".
 * No vence a los 7 días ni pide verificación de Google.
 * Referencia: https://developers.google.com/workspace/calendar/api/v3/reference/events
 */

export interface Calendario {
  readonly disponible: boolean;
  /** Correo de la cuenta de servicio (no es secreto): con él se comparte el calendario. */
  readonly cuenta: string | null;
  /** Motivo por el que la llave no se pudo leer, si lo hay. */
  readonly error: string | null;
  crear(p: Pedido, urlPedido: string): Promise<string>;
  /** Devuelve el id del evento: el mismo, o uno nuevo si alguien borró el original a mano. */
  actualizar(eventId: string, p: Pedido, urlPedido: string): Promise<string>;
  borrar(eventId: string): Promise<void>;
  probar(): Promise<void>;
  /** Eventos del calendario entre dos fechas (YYYY-MM-DD, ambas incluidas), en hora de Monterrey. */
  listar(desde: string, hasta: string): Promise<EventoCalendario[]>;
}

export interface EventoCalendario {
  id: string;
  titulo: string;
  /** Día de inicio en Monterrey */
  fecha: string;
  /** Último día que ocupa (igual a fecha si es de un día) */
  fechaFin: string;
  horaDesde: string | null;
  horaHasta: string | null;
  todoElDia: boolean;
  /** Si lo creó la plataforma: el pedido al que pertenece */
  pedidoId: string | null;
  enlace: string | null;
  ubicacion: string | null;
}

/** Fecha y hora de Monterrey (UTC-06:00, sin horario de verano) de un dateTime de Google. */
function enMonterrey(dateTime: string): { fecha: string; hora: string } {
  const iso = new Date(Date.parse(dateTime) - 6 * 3600_000).toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function eventoDesdeGoogle(ev: any): EventoCalendario | null {
  if (!ev?.id || ev.status === 'cancelled' || !ev.start) return null;
  const base = {
    id: String(ev.id),
    titulo: ev.summary ? String(ev.summary) : '(Sin título)',
    pedidoId: ev.extendedProperties?.private?.pedidoId ?? null,
    enlace: ev.htmlLink ?? null,
    ubicacion: ev.location ?? null,
  };
  if (ev.start.date) {
    const fin = ev.end?.date ? diaAnterior(ev.end.date) : ev.start.date;
    return { ...base, fecha: ev.start.date, fechaFin: fin < ev.start.date ? ev.start.date : fin, horaDesde: null, horaHasta: null, todoElDia: true };
  }
  if (!ev.start.dateTime) return null;
  const ini = enMonterrey(ev.start.dateTime);
  const fin = ev.end?.dateTime ? enMonterrey(ev.end.dateTime) : ini;
  // Un evento que termina justo a medianoche no ocupa el día siguiente
  const fechaFin = fin.hora === '00:00' && fin.fecha > ini.fecha ? diaAnterior(fin.fecha) : fin.fecha;
  return { ...base, fecha: ini.fecha, fechaFin, horaDesde: ini.hora, horaHasta: fin.fecha === ini.fecha ? fin.hora : null, todoElDia: false };
}

const ZONA = 'America/Monterrey';
const BASE = 'https://www.googleapis.com/calendar/v3';

function sumarMinutos(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + min, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function eventoDesdePedido(p: Pedido, urlPedido: string) {
  const temas = p.pasteles.map((x) => x.tema).filter(Boolean).join(' / ');
  const resumen = [p.esPrueba ? '[PRUEBA]' : null, p.folio, p.clienteNombre, temas].filter(Boolean).join(' · ');
  const lineas = p.pasteles.map((x, i) =>
    `Pastel ${i + 1}: ${[x.tema, x.personas ? `${x.personas} personas` : null, x.pan, x.relleno].filter(Boolean).join(', ')}`,
  );
  const descripcion = [
    ...lineas,
    p.clienteTelefono ? `Tel: ${p.clienteTelefono}` : null,
    p.tipoEntrega === 'recoger' ? 'Recoge en sucursal' : p.direccion ? `Entrega: ${p.direccion}` : null,
    `Pedido: ${urlPedido}`,
  ].filter(Boolean).join('\n');

  const fecha = p.fechaEntrega!;
  const base = {
    summary: resumen,
    description: descripcion,
    location: p.tipoEntrega === 'domicilio' ? p.direccion ?? undefined : undefined,
    extendedProperties: { private: { pedidoId: p.id, folio: p.folio ?? '' } },
  };
  if (!p.horaDesde) {
    // Sin hora: evento de todo el día
    return { ...base, start: { date: fecha }, end: { date: diaSiguiente(fecha) } };
  }
  const hasta = p.horaHasta && p.horaHasta > p.horaDesde ? p.horaHasta : sumarMinutos(p.horaDesde, 60);
  return {
    ...base,
    start: { dateTime: `${fecha}T${p.horaDesde}:00`, timeZone: ZONA },
    end: { dateTime: `${fecha}T${hasta}:00`, timeZone: ZONA },
  };
}

interface Llave { client_email: string; private_key: string }

/**
 * Lee la llave tal como llegue desde Easypanel: JSON en una o varias líneas, entre comillas,
 * o en base64. Algunos paneles convierten los saltos de línea de la llave privada en "\n"
 * literales; se reparan aquí para que Google la acepte.
 */
export function leerLlave(raw: string): Llave {
  let txt = raw.trim();
  if ((txt.startsWith("'") && txt.endsWith("'")) || (txt.startsWith('"') && txt.endsWith('"') && !txt.startsWith('"{'))) {
    txt = txt.slice(1, -1).trim();
  }
  if (!txt.startsWith('{')) {
    const dec = Buffer.from(txt, 'base64').toString('utf8').trim();
    if (!dec.startsWith('{')) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON ni un JSON en base64. Pega el contenido completo del archivo de la llave.');
    txt = dec;
  }
  let json: Partial<Llave> & { type?: string };
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON está incompleto o mal copiado: no se pudo leer como JSON. Vuelve a pegar el archivo completo, o pégalo en base64.');
  }
  if (json.type && json.type !== 'service_account') {
    throw new Error(`La llave es de tipo "${json.type}"; se necesita la de una cuenta de servicio (type "service_account").`);
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('A la llave le faltan client_email o private_key. Descarga de nuevo la clave JSON de la cuenta de servicio.');
  }
  return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, '\n') };
}

/** Traduce las respuestas de Google a lo que hay que corregir. */
function explicar(status: number, cuerpo: string, calendarId: string, cuenta: string): string {
  const t = cuerpo.toLowerCase();
  if (status === 401 || t.includes('invalid_grant') || t.includes('invalid jwt')) {
    return 'Google rechazó la llave de la cuenta de servicio: puede estar borrada o mal copiada. Crea una clave JSON nueva y pégala otra vez.';
  }
  if (status === 403 && (t.includes('accessnotconfigured') || t.includes('has not been used') || t.includes('is disabled'))) {
    return 'La API de Google Calendar no está habilitada en el proyecto de Google Cloud. Habilítala en APIs y servicios › Biblioteca y vuelve a probar en unos minutos.';
  }
  if (status === 404) {
    return `No encuentro el calendario "${calendarId}". Revisa GOOGLE_CALENDAR_ID y que el calendario esté compartido con ${cuenta}.`;
  }
  if (status === 403) {
    return `El calendario está compartido con ${cuenta} pero sin permiso para cambiar eventos. En Google Calendar cambia el permiso a "Hacer cambios en eventos".`;
  }
  return `Google Calendar respondió ${status}: ${cuerpo.slice(0, 300)}`;
}

type ObtenerToken = () => Promise<string>;

export function crearCalendario(config: Config, fetchImpl: typeof fetch = fetch, obtenerToken?: ObtenerToken): Calendario {
  const calendarId = config.GOOGLE_CALENDAR_ID?.trim() || null;
  let cuenta: string | null = null;
  let error: string | null = null;
  let token: ObtenerToken | null = null;

  if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const llave = leerLlave(config.GOOGLE_SERVICE_ACCOUNT_JSON);
      cuenta = llave.client_email;
      if (obtenerToken) token = obtenerToken;
      else {
        const jwt = new JWT({ email: llave.client_email, key: llave.private_key, scopes: ['https://www.googleapis.com/auth/calendar.events'] });
        token = async () => {
          const r = await jwt.getAccessToken();
          if (!r.token) throw new Error('Google no entregó un token para la cuenta de servicio.');
          return r.token;
        };
      }
    } catch (e) {
      // Una llave mal pegada no debe tumbar el servidor: se muestra en Configuración.
      error = (e as Error).message;
    }
  }
  if (!error && cuenta && !calendarId) error = 'Falta GOOGLE_CALENDAR_ID (el correo del dueño o el ID del calendario de pedidos).';

  const disponible = Boolean(token && calendarId && !error);

  async function llamar(method: string, path: string, body?: unknown): Promise<any> {
    if (!disponible || !token || !calendarId || !cuenta) throw new Error(error ?? 'Google Calendar no está configurado.');
    let bearer: string;
    try {
      bearer = await token();
    } catch (e) {
      throw new Error(explicar(401, (e as Error).message, calendarId, cuenta));
    }
    const res = await fetchImpl(`${BASE}/calendars/${encodeURIComponent(calendarId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(explicar(res.status, text, calendarId, cuenta)) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  const yaNoExiste = (e: unknown) => [404, 410].includes((e as { status?: number }).status ?? 0);

  return {
    disponible,
    cuenta,
    error,
    async crear(p, url) {
      const ev = await llamar('POST', '/events?sendUpdates=none', eventoDesdePedido(p, url));
      return ev.id as string;
    },
    async actualizar(id, p, url) {
      try {
        await llamar('PUT', `/events/${encodeURIComponent(id)}?sendUpdates=none`, eventoDesdePedido(p, url));
        return id;
      } catch (e) {
        // Si lo borraron a mano en Google Calendar, se vuelve a crear.
        if (!yaNoExiste(e)) throw e;
        const ev = await llamar('POST', '/events?sendUpdates=none', eventoDesdePedido(p, url));
        return ev.id as string;
      }
    },
    async borrar(id) {
      try {
        await llamar('DELETE', `/events/${encodeURIComponent(id)}?sendUpdates=none`);
      } catch (e) {
        if (!yaNoExiste(e)) throw e; // ya no existe: no es error
      }
    },
    async listar(desde, hasta) {
      const eventos: EventoCalendario[] = [];
      let pagina: string | undefined;
      // Hasta 4 páginas de 250: de sobra para un mes de un negocio.
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({
          timeMin: `${desde}T00:00:00-06:00`,
          timeMax: `${diaSiguiente(hasta)}T00:00:00-06:00`,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          timeZone: ZONA,
        });
        if (pagina) q.set('pageToken', pagina);
        const r = await llamar('GET', `/events?${q}`);
        for (const ev of r?.items ?? []) {
          const e = eventoDesdeGoogle(ev);
          if (e) eventos.push(e);
        }
        pagina = r?.nextPageToken;
        if (!pagina) break;
      }
      return eventos;
    },
    async probar() {
      // Crear y borrar un evento comprueba la llave, el ID y el permiso de escritura.
      // Solo listar pasaría también con un calendario compartido "solo lectura".
      const hoy = new Date().toISOString().slice(0, 10);
      const ev = await llamar('POST', '/events?sendUpdates=none', {
        summary: 'Prueba de conexión de la plataforma (se borra sola)',
        start: { date: hoy },
        end: { date: diaSiguiente(hoy) },
        transparency: 'transparent',
      });
      await llamar('DELETE', `/events/${encodeURIComponent(ev.id)}?sendUpdates=none`);
    },
  };
}
