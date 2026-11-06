import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ESTADOS,
  fechaMasDias,
  formatFolio,
  parsePesos,
  type Duda,
  type Estado,
  type Extraccion,
  type Fuente,
  type Pago,
  type Pastel,
  type Pedido,
} from '@rnr/shared';
import { tx, type Db } from '../db.js';
import { registrar } from './audit.js';
import { getAjustes } from './settings.js';

type Row = Record<string, any>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const hhmm = (v: string | null) => (v ? v.slice(0, 5) : null);

function rowToPastel(r: Row): Pastel {
  return {
    id: r.id,
    posicion: r.posicion,
    tema: r.tema,
    festejado: r.festejado,
    edad: r.edad,
    personas: r.personas,
    tipo: r.tipo,
    pan: r.pan,
    relleno: r.relleno,
    cubierta: r.cubierta,
    decoracion: r.decoracion,
    extras: r.extras ?? [],
    precioCentavos: r.precio_centavos,
    precioConfirmado: r.precio_confirmado,
  };
}

function rowToPago(r: Row): Pago {
  return {
    id: r.id,
    montoCentavos: r.monto_centavos,
    fecha: r.fecha,
    cuenta: r.cuenta,
    nota: r.nota,
    usuario: r.usuario,
    creado: iso(r.creado)!,
  };
}

function rowToPedido(r: Row, pasteles: Row[], notas: Row[], pagos: Row[] = []): Pedido {
  return {
    id: r.id,
    folio: r.folio,
    estado: r.estado,
    motivoCancelacion: r.motivo_cancelacion,
    conversacionId: r.conversacion_id,
    clienteNombre: r.cliente_nombre,
    clienteTelefono: r.cliente_telefono,
    clienteTipo: r.cliente_tipo,
    origen: r.origen,
    fechaEntrega: r.fecha_entrega,
    horaEvento: hhmm(r.hora_evento),
    horaDesde: hhmm(r.hora_desde),
    horaHasta: hhmm(r.hora_hasta),
    tipoEntrega: r.tipo_entrega,
    direccion: r.direccion,
    envioCentavos: r.envio_centavos,
    descuentoCentavos: r.descuento_centavos,
    anticipoPct: r.anticipo_pct,
    anticipoCentavos: r.anticipo_centavos,
    anticipoIncluyeEnvio: r.anticipo_incluye_envio,
    pagos: pagos.map(rowToPago),
    cuentaAnticipo: r.cuenta_anticipo,
    cuentaSaldo: r.cuenta_saldo,
    anticipoRecibidoEn: iso(r.anticipo_recibido_en),
    vigenciaHasta: r.vigencia_hasta,
    aprobadoEn: iso(r.aprobado_en),
    eventoCalendarioId: r.evento_calendario_id,
    tokenPublico: r.token_activo ? r.token_publico : null,
    tokenActivo: r.token_activo,
    formularioRecibidoEn: iso(r.formulario_recibido_en),
    esPrueba: r.es_prueba,
    dudas: r.dudas ?? [],
    fuentes: r.fuentes ?? [],
    pasteles: pasteles.map(rowToPastel),
    notas: notas.map((n) => ({ version: n.version, creado: iso(n.creado)! })),
    creado: iso(r.creado)!,
    actualizado: iso(r.actualizado)!,
  };
}

export async function getPedido(db: Pick<Db, 'query'>, id: string): Promise<Pedido | null> {
  const { rows } = await db.query('select * from pedidos where id = $1', [id]);
  if (!rows[0]) return null;
  const pasteles = (await db.query('select * from pasteles where pedido_id = $1 order by posicion', [id])).rows;
  const notas = (await db.query('select version, creado from notas where pedido_id = $1 order by version', [id])).rows;
  const pagos = (await db.query('select * from pagos where pedido_id = $1 order by fecha, creado', [id])).rows;
  return rowToPedido(rows[0], pasteles, notas, pagos);
}

export interface FiltrosPedidos {
  estado?: Estado;
  q?: string;
  desde?: string;
  hasta?: string;
  orden?: 'fecha' | 'estado';
}

export interface PedidoResumen {
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

export async function listPedidos(db: Db, f: FiltrosPedidos): Promise<PedidoResumen[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.estado) {
    params.push(f.estado);
    where.push(`p.estado = $${params.length}`);
  }
  if (f.desde) {
    params.push(f.desde);
    where.push(`p.fecha_entrega >= $${params.length}`);
  }
  if (f.hasta) {
    params.push(f.hasta);
    where.push(`p.fecha_entrega <= $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    const n = params.length;
    where.push(`(lower(coalesce(p.cliente_nombre,'')) like $${n} or lower(p.folio) like $${n}
      or exists (select 1 from pasteles x where x.pedido_id = p.id and (lower(coalesce(x.festejado,'')) like $${n} or lower(coalesce(x.tema,'')) like $${n})))`);
  }
  const orden =
    f.orden === 'estado'
      ? `array_position(array[${ESTADOS.map((e) => `'${e}'`).join(',')}]::text[], p.estado), p.fecha_entrega nulls last`
      : 'p.fecha_entrega nulls last, p.hora_desde nulls last';
  const { rows } = await db.query(
    `select p.id, p.folio, p.estado, p.cliente_nombre, p.fecha_entrega, p.hora_desde, p.tipo_entrega, p.vigencia_hasta,
            p.anticipo_recibido_en is not null as anticipo_recibido, p.es_prueba,
            count(x.id)::int as total_pasteles,
            string_agg(nullif(x.festejado, ''), ' y ' order by x.posicion) as festejados,
            string_agg(nullif(x.tema, ''), ' / ' order by x.posicion) as temas,
            sum(x.personas)::int as personas
       from pedidos p left join pasteles x on x.pedido_id = p.id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      group by p.id
      order by ${orden}
      limit 500`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    folio: r.folio,
    estado: r.estado,
    clienteNombre: r.cliente_nombre,
    fechaEntrega: r.fecha_entrega,
    horaDesde: hhmm(r.hora_desde),
    tipoEntrega: r.tipo_entrega,
    vigenciaHasta: r.vigencia_hasta,
    anticipoRecibido: r.anticipo_recibido,
    esPrueba: r.es_prueba,
    totalPasteles: r.total_pasteles,
    festejados: r.festejados,
    temas: r.temas,
    personas: r.personas,
  }));
}

// ---------- Datos editables del pedido ----------

const zHora = z.string().regex(/^\d{2}:\d{2}$/).nullable();
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const zTexto = z.string().trim().max(2000).nullable().transform((v) => (v === '' ? null : v));

export const zPastelInput = z.object({
  tema: zTexto.default(null),
  festejado: zTexto.default(null),
  edad: zTexto.default(null),
  personas: z.number().int().min(1).max(2000).nullable().default(null),
  tipo: zTexto.default(null),
  pan: zTexto.default(null),
  relleno: zTexto.default(null),
  cubierta: zTexto.default(null),
  decoracion: zTexto.default(null),
  extras: z.array(z.string().max(100)).max(20).default([]),
  precioCentavos: z.number().int().min(0).nullable().default(null),
  precioConfirmado: z.boolean().default(false),
});

export const zPedidoPatch = z
  .object({
    clienteNombre: zTexto,
    clienteTelefono: zTexto,
    clienteTipo: zTexto,
    origen: zTexto,
    fechaEntrega: zFecha,
    horaEvento: zHora,
    horaDesde: zHora,
    horaHasta: zHora,
    tipoEntrega: z.enum(['domicilio', 'recoger']).nullable(),
    direccion: zTexto,
    envioCentavos: z.number().int().min(0),
    descuentoCentavos: z.number().int().min(0),
    anticipoPct: z.number().min(0).max(100),
    anticipoCentavos: z.number().int().min(0).nullable(),
    anticipoIncluyeEnvio: z.boolean(),
    cuentaAnticipo: zTexto,
    cuentaSaldo: zTexto,
    dudas: z.array(z.object({ campo: z.string(), motivo: z.string(), mensajeIndice: z.number().int().nullable().optional() })),
    pasteles: z.array(zPastelInput).max(20),
  })
  .partial();

export type PedidoPatch = z.infer<typeof zPedidoPatch>;
export type PastelInput = z.infer<typeof zPastelInput>;

const COLUMNAS: Record<string, string> = {
  clienteNombre: 'cliente_nombre',
  clienteTelefono: 'cliente_telefono',
  clienteTipo: 'cliente_tipo',
  origen: 'origen',
  fechaEntrega: 'fecha_entrega',
  horaEvento: 'hora_evento',
  horaDesde: 'hora_desde',
  horaHasta: 'hora_hasta',
  tipoEntrega: 'tipo_entrega',
  direccion: 'direccion',
  envioCentavos: 'envio_centavos',
  descuentoCentavos: 'descuento_centavos',
  anticipoPct: 'anticipo_pct',
  anticipoCentavos: 'anticipo_centavos',
  anticipoIncluyeEnvio: 'anticipo_incluye_envio',
  cuentaAnticipo: 'cuenta_anticipo',
  cuentaSaldo: 'cuenta_saldo',
};

async function reemplazarPasteles(c: Pick<Db, 'query'>, pedidoId: string, pasteles: PastelInput[]) {
  await c.query('delete from pasteles where pedido_id = $1', [pedidoId]);
  for (const [i, p] of pasteles.entries()) {
    await c.query(
      `insert into pasteles (pedido_id, posicion, tema, festejado, edad, personas, tipo, pan, relleno, cubierta, decoracion, extras, precio_centavos, precio_confirmado)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [pedidoId, i, p.tema, p.festejado, p.edad, p.personas, p.tipo, p.pan, p.relleno, p.cubierta, p.decoracion, p.extras, p.precioCentavos, p.precioConfirmado],
    );
  }
}

export interface NuevoPedido extends PedidoPatch {
  conversacionId?: string | null;
  esPrueba?: boolean;
  extraccion?: Extraccion | null;
  fuentes?: Fuente[];
  anticipoRecibido?: boolean;
}

export async function crearPedido(db: Db, data: NuevoPedido, usuario: string | null): Promise<Pedido> {
  const ajustes = await getAjustes(db);
  const id = await tx(db, async (c) => {
    const { rows } = await c.query<{ n: string }>("select nextval('folio_seq') as n");
    const n = Number(rows[0].n);
    const folio = formatFolio(n);
    const ins = await c.query(
      `insert into pedidos (folio_num, folio, conversacion_id, es_prueba, cliente_nombre, cliente_telefono, cliente_tipo, origen,
         fecha_entrega, hora_desde, hora_hasta, tipo_entrega, direccion, envio_centavos, descuento_centavos, anticipo_pct,
         cuenta_anticipo, cuenta_saldo, vigencia_hasta, extraccion, dudas, fuentes, anticipo_recibido_en, hora_evento)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       returning id`,
      [
        n, folio, data.conversacionId ?? null, data.esPrueba ?? false,
        data.clienteNombre ?? null, data.clienteTelefono ?? null, data.clienteTipo ?? null, data.origen ?? null,
        data.fechaEntrega ?? null, data.horaDesde ?? null, data.horaHasta ?? null, data.tipoEntrega ?? null,
        data.direccion ?? null, data.envioCentavos ?? 0, data.descuentoCentavos ?? 0,
        data.anticipoPct ?? ajustes.anticipo_pct, data.cuentaAnticipo ?? null, data.cuentaSaldo ?? null,
        fechaMasDias(ajustes.vigencia_dias),
        data.extraccion ? JSON.stringify(data.extraccion) : null,
        JSON.stringify(data.dudas ?? []), JSON.stringify(data.fuentes ?? []),
        data.anticipoRecibido ? new Date() : null,
        data.horaEvento ?? null,
      ],
    );
    const pedidoId: string = ins.rows[0].id;
    await reemplazarPasteles(c, pedidoId, data.pasteles ?? [vacio()]);
    await registrar(c, 'pedido', pedidoId, 'creado', usuario, { folio });
    return pedidoId;
  });
  return (await getPedido(db, id))!;
}

export function vacio(): PastelInput {
  return zPastelInput.parse({});
}

export async function actualizarPedido(db: Db, id: string, patch: PedidoPatch, usuario: string | null): Promise<Pedido | null> {
  await tx(db, async (c) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(COLUMNAS)) {
      if (k in patch) {
        params.push((patch as Record<string, unknown>)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (patch.dudas) {
      params.push(JSON.stringify(patch.dudas));
      sets.push(`dudas = $${params.length}`);
    }
    sets.push('actualizado = now()');
    params.push(id);
    const r = await c.query(`update pedidos set ${sets.join(', ')} where id = $${params.length}`, params);
    if (r.rowCount === 0) return;
    if (patch.pasteles) await reemplazarPasteles(c, id, patch.pasteles);
    await registrar(c, 'pedido', id, 'editado', usuario, { campos: Object.keys(patch) });
  });
  return getPedido(db, id);
}

/** Por qué un pedido todavía no se puede aprobar. Lista vacía = se puede. */
export function pendientesParaAprobar(p: Pedido): string[] {
  const faltan: string[] = [];
  if (!p.clienteNombre) faltan.push('Falta el nombre del cliente.');
  if (!p.fechaEntrega) faltan.push('Falta la fecha de entrega.');
  if (p.tipoEntrega === 'domicilio' && !p.direccion) faltan.push('Falta la dirección de entrega.');
  if (p.pasteles.length === 0) faltan.push('El pedido no tiene pasteles.');
  p.pasteles.forEach((x, i) => {
    if (x.precioCentavos == null) faltan.push(`Falta el precio del pastel ${i + 1}.`);
    else if (!x.precioConfirmado) faltan.push(`Confirma el precio del pastel ${i + 1}.`);
  });
  return faltan;
}

export async function cambiarEstado(
  db: Db,
  id: string,
  estado: Estado,
  usuario: string | null,
  motivo?: string | null,
): Promise<{ antes: Estado; pedido: Pedido } | null> {
  return tx(db, async (c) => {
    const { rows } = await c.query('select estado from pedidos where id = $1 for update', [id]);
    if (!rows[0]) return null;
    const antes: Estado = rows[0].estado;
    if (estado === 'cancelado' && !motivo?.trim()) throw new ErrorDeNegocio('Escribe el motivo de la cancelación.');
    await c.query(
      `update pedidos set estado = $2,
         motivo_cancelacion = case when $2 = 'cancelado' then $3 else motivo_cancelacion end,
         anticipo_recibido_en = case when $2 = 'aceptado' and anticipo_recibido_en is null then now() else anticipo_recibido_en end,
         actualizado = now()
       where id = $1`,
      [id, estado, motivo ?? null],
    );
    await registrar(c, 'pedido', id, 'estado', usuario, { antes, despues: estado, motivo: motivo ?? undefined });
    return { antes, pedido: (await getPedido(c, id))! };
  });
}

export class ErrorDeNegocio extends Error {}

// ---------- Link público ----------

export async function generarLink(db: Db, id: string, dias: number, usuario: string | null): Promise<string | null> {
  const token = randomBytes(24).toString('base64url');
  const r = await db.query(
    `update pedidos set token_publico = $2, token_activo = true, token_expira = now() + ($3 || ' days')::interval, actualizado = now()
      where id = $1`,
    [id, token, String(dias)],
  );
  if (r.rowCount === 0) return null;
  await registrar(db, 'pedido', id, 'link_generado', usuario);
  return token;
}

/**
 * Borra el pedido para siempre: pasteles, fotos y notas se van en cascada; la conversación se
 * conserva (queda sin pedido) y el folio no se vuelve a usar. Devuelve los archivos a borrar
 * del disco, o null si no existía. La bitácora guarda quién lo borró y qué era.
 */
export async function eliminarPedido(db: Db, id: string, usuario: string): Promise<{ folio: string; archivos: string[] } | null> {
  return tx(db, async (c) => {
    const { rows } = await c.query<{ folio: string; estado: string; cliente_nombre: string | null; fecha_entrega: string | null }>(
      `select folio, estado, cliente_nombre, to_char(fecha_entrega, 'YYYY-MM-DD') as fecha_entrega from pedidos where id = $1 for update`,
      [id],
    );
    const p = rows[0];
    if (!p) return null;
    const archivos = await c.query<{ archivo: string }>(
      'select archivo from referencias where pedido_id = $1 union all select archivo from notas where pedido_id = $1',
      [id],
    );
    await c.query('delete from pedidos where id = $1', [id]);
    await registrar(c, 'pedido', id, 'pedido_eliminado', usuario, {
      folio: p.folio, estado: p.estado, cliente: p.cliente_nombre, fechaEntrega: p.fecha_entrega,
    });
    return { folio: p.folio, archivos: archivos.rows.map((r) => r.archivo) };
  });
}

export const zPagoInput = z.object({
  montoCentavos: z.number().int().positive('El pago debe ser mayor a cero.'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD'),
  cuenta: z.string().trim().max(120).nullish(),
  nota: z.string().trim().max(300).nullish(),
});

/** Registra un anticipo o pago. Devuelve null si el pedido no existe. */
export async function agregarPago(db: Db, pedidoId: string, input: z.infer<typeof zPagoInput>, usuario: string): Promise<Pago | null> {
  return tx(db, async (c) => {
    const ped = await c.query('select id from pedidos where id = $1 for update', [pedidoId]);
    if (!ped.rows[0]) return null;
    const { rows } = await c.query(
      'insert into pagos (pedido_id, monto_centavos, fecha, cuenta, nota, usuario) values ($1, $2, $3, $4, $5, $6) returning *',
      [pedidoId, input.montoCentavos, input.fecha, input.cuenta || null, input.nota || null, usuario],
    );
    await c.query('update pedidos set actualizado = now() where id = $1', [pedidoId]);
    await registrar(c, 'pedido', pedidoId, 'pago_registrado', usuario, { montoCentavos: input.montoCentavos, fecha: input.fecha, cuenta: input.cuenta ?? null });
    return rowToPago(rows[0]);
  });
}

export async function borrarPago(db: Db, pedidoId: string, pagoId: string, usuario: string): Promise<boolean> {
  return tx(db, async (c) => {
    const { rows } = await c.query('delete from pagos where id = $1 and pedido_id = $2 returning monto_centavos, fecha', [pagoId, pedidoId]);
    if (!rows[0]) return false;
    await c.query('update pedidos set actualizado = now() where id = $1', [pedidoId]);
    await registrar(c, 'pedido', pedidoId, 'pago_borrado', usuario, { montoCentavos: rows[0].monto_centavos, fecha: rows[0].fecha });
    return true;
  });
}

export async function desactivarLink(db: Db, id: string, usuario: string | null): Promise<void> {
  await db.query('update pedidos set token_activo = false, actualizado = now() where id = $1', [id]);
  await registrar(db, 'pedido', id, 'link_desactivado', usuario);
}

export async function pedidoPorToken(db: Db, token: string): Promise<Pedido | null> {
  const { rows } = await db.query(
    'select id from pedidos where token_publico = $1 and token_activo and (token_expira is null or token_expira > now())',
    [token],
  );
  return rows[0] ? getPedido(db, rows[0].id) : null;
}

// ---------- De la extracción al pedido ----------

const reFecha = /^\d{4}-\d{2}-\d{2}$/;
const reHora = /^([01]?\d|2[0-3]):[0-5]\d$/;
const vacioANull = (s: string) => (s.trim() === '' ? null : s.trim());
const hora = (s: string) => (reHora.test(s.trim()) ? s.trim().padStart(5, '0') : null);

/** Convierte la salida del modelo en datos del pedido y agrega dudas por lo que no pasa la validación. */
export function pedidoDesdeExtraccion(ext: Extraccion, hoy: string = new Date().toISOString().slice(0, 10)): NuevoPedido {
  const dudas: Duda[] = ext.dudas.map((d) => ({ campo: d.campo, motivo: d.motivo, mensajeIndice: d.mensaje_indice }));
  const fuentes: Fuente[] = ext.fuentes.map((f) => ({ campo: f.campo, mensajeIndice: f.mensaje_indice }));

  let fechaEntrega: string | null = null;
  if (ext.fecha_entrega.trim()) {
    if (reFecha.test(ext.fecha_entrega.trim()) && !Number.isNaN(Date.parse(ext.fecha_entrega))) {
      fechaEntrega = ext.fecha_entrega.trim();
      if (fechaEntrega < hoy) dudas.push({ campo: 'fecha_entrega', motivo: 'La fecha ya pasó; revisa el año.' });
    } else {
      dudas.push({ campo: 'fecha_entrega', motivo: `No se entendió la fecha "${ext.fecha_entrega}".` });
    }
  }

  const envio = parsePesos(ext.envio);
  if (ext.envio.trim() && envio == null) dudas.push({ campo: 'envio', motivo: `No se entendió el envío "${ext.envio}".` });

  const pasteles: PastelInput[] = ext.pasteles.map((p, i) => {
    const precio = parsePesos(p.precio);
    const personas = Number.parseInt(p.personas, 10);
    const dudaPrecio = dudas.some((d) => d.campo.startsWith(`pasteles[${i}].precio`));
    if (precio == null) dudas.push({ campo: `pasteles[${i}].precio`, motivo: 'Falta el precio de este pastel.' });
    return zPastelInput.parse({
      tema: vacioANull(p.tema),
      festejado: vacioANull(p.festejado),
      edad: vacioANull(p.edad),
      personas: Number.isFinite(personas) && personas > 0 ? personas : null,
      tipo: vacioANull(p.tipo),
      pan: vacioANull(p.pan),
      relleno: vacioANull(p.relleno),
      cubierta: vacioANull(p.cubierta),
      decoracion: vacioANull(p.decoracion),
      extras: p.extras.filter((e) => e.trim()),
      precioCentavos: precio,
      precioConfirmado: precio != null && !dudaPrecio,
    });
  });

  const tipo = ext.tipo_entrega === 'domicilio' || ext.tipo_entrega === 'recoger' ? ext.tipo_entrega : null;

  return {
    clienteNombre: vacioANull(ext.cliente_nombre),
    fechaEntrega,
    horaDesde: hora(ext.hora_desde),
    horaHasta: hora(ext.hora_hasta),
    tipoEntrega: tipo,
    direccion: vacioANull(ext.direccion),
    envioCentavos: envio ?? 0,
    pasteles: pasteles.length ? pasteles : [vacio()],
    dudas,
    fuentes,
    extraccion: ext,
    anticipoRecibido: ext.anticipo_recibido,
  };
}
