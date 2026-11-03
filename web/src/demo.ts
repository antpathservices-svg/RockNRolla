/**
 * Modo de vista previa: la misma interfaz, con datos de ejemplo en memoria y sin servidor.
 * El lector de chats es el real (paquete compartido); la extracción es una aproximación
 * con reglas simples, porque en la vista previa no se llama a Claude.
 */
import {
  ESTADOS,
  fechaMasDias,
  formatFolio,
  guessRoles,
  maskBankData,
  parseChat,
  parsePesos,
  splitSegments,
  type Conversacion,
  type Duda,
  type Estado,
  type Mensaje,
  type Pastel,
  type Pedido,
} from '@rnr/shared';
import type { Ajustes, Api, EventoGoogle, PedidoDetalle, PedidoFila, PedidoPatch } from './api';
import { ApiError } from './api';

const NB = ' ';
const CHAT_EJEMPLO = [
  `21/10/2026, 8:33${NB}a.${NB}m. - Ana Pruebas: Hola, perdón es que andaba escogiendo los diseños`,
  `21/10/2026, 8:34${NB}a.${NB}m. - Ana Pruebas: Quería dos pasteles para el 20 de noviembre`,
  `21/10/2026, 8:35${NB}a.${NB}m. - Ana Pruebas: IMG-20261021-WA0003.jpg (archivo adjunto)`,
  `21/10/2026, 8:36${NB}a.${NB}m. - Ana Pruebas: El de Cars es para mi hijo Nico que cumple 4 años y el de princesas para Mari que cumple 4`,
  `21/10/2026, 10:34${NB}a.${NB}m. - Rock n Rolla Cakes: Muy bien, para cuántas personas sería cada uno?`,
  `21/10/2026, 10:59${NB}a.${NB}m. - Ana Pruebas: 20 personas cada uno <Se editó este mensaje.>`,
  `21/10/2026, 11:56${NB}a.${NB}m. - Rock n Rolla Cakes: Sería de $1800 incluye coches coleccionables`,
  `21/10/2026, 11:57${NB}a.${NB}m. - Rock n Rolla Cakes: Sería de $1750`,
  `Pan cremoso vainilla relleno de mermelada de fresa o Nutella`,
  `21/10/2026, 12:03${NB}p.${NB}m. - Ana Pruebas: Vainilla relleno de cajeta`,
  `21/10/2026, 12:34${NB}p.${NB}m. - Rock n Rolla Cakes: *Antes de realizar tu pago*`,
  `Tarjeta 4111111111111111`,
  `012345678901234567`,
  `50% de anticipo`,
  `21/10/2026, 1:01${NB}p.${NB}m. - Ana Pruebas: Entonces sería entregar entre 11am y 12pm a domicilio`,
  `21/10/2026, 1:25${NB}p.${NB}m. - Rock n Rolla Cakes: Bien, se cobran $250 de envio y si tengo disponible de 11am a 12pm`,
].join('\n');

const AJUSTES: Ajustes = {
  nombre_negocio: 'Rock n Rolla Cakes',
  vigencia_dias: 15,
  anticipo_pct: 50,
  cuentas_cobro: ['Efectivo', 'BANREGIO', 'BBVA'],
  origenes: ['Instagram', 'Facebook', 'Publicidad', 'Cliente recurrente', 'Recomendación'],
  formulario: {
    tipos: ['1 piso', '2 pisos', '3 pisos o más', '3D', 'Cupcakes', 'Plancha'],
    panes: ['Vainilla', 'Cremoso de vainilla', 'Chocolate', 'Red velvet', 'Marmoleado', 'Combinado', 'Que me recomienden'],
    rellenos: ['Mermelada de fresa', 'Nutella', 'Cajeta', 'Dulce de leche', 'Mermelada de piña', 'Chabacano', 'Crema pastelera', 'Que me recomienden', 'Otro'],
    extras: ['Cake topper', 'Galletas', 'Figuras en fondant', 'Oblea comestible', 'Otro'],
    max_extras: 5,
    aviso: 'Te confirmamos el precio por WhatsApp. El anticipo del 50% se paga después, con los datos de cuenta que te enviaremos.',
    aviso_privacidad_url: '',
  },
  nota: {
    subtitulo: 'Nota de pedido',
    contacto: ['WhatsApp 811 710 1907 • Instagram @rockandrollacakes • Facebook', 'Rock N Rolla Cakes • Nexxus Escobedo'],
    agradecimiento: '¡Gracias por confiar en Rock N Rolla Cakes!',
    lema: 'Hecho con pasión para celebrar tus mejores momentos • Tan exquisito como una canción',
  },
  link_dias_validez: 30,
  pausa_tramos_dias: 7,
};

interface ConvDemo { c: Conversacion; mensajes: Mensaje[] }
const conversaciones: ConvDemo[] = [];
const pedidos: PedidoDetalle[] = [];
let folio = 8;
const ahora = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const pausa = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 150));

function pastel(p: Partial<Pastel>): Pastel {
  return {
    posicion: 0, tema: null, festejado: null, edad: null, personas: null, tipo: null, pan: null, relleno: null,
    cubierta: null, decoracion: null, extras: [], precioCentavos: null, precioConfirmado: false, ...p,
  };
}

function pendientes(p: Pedido): string[] {
  const f: string[] = [];
  if (!p.clienteNombre) f.push('Falta el nombre del cliente.');
  if (!p.fechaEntrega) f.push('Falta la fecha de entrega.');
  if (p.tipoEntrega === 'domicilio' && !p.direccion) f.push('Falta la dirección de entrega.');
  p.pasteles.forEach((x, i) => {
    if (x.precioCentavos == null) f.push(`Falta el precio del pastel ${i + 1}.`);
    else if (!x.precioConfirmado) f.push(`Confirma el precio del pastel ${i + 1}.`);
  });
  return f;
}

function nuevoPedido(d: Partial<Pedido>): PedidoDetalle {
  const n = ++folio;
  const p: PedidoDetalle = {
    id: uid(), folio: formatFolio(n), estado: 'cotizando', motivoCancelacion: null, conversacionId: null,
    clienteNombre: null, clienteTelefono: null, clienteTipo: null, origen: null, fechaEntrega: null, horaEvento: null,
    horaDesde: null, horaHasta: null, tipoEntrega: null, direccion: null, envioCentavos: 0, descuentoCentavos: 0,
    anticipoPct: AJUSTES.anticipo_pct, cuentaAnticipo: null, cuentaSaldo: null, anticipoRecibidoEn: null,
    vigenciaHasta: fechaMasDias(AJUSTES.vigencia_dias), aprobadoEn: null, eventoCalendarioId: null, tokenPublico: null,
    tokenActivo: false, formularioRecibidoEn: null, esPrueba: true, dudas: [], fuentes: [], pasteles: [pastel({})],
    notas: [], creado: ahora(), actualizado: ahora(), referencias: [], pendientes: [], ...d,
  };
  p.pendientes = pendientes(p);
  pedidos.push(p);
  return p;
}

function importar(texto: string, origen: 'archivo' | 'texto', clienteAutor?: string, desde = 0, hasta = Infinity) {
  const r = parseChat(texto);
  const roles = guessRoles(r.authors, AJUSTES.nombre_negocio);
  const cliente = clienteAutor ?? roles.cliente;
  const elegidos = r.messages.filter((m) => m.index >= desde && m.index <= hasta);
  const id = uid();
  const mensajes: Mensaje[] = elegidos.map((m, i) => ({
    id: i, indice: i, rol: m.author == null ? 'sistema' : m.author === cliente ? 'cliente' : 'negocio',
    autor: m.author, texto: maskBankData(m.text).text, tipo: m.kind, adjuntoNombre: m.attachmentName ?? null,
    editado: m.edited, enviado: m.sentAt,
  }));
  conversaciones.unshift({
    c: { id, origen, esPrueba: true, clienteNombre: cliente, clienteTelefono: null, resumen: null, dudas: [],
      ultimoMensaje: elegidos.at(-1)?.sentAt ?? null, creado: ahora() },
    mensajes,
  });
  return id;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Extracción aproximada con reglas, solo para la vista previa. */
function extraerDemo(conv: ConvDemo) {
  const texto = conv.mensajes.map((m) => m.texto).join('\n');
  const delNegocio = conv.mensajes.filter((m) => m.rol === 'negocio').map((m) => m.texto).join('\n');
  const precios = [...delNegocio.matchAll(/(?:ser[ií]a de|precio de|cuesta)\s*\$\s?([\d,]+)/gi)].map((m) => parsePesos(m[1]));
  const envio = /\$\s?([\d,]+)\s*de env[ií]o/i.exec(texto);
  const fecha = new RegExp(`(\\d{1,2}) de (${MESES.join('|')})`, 'i').exec(texto);
  const anio = (conv.c.ultimoMensaje ?? ahora()).slice(0, 4);
  const personas = /(\d+)\s*personas/i.exec(texto);
  const horas = /entre\s*(\d{1,2})\s*(?:am)?\s*y\s*(\d{1,2})\s*(am|pm)?/i.exec(texto);
  const h24 = (h: string, pm: boolean) => String((+h % 12) + (pm ? 12 : 0)).padStart(2, '0') + ':00';
  const n = Math.max(precios.length, /dos pasteles/i.test(texto) ? 2 : 1);
  const dudas: Duda[] = precios.length > 1 ? precios.map((_, i) => ({ campo: `pasteles[${i}].precio`, motivo: 'Hay varios precios en el chat y no queda claro cuál es de cuál pastel.' })) : [];
  const pasteles = Array.from({ length: n }, (_, i) =>
    pastel({ posicion: i, personas: personas ? +personas[1] : null, precioCentavos: precios[i] ?? null,
      precioConfirmado: precios.length === 1 && precios[i] != null, pan: /cremoso/i.test(texto) ? 'Cremoso de vainilla' : null,
      relleno: /cajeta/i.test(texto) ? 'Cajeta' : null }),
  );
  return {
    resumen: 'Vista previa sin Claude: estos datos salen de reglas simples. En la plataforma real, Claude lee el chat completo y escribe el resumen.',
    pedido: {
      clienteNombre: conv.c.clienteNombre,
      fechaEntrega: fecha ? `${anio}-${String(MESES.indexOf(fecha[2].toLowerCase()) + 1).padStart(2, '0')}-${fecha[1].padStart(2, '0')}` : null,
      horaDesde: horas ? h24(horas[1], false) : null,
      horaHasta: horas ? h24(horas[2], horas[3]?.toLowerCase() === 'pm' && +horas[2] !== 12 ? true : false) : null,
      tipoEntrega: /domicilio/i.test(texto) ? ('domicilio' as const) : null,
      envioCentavos: envio ? parsePesos(envio[1]) ?? 0 : 0,
      pasteles, dudas,
    },
  };
}

function fila(p: PedidoDetalle): PedidoFila {
  return {
    id: p.id, folio: p.folio, estado: p.estado, clienteNombre: p.clienteNombre, fechaEntrega: p.fechaEntrega,
    horaDesde: p.horaDesde, tipoEntrega: p.tipoEntrega, vigenciaHasta: p.vigenciaHasta, anticipoRecibido: Boolean(p.anticipoRecibidoEn),
    esPrueba: p.esPrueba, totalPasteles: p.pasteles.length,
    festejados: p.pasteles.map((x) => x.festejado).filter(Boolean).join(' y ') || null,
    temas: p.pasteles.map((x) => x.tema).filter(Boolean).join(' / ') || null,
    personas: p.pasteles.reduce((s, x) => s + (x.personas ?? 0), 0) || null,
  };
}

// ---- Datos de ejemplo ----
/** Otros eventos del calendario de Google del dueño (no son pedidos). */
const EVENTOS_DEMO: EventoGoogle[] = [
  { id: 'g1', titulo: 'Compra de insumos', fecha: fechaMasDias(2), fechaFin: fechaMasDias(2), horaDesde: '09:00', horaHasta: '10:30', todoElDia: false, enlace: null, ubicacion: null },
  { id: 'g2', titulo: 'Expo pasteles', fecha: fechaMasDias(8), fechaFin: fechaMasDias(9), horaDesde: null, horaHasta: null, todoElDia: true, enlace: null, ubicacion: null },
  { id: 'g3', titulo: 'Junta con proveedor', fecha: fechaMasDias(-3), fechaFin: fechaMasDias(-3), horaDesde: '18:00', horaHasta: '19:00', todoElDia: false, enlace: null, ubicacion: null },
];
importar(`20/10/2026, 6:12${NB}p.${NB}m. - Cliente Nuevo: Hola, quería informes para un pastel`, 'texto');
const convId = importar(CHAT_EJEMPLO, 'archivo'); // queda primero en la bandeja
const dias = (n: number) => fechaMasDias(n);
nuevoPedido({ estado: 'en_preparacion', clienteNombre: 'Beto Ejemplo', fechaEntrega: dias(1), horaDesde: '13:30', horaHasta: '14:30', tipoEntrega: 'domicilio', direccion: 'Calle Ejemplo 202', envioCentavos: 45000, anticipoRecibidoEn: ahora(), eventoCalendarioId: 'demo',
  pasteles: [pastel({ tema: 'Rock clásico', festejado: 'Mau', edad: '30', personas: 50, tipo: '2 pisos', pan: 'Marmoleado', relleno: 'Nutella', precioCentavos: 650000, precioConfirmado: true })] });
nuevoPedido({ estado: 'listo', clienteNombre: 'Carla Demo', fechaEntrega: dias(-1), horaDesde: '17:00', tipoEntrega: 'recoger', anticipoRecibidoEn: ahora(), eventoCalendarioId: 'demo',
  pasteles: [pastel({ tema: 'Unicornio', festejado: 'Sofi', edad: '6', personas: 25, tipo: '1 piso', pan: 'Vainilla', relleno: 'Mermelada de fresa', precioCentavos: 120000, precioConfirmado: true })] });
nuevoPedido({ estado: 'cotizando', clienteNombre: 'Dani Muestra', fechaEntrega: dias(16), vigenciaHasta: dias(-2),
  pasteles: [pastel({ tema: 'Fútbol', festejado: 'Leo', personas: 15, precioCentavos: 95000, precioConfirmado: true })] });

export const demoApi: Api = {
  demo: true,
  yo: () => pausa({ email: 'duena@ejemplo.mx', nombre: 'Vista previa', rol: 'dueno' as const }),
  entrarDev: async () => undefined,
  salir: async () => undefined,
  async conversaciones(q) {
    const lista = conversaciones
      .filter((x) => !q || (x.c.clienteNombre ?? '').toLowerCase().includes(q.toLowerCase()))
      .map((x) => {
        const p = pedidos.find((y) => y.conversacionId === x.c.id);
        const ult = [...x.mensajes].reverse().find((m) => m.rol !== 'sistema');
        return { ...x.c, ultimoTexto: ult?.texto ?? null, totalMensajes: x.mensajes.filter((m) => m.rol !== 'sistema').length, pedidoId: p?.id ?? null, pedidoEstado: p?.estado ?? null };
      });
    return pausa(lista);
  },
  async conversacion(id) {
    const x = conversaciones.find((c) => c.c.id === id);
    if (!x) throw new ApiError('No existe la conversación.', 404);
    const p = pedidos.find((y) => y.conversacionId === id);
    return pausa({ conversacion: { ...x.c, pedidoId: p?.id ?? null, pedidoEstado: p?.estado ?? null, totalMensajes: x.mensajes.length }, mensajes: x.mensajes });
  },
  async borrarConversacion(id) {
    const i = conversaciones.findIndex((c) => c.c.id === id);
    if (i >= 0) conversaciones.splice(i, 1);
  },
  async vistaPrevia(texto) {
    const r = parseChat(texto);
    const reales = r.messages.filter((m) => m.kind !== 'sistema');
    let ocultos = 0, con = 0;
    for (const m of r.messages) { const c = maskBankData(m.text).count; ocultos += c; if (c) con++; }
    return pausa({
      formato: r.format, lineas: r.lineCount, mensajes: reales.length,
      adjuntos: reales.filter((m) => m.kind !== 'texto' || /<multimedia omitid/i.test(m.text)).length,
      autores: r.authors, propuesta: guessRoles(r.authors, AJUSTES.nombre_negocio), tramos: splitSegments(r.messages, 7),
      datosBancariosOcultos: ocultos, mensajesConDatosBancarios: con,
    });
  },
  async importar(i) {
    return pausa({ id: importar(i.texto, i.origen, i.clienteAutor, i.desdeIndice ?? 0, i.hastaIndice ?? Infinity) });
  },
  async resumir(id) {
    const x = conversaciones.find((c) => c.c.id === id)!;
    const e = extraerDemo(x);
    x.c.resumen = e.resumen;
    x.c.dudas = e.pedido.dudas;
    return pausa({ resumen: e.resumen });
  },
  async pedidoDesdeConversacion(id) {
    const ex = pedidos.find((p) => p.conversacionId === id);
    if (ex) return { id: ex.id };
    const x = conversaciones.find((c) => c.c.id === id)!;
    const e = extraerDemo(x);
    x.c.resumen ??= e.resumen;
    return pausa({ id: nuevoPedido({ ...e.pedido, conversacionId: id }).id });
  },
  async linkDesdeConversacion(id) {
    let p = pedidos.find((y) => y.conversacionId === id);
    if (!p) p = nuevoPedido({ conversacionId: id, clienteNombre: conversaciones.find((c) => c.c.id === id)?.c.clienteNombre ?? null });
    p.tokenActivo = true; p.tokenPublico = `demo-${p.id}`;
    return pausa({ pedidoId: p.id, url: `#/p/${p.tokenPublico}` });
  },
  async pedidos(f) {
    let l = pedidos.slice();
    if (f.estado) l = l.filter((p) => p.estado === f.estado);
    if (f.desde) l = l.filter((p) => p.fechaEntrega && p.fechaEntrega >= f.desde!);
    if (f.hasta) l = l.filter((p) => p.fechaEntrega && p.fechaEntrega <= f.hasta!);
    if (f.q) {
      const q = f.q.toLowerCase();
      l = l.filter((p) => [p.clienteNombre, p.folio, ...p.pasteles.flatMap((x) => [x.festejado, x.tema])].some((v) => v?.toLowerCase().includes(q)));
    }
    l.sort((a, b) => f.orden === 'estado'
      ? ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado)
      : (a.fechaEntrega ?? '9999').localeCompare(b.fechaEntrega ?? '9999'));
    return pausa(l.map(fila));
  },
  async pedido(id) {
    const p = pedidos.find((x) => x.id === id);
    if (!p) throw new ApiError('No existe el pedido.', 404);
    return pausa(p);
  },
  async crearPedido() { return pausa({ id: nuevoPedido({}).id }); },
  async actualizarPedido(id, patch: PedidoPatch) {
    const p = pedidos.find((x) => x.id === id)!;
    const { pasteles, ...resto } = patch;
    Object.assign(p, resto);
    if (pasteles) p.pasteles = pasteles.map((x, i) => ({ ...x, posicion: i }));
    p.pendientes = pendientes(p);
    p.actualizado = ahora();
    return pausa(p);
  },
  async cambiarEstado(id, estado: Estado, motivo) {
    const p = pedidos.find((x) => x.id === id)!;
    if (estado === 'cancelado' && !motivo?.trim()) throw new ApiError('Escribe el motivo de la cancelación.', 422);
    p.estado = estado;
    if (estado === 'cancelado') p.motivoCancelacion = motivo ?? null;
    if (estado === 'aceptado') p.anticipoRecibidoEn ??= ahora();
    p.eventoCalendarioId = ['cotizando', 'cancelado'].includes(estado) ? null : 'demo';
    return pausa(p);
  },
  async aprobar(id) {
    const p = pedidos.find((x) => x.id === id)!;
    const f = pendientes(p);
    if (f.length) throw new ApiError('Faltan datos para aprobar.', 422, { pendientes: f });
    p.aprobadoEn = ahora();
    p.notas.push({ version: p.notas.length + 1, creado: ahora() });
    return pausa({ version: p.notas.length, url: '' });
  },
  async enviarNota() { throw new ApiError('En la vista previa no se manda nada por WhatsApp.', 503); },
  async generarLink(id) {
    const p = pedidos.find((x) => x.id === id)!;
    p.tokenActivo = true; p.tokenPublico = `demo-${p.id}`;
    return pausa({ url: `#/p/${p.tokenPublico}` });
  },
  async eliminarPedido(id) {
    const i = pedidos.findIndex((x) => x.id === id);
    if (i < 0) throw new ApiError('No existe el pedido.', 404);
    const [p] = pedidos.splice(i, 1);
    return pausa({ folio: p.folio, avisoCalendario: null });
  },
  async desactivarLink(id) { const p = pedidos.find((x) => x.id === id)!; p.tokenActivo = false; p.tokenPublico = null; },
  async subirReferencia(id, file) {
    const p = pedidos.find((x) => x.id === id)!;
    p.referencias.push({ id: uid(), url: URL.createObjectURL(file) });
  },
  notaPreviewUrl: () => null,
  ajustes: () => pausa(AJUSTES),
  async guardarAjustes(patch) { Object.assign(AJUSTES, patch); return pausa(AJUSTES); },
  async calendario(desde, hasta) {
    const enRango = (f: string | null) => Boolean(f && f >= desde && f <= hasta);
    return pausa({
      desde, hasta,
      google: { estado: 'conectado' as const, error: null },
      pedidos: pedidos.filter((p) => p.estado !== 'cancelado' && enRango(p.fechaEntrega)).map((p) => ({
        ...fila(p), horaHasta: p.horaHasta, direccion: p.direccion,
        sincronizacion: p.estado === 'cotizando' ? 'no_aplica' as const : p.eventoCalendarioId ? 'conectado' as const : 'pendiente' as const,
      })),
      eventos: EVENTOS_DEMO.filter((e) => e.fechaFin >= desde && e.fecha <= hasta),
    });
  },
  async sincronizarCalendario() {
    for (const p of pedidos) if (!['cotizando', 'cancelado'].includes(p.estado)) p.eventoCalendarioId ??= 'demo';
    return pausa({ encolados: pedidos.length });
  },
  conexiones: () => pausa({
    whatsapp: { estado: 'modo_prueba' as const, webhook: 'https://rnr.antpath.mx/webhook/whatsapp' },
    claude: { estado: 'sin_configurar' as const, modelo: 'claude-sonnet-5-5' },
    openrouter: { estado: 'sin_configurar' as const, modelo: 'anthropic/claude-sonnet-5.5', permiteGuardarDatos: false },
    modelos: [],
    calendario: { estado: 'sin_configurar' as const, calendarioId: null, cuenta: null, error: null },
    login: { estado: 'conectado' as const },
    ultimoRespaldo: null,
  }),
  probarConexion: async () => ({ ok: false, error: 'En la vista previa no hay conexiones reales.' }),
  usuarios: () => pausa([{ id: 1, email: 'duena@ejemplo.mx', nombre: 'Dueño', rol: 'dueno' as const, activo: true }]),
  agregarUsuario: async () => undefined,
  quitarUsuario: async () => undefined,
  async publico(token) {
    const p = pedidos.find((x) => x.tokenPublico === token && x.tokenActivo);
    if (!p) throw new ApiError('Este link ya no está activo.', 404);
    return pausa({
      folio: p.folio, estado: p.estado, estadoEtiqueta: p.estado, enviado: Boolean(p.formularioRecibidoEn), negocio: AJUSTES.nombre_negocio,
      prellenado: { clienteNombre: p.clienteNombre, necesitaTelefono: false, fechaEvento: p.fechaEntrega, horaEvento: p.horaEvento, tipoEntrega: p.tipoEntrega, direccion: p.direccion },
      resumen: p.formularioRecibidoEn ? { fechaEntrega: p.fechaEntrega, totalPasteles: p.pasteles.length } : null,
      opciones: AJUSTES.formulario,
    });
  },
  async enviarPublico(token, b) {
    const p = pedidos.find((x) => x.tokenPublico === token)!;
    Object.assign(p, { clienteNombre: b.clienteNombre, fechaEntrega: b.fechaEvento, horaEvento: b.horaEvento, tipoEntrega: b.tipoEntrega, direccion: b.direccion ?? null, formularioRecibidoEn: ahora() });
    p.pasteles = b.pasteles.map((x, i) => pastel({ posicion: i, tipo: x.tipo, personas: x.personas, pan: x.pan, relleno: x.relleno, extras: x.extras, festejado: x.festejado ?? null, edad: x.edad ?? null, decoracion: x.descripcion ?? null }));
    p.pendientes = pendientes(p);
  },
  subirFotoPublica: async () => undefined,
};

export const DEMO_CONVERSACION = convId;
