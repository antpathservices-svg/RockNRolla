import type { ChatFormat, ChatSegment, Conversacion, Estado, Mensaje, Pastel, Pedido } from '@rnr/shared';

export interface Usuario { email: string; nombre: string | null; rol: 'dueno' | 'operador' }
export interface SinSesion { google: boolean; dev: boolean }

export interface PedidoDetalle extends Pedido {
  referencias: Array<{ id: string; url: string }>;
  pendientes: string[];
}

export interface PedidoFila {
  id: string;
  folio: string;
  estado: Estado;
  clienteNombre: string | null;
  fechaEntrega: string | null;
  horaDesde: string | null;
  tipoEntrega: string | null;
  vigenciaHasta: string | null;
  anticipoRecibido: boolean;
  esPrueba: boolean;
  totalPasteles: number;
  festejados: string | null;
  temas: string | null;
  personas: number | null;
}

export interface VistaPrevia {
  formato: ChatFormat;
  lineas: number;
  mensajes: number;
  adjuntos: number;
  autores: string[];
  propuesta: { negocio: string | null; cliente: string | null };
  tramos: ChatSegment[];
  datosBancariosOcultos: number;
  mensajesConDatosBancarios: number;
}

export interface Ajustes {
  nombre_negocio: string;
  vigencia_dias: number;
  anticipo_pct: number;
  cuentas_cobro: string[];
  origenes: string[];
  formulario: {
    tipos: string[]; panes: string[]; rellenos: string[]; extras: string[];
    max_extras: number; aviso: string; aviso_privacidad_url: string;
  };
  nota: { subtitulo: string; contacto: string[]; agradecimiento: string; lema: string };
  link_dias_validez: number;
  pausa_tramos_dias: number;
}

type EstadoCon = 'conectado' | 'sin_configurar' | 'error' | 'modo_prueba';
export interface Conexiones {
  whatsapp: { estado: EstadoCon; webhook: string };
  claude: { estado: EstadoCon; modelo: string };
  openrouter: { estado: EstadoCon; modelo: string; permiteGuardarDatos: boolean };
  /** Orden de uso: el primero es el principal y el segundo el respaldo. */
  modelos: Array<'claude' | 'openrouter'>;
  calendario: { estado: EstadoCon; calendarioId: string | null; cuenta: string | null; error: string | null };
  login: { estado: EstadoCon };
  ultimoRespaldo: string | null;
}

export interface EventoGoogle {
  id: string;
  titulo: string;
  fecha: string;
  fechaFin: string;
  horaDesde: string | null;
  horaHasta: string | null;
  todoElDia: boolean;
  enlace: string | null;
  ubicacion: string | null;
}

export type Sincronizacion = 'conectado' | 'pendiente' | 'no_aplica';
export interface PedidoCalendario extends PedidoFila {
  horaHasta: string | null;
  direccion: string | null;
  sincronizacion: Sincronizacion;
}

export interface VistaCalendario {
  desde: string;
  hasta: string;
  google: { estado: 'conectado' | 'sin_configurar' | 'error'; error: string | null };
  pedidos: PedidoCalendario[];
  /** Eventos de Google que no son pedidos de la plataforma */
  eventos: EventoGoogle[];
}

export interface PublicoPedido {
  folio: string;
  estado: Estado;
  estadoEtiqueta: string;
  enviado: boolean;
  negocio: string;
  prellenado: {
    clienteNombre: string | null; necesitaTelefono: boolean; fechaEvento: string | null;
    horaEvento: string | null; tipoEntrega: string | null; direccion: string | null;
  };
  resumen: { fechaEntrega: string | null; totalPasteles: number } | null;
  opciones: Ajustes['formulario'];
}

export interface EnvioPublico {
  clienteNombre: string;
  clienteTelefono?: string;
  fechaEvento: string;
  horaEvento: string;
  tipoEntrega: 'domicilio' | 'recoger';
  direccion?: string;
  aceptaPrivacidad: true;
  pasteles: Array<{ tipo: string; personas: number; pan: string; relleno: string; extras: string[]; festejado?: string; edad?: string; descripcion?: string }>;
}

export type PastelEditable = Omit<Pastel, 'id' | 'posicion'>;
export type PedidoPatch = Partial<Omit<Pedido, 'pasteles'>> & { pasteles?: PastelEditable[] };

export interface Api {
  demo: boolean;
  yo(): Promise<Usuario>;
  entrarDev(): Promise<void>;
  salir(): Promise<void>;
  conversaciones(q?: string): Promise<Conversacion[]>;
  conversacion(id: string): Promise<{ conversacion: Conversacion; mensajes: Mensaje[] }>;
  borrarConversacion(id: string): Promise<void>;
  vistaPrevia(texto: string): Promise<VistaPrevia>;
  importar(input: { texto: string; origen: 'archivo' | 'texto'; nombreArchivo?: string; clienteAutor?: string; desdeIndice?: number; hastaIndice?: number }): Promise<{ id: string }>;
  resumir(id: string): Promise<{ resumen: string }>;
  pedidoDesdeConversacion(id: string): Promise<{ id: string }>;
  linkDesdeConversacion(id: string): Promise<{ pedidoId: string; url: string }>;
  pedidos(f: { estado?: Estado; q?: string; desde?: string; hasta?: string; orden?: 'fecha' | 'estado' }): Promise<PedidoFila[]>;
  pedido(id: string): Promise<PedidoDetalle>;
  crearPedido(): Promise<{ id: string }>;
  actualizarPedido(id: string, patch: PedidoPatch): Promise<PedidoDetalle>;
  cambiarEstado(id: string, estado: Estado, motivo?: string): Promise<Pedido>;
  /** Solo el dueño. Borra para siempre el pedido, sus fotos, notas y evento del calendario. */
  eliminarPedido(id: string): Promise<{ folio: string; avisoCalendario: string | null }>;
  aprobar(id: string): Promise<{ version: number; url: string }>;
  enviarNota(id: string): Promise<void>;
  generarLink(id: string): Promise<{ url: string }>;
  desactivarLink(id: string): Promise<void>;
  subirReferencia(id: string, file: File): Promise<void>;
  notaPreviewUrl(id: string): string | null;
  ajustes(): Promise<Ajustes>;
  guardarAjustes(patch: Partial<Ajustes>): Promise<Ajustes>;
  calendario(desde: string, hasta: string, fresco?: boolean): Promise<VistaCalendario>;
  sincronizarCalendario(desde: string, hasta: string): Promise<{ encolados: number }>;
  conexiones(): Promise<Conexiones>;
  probarConexion(nombre: string): Promise<{ ok: boolean; error?: string }>;
  usuarios(): Promise<Array<{ id: number; email: string; nombre: string | null; rol: 'dueno' | 'operador'; activo: boolean }>>;
  agregarUsuario(email: string, rol: 'dueno' | 'operador'): Promise<void>;
  quitarUsuario(id: number): Promise<void>;
  publico(token: string): Promise<PublicoPedido>;
  enviarPublico(token: string, body: EnvioPublico): Promise<void>;
  subirFotoPublica(token: string, file: File): Promise<void>;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) {
    super(message);
  }
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Error ${res.status}`, res.status, data);
  return data as T;
}

const archivo = (file: File) => {
  const f = new FormData();
  f.append('file', file);
  return f;
};

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const httpApi: Api = {
  demo: false,
  yo: () => http('GET', '/api/yo'),
  entrarDev: () => http('POST', '/auth/dev'),
  salir: () => http('POST', '/auth/salir'),
  conversaciones: (q) => http('GET', `/api/conversaciones${qs({ q })}`),
  conversacion: (id) => http('GET', `/api/conversaciones/${id}`),
  borrarConversacion: (id) => http('DELETE', `/api/conversaciones/${id}`),
  vistaPrevia: (texto) => http('POST', '/api/importar/vista-previa', { texto }),
  importar: (input) => http('POST', '/api/importar', input),
  resumir: (id) => http('POST', `/api/conversaciones/${id}/resumen`),
  pedidoDesdeConversacion: (id) => http('POST', `/api/conversaciones/${id}/pedido`),
  linkDesdeConversacion: (id) => http('POST', `/api/conversaciones/${id}/link`),
  pedidos: (f) => http('GET', `/api/pedidos${qs(f)}`),
  pedido: (id) => http('GET', `/api/pedidos/${id}`),
  crearPedido: () => http('POST', '/api/pedidos', {}),
  actualizarPedido: (id, patch) => http('PATCH', `/api/pedidos/${id}`, patch),
  cambiarEstado: (id, estado, motivo) => http('POST', `/api/pedidos/${id}/estado`, { estado, motivo }),
  eliminarPedido: (id) => http('DELETE', `/api/pedidos/${id}`),
  aprobar: (id) => http('POST', `/api/pedidos/${id}/aprobar`),
  enviarNota: (id) => http('POST', `/api/pedidos/${id}/enviar-nota`),
  generarLink: (id) => http('POST', `/api/pedidos/${id}/link`),
  desactivarLink: (id) => http('DELETE', `/api/pedidos/${id}/link`),
  subirReferencia: (id, file) => http('POST', `/api/pedidos/${id}/referencias`, archivo(file)),
  notaPreviewUrl: (id) => `/api/pedidos/${id}/nota-preview`,
  ajustes: () => http('GET', '/api/ajustes'),
  guardarAjustes: (patch) => http('PUT', '/api/ajustes', patch),
  calendario: (desde, hasta, fresco) => http('GET', `/api/calendario${qs({ desde, hasta, fresco: fresco ? '1' : undefined })}`),
  sincronizarCalendario: (desde, hasta) => http('POST', '/api/calendario/sincronizar', { desde, hasta }),
  conexiones: () => http('GET', '/api/conexiones'),
  probarConexion: (n) => http('POST', `/api/conexiones/${n}/probar`),
  usuarios: () => http('GET', '/api/usuarios'),
  agregarUsuario: (email, rol) => http('POST', '/api/usuarios', { email, rol }),
  quitarUsuario: (id) => http('DELETE', `/api/usuarios/${id}`),
  publico: (t) => http('GET', `/api/publico/${t}`),
  enviarPublico: (t, body) => http('POST', `/api/publico/${t}`, body),
  subirFotoPublica: (t, file) => http('POST', `/api/publico/${t}/fotos`, archivo(file)),
};
