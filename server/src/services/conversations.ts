import {
  guessRoles,
  maskBankData,
  parseChat,
  splitSegments,
  type ChatFormat,
  type ChatSegment,
  type Conversacion,
  type Mensaje,
} from '@rnr/shared';
import { tx, type Db } from '../db.js';
import { registrar } from './audit.js';

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

export function vistaPrevia(texto: string, nombreNegocio: string, pausaDias: number): VistaPrevia {
  const r = parseChat(texto);
  const reales = r.messages.filter((m) => m.kind !== 'sistema');
  let ocultos = 0;
  let conDatos = 0;
  for (const m of r.messages) {
    const c = maskBankData(m.text).count;
    ocultos += c;
    if (c) conDatos++;
  }
  return {
    formato: r.format,
    lineas: r.lineCount,
    mensajes: reales.length,
    adjuntos: reales.filter((m) => m.kind === 'adjunto' || m.kind === 'multimedia_omitida' || /<multimedia omitid/i.test(m.text)).length,
    autores: r.authors,
    propuesta: guessRoles(r.authors, nombreNegocio),
    tramos: splitSegments(r.messages, pausaDias),
    datosBancariosOcultos: ocultos,
    mensajesConDatosBancarios: conDatos,
  };
}

export interface ImportarInput {
  texto: string;
  origen: 'archivo' | 'texto';
  nombreArchivo?: string | null;
  /** Autor que es el cliente. Si no se manda, se usa la propuesta. */
  clienteAutor?: string | null;
  desdeIndice?: number | null;
  hastaIndice?: number | null;
}

export async function importarChat(db: Db, input: ImportarInput, nombreNegocio: string, usuario: string): Promise<string> {
  const r = parseChat(input.texto);
  if (r.messages.length === 0) throw new Error('No se encontraron mensajes en el texto.');
  const propuesta = guessRoles(r.authors, nombreNegocio);
  const cliente = input.clienteAutor ?? propuesta.cliente;
  const desde = input.desdeIndice ?? 0;
  const hasta = input.hastaIndice ?? Number.MAX_SAFE_INTEGER;
  const elegidos = r.messages.filter((m) => m.index >= desde && m.index <= hasta);
  if (elegidos.length === 0) throw new Error('El tramo elegido no tiene mensajes.');

  return tx(db, async (c) => {
    const ultimo = elegidos[elegidos.length - 1].sentAt;
    const { rows } = await c.query(
      `insert into conversaciones (origen, es_prueba, nombre_archivo, cliente_nombre, ultimo_mensaje)
       values ($1, true, $2, $3, $4) returning id`,
      [input.origen, input.nombreArchivo ?? null, cliente, ultimo],
    );
    const id: string = rows[0].id;
    for (const [i, m] of elegidos.entries()) {
      const rol = m.author == null ? 'sistema' : m.author === cliente ? 'cliente' : 'negocio';
      await c.query(
        `insert into mensajes (conversacion_id, indice, rol, autor, texto, tipo, adjunto_nombre, editado, enviado)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, i, rol, m.author, maskBankData(m.text).text, m.kind, m.attachmentName ?? null, m.edited, m.sentAt],
      );
    }
    await registrar(c, 'conversacion', id, 'importada', usuario, { origen: input.origen, mensajes: elegidos.length, formato: r.format });
    return id;
  });
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

export async function listarConversaciones(db: Db, q?: string): Promise<Conversacion[]> {
  const params: unknown[] = [];
  let where = '';
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where = `where lower(coalesce(c.cliente_nombre,'')) like $1 or coalesce(c.cliente_telefono,'') like $1`;
  }
  const { rows } = await db.query(
    `select c.*, ${LEYENDO} as leyendo,
       (select texto from mensajes m where m.conversacion_id = c.id and m.rol <> 'sistema' order by indice desc limit 1) as ultimo_texto,
       (select count(*)::int from mensajes m where m.conversacion_id = c.id and m.rol <> 'sistema') as total,
       p.id as pedido_id, p.estado as pedido_estado
     from conversaciones c
     left join lateral (select id, estado from pedidos where conversacion_id = c.id order by creado desc limit 1) p on true
     ${where}
     order by c.ultimo_mensaje desc nulls last
     limit 200`,
    params,
  );
  return rows.map((r) => aConversacion(r));
}

/** Una lectura sin terminar se considera abandonada después de 5 minutos (p. ej. si se reinició el servidor). */
export const MINUTOS_LECTURA = 5;
const LEYENDO = `(c.lectura_inicio is not null and c.lectura_inicio > now() - interval '${MINUTOS_LECTURA} minutes')`;

export class LecturaEnCurso extends Error {
  constructor() {
    super('Ya se está leyendo este chat con IA. El resultado aparece aquí en cuanto llegue.');
  }
}

/**
 * Marca la conversación como "leyendo" mientras corre `fn`. Si ya hay una lectura en curso,
 * lanza LecturaEnCurso sin llamar al modelo: así un doble clic o una recarga no pagan dos veces.
 */
export async function conLectura<T>(db: Db, id: string, tipo: 'resumen' | 'pedido', fn: () => Promise<T>): Promise<T> {
  const r = await db.query(
    `update conversaciones c set lectura_inicio = now(), lectura_tipo = $2, lectura_error = null
      where id = $1 and not ${LEYENDO} returning id`,
    [id, tipo],
  );
  if (!r.rowCount) throw new LecturaEnCurso();
  try {
    const res = await fn();
    await db.query('update conversaciones set lectura_inicio = null where id = $1', [id]);
    return res;
  } catch (e) {
    await db.query('update conversaciones set lectura_inicio = null, lectura_error = $2 where id = $1', [id, ((e as Error).message ?? 'Error').slice(0, 400)]);
    throw e;
  }
}

function aConversacion(r: Record<string, any>): Conversacion {
  return {
    id: r.id,
    origen: r.origen,
    esPrueba: r.es_prueba,
    clienteNombre: r.cliente_nombre,
    clienteTelefono: r.cliente_telefono,
    resumen: r.resumen,
    dudas: r.extraccion?.dudas?.map((d: any) => ({ campo: d.campo, motivo: d.motivo, mensajeIndice: d.mensaje_indice })) ?? [],
    ultimoMensaje: iso(r.ultimo_mensaje),
    ultimoTexto: r.ultimo_texto ?? null,
    totalMensajes: r.total ?? undefined,
    pedidoId: r.pedido_id ?? null,
    pedidoEstado: r.pedido_estado ?? null,
    lectura: r.leyendo ? { tipo: r.lectura_tipo, desde: iso(r.lectura_inicio)! } : null,
    lecturaError: r.lectura_error ?? null,
    creado: iso(r.creado)!,
  };
}

export async function getConversacion(db: Db, id: string): Promise<{ conversacion: Conversacion; mensajes: Mensaje[]; extraccion: unknown } | null> {
  const { rows } = await db.query(
    `select c.*, ${LEYENDO} as leyendo, p.id as pedido_id, p.estado as pedido_estado,
       (select count(*)::int from mensajes m where m.conversacion_id = c.id and m.rol <> 'sistema') as total
     from conversaciones c
     left join lateral (select id, estado from pedidos where conversacion_id = c.id order by creado desc limit 1) p on true
     where c.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const msgs = await db.query('select * from mensajes where conversacion_id = $1 order by indice', [id]);
  return {
    conversacion: aConversacion(rows[0]),
    extraccion: rows[0].extraccion,
    mensajes: msgs.rows.map((m) => ({
      id: Number(m.id),
      indice: m.indice,
      rol: m.rol,
      autor: m.autor,
      texto: m.texto,
      tipo: m.tipo,
      adjuntoNombre: m.adjunto_nombre,
      editado: m.editado,
      enviado: iso(m.enviado)!,
    })),
  };
}

export async function borrarConversacion(db: Db, id: string, usuario: string): Promise<boolean> {
  const r = await db.query('delete from conversaciones where id = $1 and es_prueba', [id]);
  if (r.rowCount) await registrar(db, 'conversacion', id, 'borrada', usuario);
  return Boolean(r.rowCount);
}
