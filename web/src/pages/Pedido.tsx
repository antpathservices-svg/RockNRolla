import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { PanelCtx } from '../App';
import { calcularMontos, ESTADOS, ETIQUETA_ESTADO, formatoPesos, parsePesos, type Estado, type Mensaje } from '@rnr/shared';
import { ApiError, type Ajustes, type PastelEditable, type PedidoDetalle } from '../api';
import { api, copiar, diaMensaje, EstadoChip, fechaCorta, horaMensaje, hoy, Icono, useCarga, useDialogo, useToast } from '../ui';

type Form = Omit<PedidoDetalle, 'pasteles'> & { pasteles: PastelEditable[] };

const CAMPO_DUDA: Record<string, string> = {
  fecha_entrega: 'fechaEntrega', hora_desde: 'hora', hora_hasta: 'hora', direccion: 'direccion',
  tipo_entrega: 'tipoEntrega', envio: 'envio', cliente_nombre: 'clienteNombre',
};

const pastelVacio = (): PastelEditable => ({
  tema: null, festejado: null, edad: null, personas: null, tipo: null, pan: null, relleno: null,
  cubierta: null, decoracion: null, extras: [], precioCentavos: null, precioConfirmado: false,
});

export function PedidoPage() {
  const { id } = useParams();
  const { usuario } = useOutletContext<PanelCtx>();
  const navigate = useNavigate();
  const [eliminando, setEliminando] = useState(false);
  const toast = useToast();
  const dialogo = useDialogo();
  const carga = useCarga(() => api.pedido(id!), [id]);
  const ajustes = useCarga(() => api.ajustes(), []);
  const chat = useCarga(
    () => (carga.data?.conversacionId ? api.conversacion(carga.data.conversacionId).then((c) => c.mensajes) : Promise.resolve([] as Mensaje[])),
    [carga.data?.conversacionId],
  );
  const [form, setForm] = useState<Form | null>(null);
  const [sucio, setSucio] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [linkCliente, setLinkCliente] = useState<string | null>(null);

  useEffect(() => {
    if (carga.data) {
      setForm({ ...carga.data, pasteles: carga.data.pasteles.map(({ id: _i, posicion: _p, ...x }) => x) });
      setSucio(false);
    }
  }, [carga.data]);

  // Avisar antes de salir con cambios sin guardar
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (sucio) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [sucio]);

  const montos = useMemo(() => form && calcularMontos({
    preciosCentavos: form.pasteles.map((p) => p.precioCentavos),
    envioCentavos: form.envioCentavos, descuentoCentavos: form.descuentoCentavos, anticipoPct: form.anticipoPct,
  }), [form]);

  if (carga.error) return <main className="contenido"><div className="aviso rojo">{carga.error}</div></main>;
  if (!form || !carga.data || !montos) return <main className="contenido"><div className="cargando">Cargando…</div></main>;
  const p = carga.data;
  const msgs = chat.data ?? [];

  const cambiar = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setSucio(true); };
  const cambiarPastel = (i: number, patch: Partial<PastelEditable>) =>
    cambiar({ pasteles: form.pasteles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const dudaDe = (campo: string) => form.dudas.find((d) => CAMPO_DUDA[d.campo] === campo || d.campo === campo);
  const citar = (indice: number | null | undefined) => {
    const m = indice != null ? msgs.find((x) => x.indice === indice) : undefined;
    return m ? `Del mensaje de ${horaMensaje(m.enviado)}: "${m.texto.slice(0, 90)}${m.texto.length > 90 ? '…' : ''}"` : null;
  };
  const fuente = (campo: string) => {
    const f = form.fuentes.find((x) => x.campo === campo);
    const m = f ? msgs.find((x) => x.indice === f.mensajeIndice) : undefined;
    return m ? `Mensaje del ${diaMensaje(m.enviado)}, ${horaMensaje(m.enviado)}` : null;
  };

  async function guardar(extra?: Partial<Form>): Promise<PedidoDetalle | null> {
    const datos = { ...form!, ...extra };
    setOcupado('guardar');
    try {
      const r = await api.actualizarPedido(p.id, {
        clienteNombre: datos.clienteNombre, clienteTelefono: datos.clienteTelefono, clienteTipo: datos.clienteTipo,
        origen: datos.origen, fechaEntrega: datos.fechaEntrega, horaEvento: datos.horaEvento, horaDesde: datos.horaDesde,
        horaHasta: datos.horaHasta, tipoEntrega: datos.tipoEntrega, direccion: datos.direccion,
        envioCentavos: datos.envioCentavos, descuentoCentavos: datos.descuentoCentavos, anticipoPct: datos.anticipoPct,
        cuentaAnticipo: datos.cuentaAnticipo, cuentaSaldo: datos.cuentaSaldo, dudas: datos.dudas, pasteles: datos.pasteles,
      });
      carga.setData(r);
      return r;
    } catch (e) {
      toast(e instanceof ApiError && e.data?.detalles ? `Revisa los datos: ${e.data.detalles[0]}` : (e as Error).message);
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarPrecio(i: number) {
    const pasteles = form!.pasteles.map((x, j) => (j === i ? { ...x, precioConfirmado: true } : x));
    const dudas = form!.dudas.filter((d) => !d.campo.startsWith(`pasteles[${i}].precio`));
    setForm({ ...form!, pasteles, dudas });
    await guardar({ pasteles, dudas });
  }

  async function aprobar() {
    if (sucio && !(await guardar())) return;
    setOcupado('aprobar');
    try {
      const r = await api.aprobar(p.id);
      toast(api.demo ? 'Aprobado. En la vista previa no se genera el PDF.' : `Nota versión ${r.version} lista.`);
      carga.recargar();
      if (r.url) window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      const pend = e instanceof ApiError ? e.data?.pendientes : null;
      toast(pend?.length ? pend[0] : (e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function eliminar() {
    if (!carga.data) return;
    const p = carga.data;
    const ok = await dialogo.confirmar(
      `¿Eliminar el pedido ${p.folio}?`,
      'Eliminar para siempre',
      `Se borran ${p.clienteNombre ? `el pedido de ${p.clienteNombre}` : 'el pedido'}, sus fotos y sus notas en PDF${p.eventoCalendarioId ? ', y su evento en Google Calendar' : ''}. No se puede deshacer.`,
    );
    if (!ok) return;
    setEliminando(true);
    try {
      const r = await api.eliminarPedido(p.id);
      setSucio(false);
      toast(r.avisoCalendario ? `Pedido ${r.folio} eliminado. ${r.avisoCalendario}` : `Pedido ${r.folio} eliminado.`);
      navigate('/pedidos', { replace: true });
    } catch (e) {
      toast((e as Error).message);
      setEliminando(false);
    }
  }

  async function cambiarEstado(e: Estado) {
    let motivo: string | undefined;
    if (e === 'cancelado') {
      motivo = (await dialogo.pedirTexto(`Cancelar el pedido ${p.folio}`, '¿Por qué se cancela?', 'Cancelar pedido')) ?? undefined;
      if (!motivo?.trim()) return;
    }
    try {
      await api.cambiarEstado(p.id, e, motivo);
      toast(`El pedido ahora está en ${ETIQUETA_ESTADO[e]}.`);
      carga.recargar();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function copiarLink() {
    const r = await api.generarLink(p.id);
    setLinkCliente(r.url);
    carga.recargar();
    if (api.demo) return; // en la vista previa se abre con el botón de abajo
    const ok = await copiar(r.url);
    toast(ok ? 'Link copiado. Pégalo en el chat del cliente.' : 'Selecciona el link y cópialo para mandarlo.');
  }

  const pendientes = sucio ? ['Guarda los cambios para revisar si ya se puede aprobar.'] : p.pendientes;
  const vencida = p.estado === 'cotizando' && Boolean(p.vigenciaHasta && p.vigenciaHasta < hoy());
  const dudasPrecio = form.pasteles.map((x, i) => !x.precioConfirmado && x.precioCentavos != null ? i : -1).filter((i) => i >= 0);
  const cuentas = ajustes.data?.cuentas_cobro ?? [];

  return (
    <main className="contenido">
      <div className="fila" style={{ gap: 12 }}>
        <Link to="/pedidos" style={{ fontSize: 14, textDecoration: 'none' }}>← Pedidos</Link>
        <h1 style={{ fontSize: 22 }}>Pedido {p.folio}{form.clienteNombre ? ` · ${form.clienteNombre}` : ''}</h1>
        <EstadoChip estado={p.estado} vencida={vencida} />
        {p.esPrueba && <span className="chip prueba">Prueba</span>}
        {p.estado === 'cotizando' && p.vigenciaHasta && <span className="muted" style={{ marginLeft: 'auto' }}>Vigencia: hasta el {fechaCorta(p.vigenciaHasta)}</span>}
        {p.conversacionId && <Link className="btn" to={`/conversaciones/${p.conversacionId}`}>Ver chat</Link>}
      </div>

      {p.formularioRecibidoEn && p.estado === 'cotizando' && (
        <div className="aviso verde" role="status">El cliente llenó el formulario. Revisa los datos y captura los precios.</div>
      )}
      {dudasPrecio.length > 0 && (
        <div className="aviso amarillo" role="status">
          <Icono.alerta />
          <div>
            Antes de aprobar, confirma {dudasPrecio.length === 1 ? 'el ' : 'estos: el '}
            {dudasPrecio.map((i, k) => (
              <span key={i}>{k > 0 && (k === dudasPrecio.length - 1 ? ' y el ' : ', el ')}<a href={`#precio-${i}`}>precio del pastel {i + 1}</a></span>
            ))}
            . {form.dudas.find((d) => d.campo.includes('precio'))?.motivo ?? ''}
          </div>
        </div>
      )}

      <div className="dos-col">
        <div className="principal">
          <section className="tarjeta grid2">
            <h2 className="col-completa">Cliente y entrega</h2>
            <Campo id="cliente" etiqueta="Cliente" duda={dudaDe('clienteNombre')} ayuda={fuente('cliente_nombre')}>
              <input id="cliente" value={form.clienteNombre ?? ''} onChange={(e) => cambiar({ clienteNombre: e.target.value })} />
            </Campo>
            <Campo id="tel" etiqueta="WhatsApp del cliente">
              <input id="tel" inputMode="tel" value={form.clienteTelefono ?? ''} onChange={(e) => cambiar({ clienteTelefono: e.target.value })} />
            </Campo>
            <fieldset className="campo col-completa" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="etiqueta" style={{ fontSize: 12, color: 'var(--gris)', padding: 0, marginBottom: 4 }}>Fecha y hora de entrega</legend>
              <div className="fila" style={{ gap: 6, maxWidth: 520 }}>
                <label htmlFor="fecha" className="sr">Fecha</label>
                <input id="fecha" type="date" value={form.fechaEntrega ?? ''} onChange={(e) => cambiar({ fechaEntrega: e.target.value || null })} style={{ flex: '1 1 140px' }} />
                <label htmlFor="desde" className="sr">Desde</label>
                <input id="desde" type="time" value={form.horaDesde ?? ''} onChange={(e) => cambiar({ horaDesde: e.target.value || null })} style={{ flex: '0 1 110px' }} />
                <label htmlFor="hasta" className="sr">Hasta</label>
                <input id="hasta" type="time" value={form.horaHasta ?? ''} onChange={(e) => cambiar({ horaHasta: e.target.value || null })} style={{ flex: '0 1 110px' }} />
              </div>
              <span className="ayuda">{dudaDe('fechaEntrega')?.motivo ?? fuente('fecha_entrega') ?? (form.horaEvento ? `El evento es a las ${form.horaEvento}` : '')}</span>
            </fieldset>
            <Campo id="entrega" etiqueta="Entrega">
              <select id="entrega" value={form.tipoEntrega ?? ''} onChange={(e) => cambiar({ tipoEntrega: (e.target.value || null) as Form['tipoEntrega'] })}>
                <option value="">Elegir</option>
                <option value="domicilio">A domicilio</option>
                <option value="recoger">Recoge en sucursal</option>
              </select>
            </Campo>
            {form.tipoEntrega !== 'recoger' && (
              <Campo id="dir" etiqueta="Dirección" duda={dudaDe('direccion')} ayuda={fuente('direccion')} completa>
                <input id="dir" value={form.direccion ?? ''} onChange={(e) => cambiar({ direccion: e.target.value })} />
              </Campo>
            )}
            <Campo id="origen" etiqueta="Origen del pedido" ayuda={!form.origen ? 'No viene en el chat' : null}>
              <select id="origen" value={form.origen ?? ''} onChange={(e) => cambiar({ origen: e.target.value || null })}>
                <option value="">Elegir</option>
                {ajustes.data?.origenes.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Campo>
            <Campo id="tipo-cli" etiqueta="Tipo de cliente">
              <select id="tipo-cli" value={form.clienteTipo ?? ''} onChange={(e) => cambiar({ clienteTipo: e.target.value || null })}>
                <option value="">Elegir</option><option>Nuevo</option><option>Recurrente</option>
              </select>
            </Campo>
          </section>

          {form.pasteles.map((x, i) => (
            <section key={i} className="tarjeta grid2">
              <div className="col-completa fila">
                <h2>Pastel {i + 1} de {form.pasteles.length}{x.tema ? ` · ${x.tema}` : ''}</h2>
                {form.pasteles.length > 1 && (
                  <button type="button" className="btn texto" style={{ marginLeft: 'auto' }}
                    onClick={async () => {
                      if (await dialogo.confirmar(`¿Quitar el pastel ${i + 1}?`, 'Quitar pastel', 'Se quita al guardar los cambios.')) cambiar({ pasteles: form.pasteles.filter((_, j) => j !== i) });
                    }}>Quitar pastel</button>
                )}
              </div>
              <Campo id={`tema-${i}`} etiqueta="Tema"><input id={`tema-${i}`} value={x.tema ?? ''} onChange={(e) => cambiarPastel(i, { tema: e.target.value })} /></Campo>
              <div className="grid2" style={{ gap: 8 }}>
                <Campo id={`fest-${i}`} etiqueta="Festejado"><input id={`fest-${i}`} value={x.festejado ?? ''} onChange={(e) => cambiarPastel(i, { festejado: e.target.value })} /></Campo>
                <Campo id={`edad-${i}`} etiqueta="Edad"><input id={`edad-${i}`} value={x.edad ?? ''} onChange={(e) => cambiarPastel(i, { edad: e.target.value })} /></Campo>
              </div>
              <div className="grid2" style={{ gap: 8 }}>
                <Campo id={`per-${i}`} etiqueta="Personas"><input id={`per-${i}`} type="number" inputMode="numeric" min={1} value={x.personas ?? ''} onChange={(e) => cambiarPastel(i, { personas: e.target.value ? Number(e.target.value) : null })} /></Campo>
                <Campo id={`tipo-${i}`} etiqueta="Tipo"><input id={`tipo-${i}`} list="tipos" value={x.tipo ?? ''} onChange={(e) => cambiarPastel(i, { tipo: e.target.value })} /></Campo>
              </div>
              <PrecioCampo i={i} x={x} duda={form.dudas.find((d) => d.campo.startsWith(`pasteles[${i}].precio`))} cita={citar}
                onCambio={(c) => cambiarPastel(i, { precioCentavos: c, precioConfirmado: false })} onConfirmar={() => confirmarPrecio(i)} ocupado={ocupado !== null} />
              <Campo id={`pan-${i}`} etiqueta="Pan"><input id={`pan-${i}`} list="panes" value={x.pan ?? ''} onChange={(e) => cambiarPastel(i, { pan: e.target.value })} /></Campo>
              <Campo id={`rel-${i}`} etiqueta="Relleno"><input id={`rel-${i}`} list="rellenos" value={x.relleno ?? ''} onChange={(e) => cambiarPastel(i, { relleno: e.target.value })} /></Campo>
              <Campo id={`cub-${i}`} etiqueta="Cubierta"><input id={`cub-${i}`} value={x.cubierta ?? ''} onChange={(e) => cambiarPastel(i, { cubierta: e.target.value })} /></Campo>
              <Campo id={`ext-${i}`} etiqueta="Extras (separados por coma)"><input id={`ext-${i}`} value={x.extras.join(', ')} onChange={(e) => cambiarPastel(i, { extras: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Campo>
              <Campo id={`dec-${i}`} etiqueta="Decoración" completa>
                <textarea id={`dec-${i}`} rows={2} value={x.decoracion ?? ''} onChange={(e) => cambiarPastel(i, { decoracion: e.target.value })} />
              </Campo>
            </section>
          ))}
          <button type="button" className="btn secundario" style={{ alignSelf: 'flex-start', borderStyle: 'dashed' }}
            onClick={() => cambiar({ pasteles: [...form.pasteles, pastelVacio()] })}>+ Agregar otro pastel</button>
          <Listas ajustes={ajustes.data} />
        </div>

        <aside className="lateral">
          <section className="costos" aria-label="Costos">
            <h2>Costos</h2>
            <div className="linea"><span>Pasteles ({form.pasteles.length})</span><strong>{formatoPesos(montos.costo)}</strong></div>
            <div className="linea">
              <label htmlFor="envio">Envío</label>
              <input id="envio" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} defaultValue={formatoPesos(form.envioCentavos)} key={`e${p.actualizado}`}
                onBlur={(e) => cambiar({ envioCentavos: parsePesos(e.target.value) ?? 0 })} />
            </div>
            <div className="linea">
              <label htmlFor="desc">Descuento</label>
              <input id="desc" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} defaultValue={formatoPesos(form.descuentoCentavos)} key={`d${p.actualizado}`}
                onBlur={(e) => cambiar({ descuentoCentavos: parsePesos(e.target.value) ?? 0 })} />
            </div>
            <div style={{ height: 1, background: '#e2cf86' }} />
            <div className="linea total"><span>Total</span><strong>{formatoPesos(montos.total)}</strong></div>
            <div className="linea"><span>Anticipo ({form.anticipoPct}% de los pasteles)</span><strong>{formatoPesos(montos.anticipo)}</strong></div>
            <div className="linea"><span>Saldo al recibir</span><strong>{formatoPesos(montos.saldo)}</strong></div>
            <div className="grid2" style={{ gap: 8 }}>
              <div className="campo">
                <label htmlFor="c-ant" style={{ color: 'var(--amarillo-texto)' }}>Cuenta del anticipo</label>
                <select id="c-ant" value={form.cuentaAnticipo ?? ''} onChange={(e) => cambiar({ cuentaAnticipo: e.target.value || null })}>
                  <option value="">Elegir</option>{cuentas.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="c-sal" style={{ color: 'var(--amarillo-texto)' }}>Cuenta del saldo</label>
                <select id="c-sal" value={form.cuentaSaldo ?? ''} onChange={(e) => cambiar({ cuentaSaldo: e.target.value || null })}>
                  <option value="">Elegir</option>{cuentas.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </section>

          <Referencias p={p} onCambio={carga.recargar} />

          {sucio && <button type="button" className="btn grande" disabled={ocupado !== null} onClick={() => guardar()}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar cambios'}</button>}
          {pendientes.length > 0 && <p id="aprobar-ayuda" className="small" style={{ color: '#6b4e00', fontWeight: 600 }}>{pendientes[0]}</p>}
          <button type="button" className="btn primario grande" aria-describedby={pendientes.length ? 'aprobar-ayuda' : undefined}
            disabled={ocupado !== null || (!sucio && p.pendientes.length > 0)} onClick={aprobar}>
            {ocupado === 'aprobar' ? 'Generando la nota…' : p.notas.length ? 'Aprobar y generar nueva versión' : 'Aprobar y generar nota'}
          </button>
          {p.notas.length > 0 && (
            <div className="tarjeta" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>Notas generadas</strong>
              {p.notas.slice().reverse().map((n) => (
                api.demo
                  ? <span key={n.version} className="small">Versión {n.version} (en la vista previa no hay PDF)</span>
                  : <a key={n.version} href={`/api/pedidos/${p.id}/notas/${n.version}`} target="_blank" rel="noopener" className="small">Versión {n.version} · PDF</a>
              ))}
              <button type="button" className="btn" onClick={async () => {
                try { await api.enviarNota(p.id); toast('Nota enviada por WhatsApp.'); } catch (e) { toast((e as Error).message); }
              }}>Enviar por WhatsApp</button>
            </div>
          )}
          {api.notaPreviewUrl(p.id) && <a className="small" href={api.notaPreviewUrl(p.id)!} target="_blank" rel="noopener">Ver cómo quedaría la nota (sin guardar)</a>}
          <p className="small muted">Al aprobar se genera el PDF con folio y vigencia. El evento del calendario se crea cuando el pedido pase a Aceptado.</p>

          <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>Estado</h2>
            <div className="fila">
              {ESTADOS.filter((e) => e !== p.estado && e !== 'cancelado').map((e) => (
                <button key={e} type="button" className="filtro" onClick={() => cambiarEstado(e)}>{ETIQUETA_ESTADO[e]}</button>
              ))}
            </div>
            {p.estado !== 'cancelado' && <button type="button" className="btn peligro" onClick={() => cambiarEstado('cancelado')}>Cancelar pedido</button>}
            {p.motivoCancelacion && <p className="small">Motivo de cancelación: {p.motivoCancelacion}</p>}
            {p.eventoCalendarioId && <p className="small muted">Está en el calendario.</p>}
          </section>

          <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>Link para el cliente</h2>
            <p className="small muted">{p.tokenActivo ? 'El link está activo.' : 'El cliente puede llenar su pedido desde su celular, sin crear cuenta.'}</p>
            {linkCliente && !api.demo && <input readOnly value={linkCliente} aria-label="Link del cliente" onFocus={(e) => e.target.select()} />}
            <button type="button" className="btn" onClick={copiarLink}>
              {api.demo ? (p.tokenActivo ? 'Generar link nuevo' : 'Generar link') : p.tokenActivo ? 'Generar link nuevo y copiar' : 'Generar y copiar link'}
            </button>
            {api.demo && p.tokenActivo && p.tokenPublico && (
              <Link className="btn secundario" to={`/p/${p.tokenPublico}`}>Abrir el formulario como cliente</Link>
            )}
            {p.tokenActivo && <button type="button" className="btn texto" style={{ alignSelf: 'flex-start' }}
              onClick={async () => { await api.desactivarLink(p.id); setLinkCliente(null); carga.recargar(); }}>Desactivar link</button>}
          </section>

          {usuario.rol === 'dueno' && (
            <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: '#e9c7c7' }}>
              <h2>Eliminar pedido</h2>
              <p className="small muted">
                Lo borra para siempre, con sus fotos, notas en PDF{p.eventoCalendarioId ? ' y su evento en Google Calendar' : ''}. La conversación se conserva.
                Si el pedido solo no se concretó, mejor cancélalo: así queda en el historial.
              </p>
              <button type="button" className="btn peligro" style={{ alignSelf: 'flex-start' }} disabled={eliminando} onClick={eliminar}>
                {eliminando ? 'Eliminando…' : 'Eliminar pedido'}
              </button>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function Campo({ id, etiqueta, children, duda, ayuda, completa }: { id: string; etiqueta: string; children: ReactNode; duda?: { motivo: string }; ayuda?: string | null; completa?: boolean }) {
  return (
    <div className={`campo ${duda ? 'duda' : ''} ${completa ? 'col-completa' : ''}`}>
      <label htmlFor={id}>{etiqueta}{duda ? ' · revisar' : ''}</label>
      {children}
      {(duda || ayuda) && <span className="ayuda">{duda?.motivo ?? ayuda}</span>}
    </div>
  );
}

function PrecioCampo({ i, x, duda, cita, onCambio, onConfirmar, ocupado }: {
  i: number; x: PastelEditable; duda?: { motivo: string; mensajeIndice?: number | null };
  cita: (n: number | null | undefined) => string | null; onCambio: (c: number | null) => void; onConfirmar: () => void; ocupado: boolean;
}) {
  const porConfirmar = x.precioCentavos != null && !x.precioConfirmado;
  return (
    <div className={`campo ${porConfirmar ? 'duda' : ''}`}>
      <label htmlFor={`precio-${i}`}>Precio{porConfirmar ? ' · por confirmar' : ''}</label>
      <div className="fila" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input id={`precio-${i}`} inputMode="decimal" aria-invalid={porConfirmar} aria-describedby={`precio-${i}-ayuda`}
          defaultValue={formatoPesos(x.precioCentavos)} key={`${x.precioCentavos}`} onBlur={(e) => {
            const v = parsePesos(e.target.value);
            if (v !== x.precioCentavos) onCambio(v);
          }} style={{ flex: 1, minWidth: 0 }} />
        {porConfirmar && <button type="button" className="btn" style={{ borderColor: '#6b4e00', color: '#6b4e00', fontWeight: 600 }} disabled={ocupado} onClick={onConfirmar}>Confirmar</button>}
      </div>
      <span id={`precio-${i}-ayuda`} className="ayuda">{porConfirmar ? (cita(duda?.mensajeIndice) ?? duda?.motivo ?? 'Confirma el precio antes de aprobar.') : x.precioCentavos == null ? 'Captura el precio de este pastel.' : 'Confirmado'}</span>
    </div>
  );
}

function Referencias({ p, onCambio }: { p: PedidoDetalle; onCambio: () => void }) {
  const toast = useToast();
  return (
    <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2>Referencias</h2>
      {p.referencias.length === 0 ? <p className="small muted">Sin fotos. La nota muestra hasta 2.</p> : (
        <div className="refs">{p.referencias.map((r, i) => <img key={r.id} src={r.url} alt={`Referencia ${i + 1}`} />)}</div>
      )}
      <label className="btn" style={{ cursor: 'pointer' }}>
        <Icono.camara /> Agregar foto
        <input type="file" accept="image/*" className="sr" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { await api.subirReferencia(p.id, f); onCambio(); } catch (err) { toast((err as Error).message); }
        }} />
      </label>
    </section>
  );
}

function Listas({ ajustes }: { ajustes: Ajustes | null }) {
  if (!ajustes) return null;
  return (
    <>
      <datalist id="tipos">{ajustes.formulario.tipos.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="panes">{ajustes.formulario.panes.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="rellenos">{ajustes.formulario.rellenos.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}
