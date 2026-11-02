import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Mensaje } from '@rnr/shared';
import { api, copiar, diaMensaje, EstadoChip, horaMensaje, Icono, useCarga, useDialogo, useToast } from '../ui';

const ORIGEN: Record<string, string> = { archivo: 'archivo', texto: 'texto pegado', whatsapp: 'WhatsApp', formulario: 'formulario' };

export function Bandeja() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialogo = useDialogo();
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const lista = useCarga(() => api.conversaciones(busqueda || undefined), [busqueda]);
  const seleccion = id ?? lista.data?.[0]?.id;
  const detalle = useCarga(() => (seleccion ? api.conversacion(seleccion) : Promise.resolve(null)), [seleccion]);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const conv = detalle.data?.conversacion;

  async function accion(nombre: string, fn: () => Promise<void>) {
    setTrabajando(nombre);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <div className="bandeja">
      <section className="lista-conv" aria-label="Conversaciones">
        <div style={{ padding: '20px 16px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="fila" style={{ justifyContent: 'space-between' }}>
            <h1 style={{ fontSize: 20 }}>Bandeja</h1>
            <Link to="/prueba" className="btn secundario">+ Chat de prueba</Link>
          </div>
          <div className="campo">
            <label htmlFor="buscar">Buscar por cliente</label>
            <input id="buscar" type="search" placeholder="Nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {lista.error && <p className="aviso rojo" style={{ margin: 12 }}>{lista.error}</p>}
        {lista.data && lista.data.length === 0 && (
          <p className="muted" style={{ padding: '0 16px' }}>
            {busqueda ? 'Ningún chat coincide con la búsqueda.' : 'Todavía no hay chats. Carga uno de prueba para empezar.'}
          </p>
        )}
        <ul>
          {lista.data?.map((c) => (
            <li key={c.id}>
              <Link to={`/conversaciones/${c.id}`} aria-current={c.id === seleccion ? 'true' : undefined}>
                <div className="fila" style={{ flexWrap: 'nowrap' }}>
                  <strong style={{ fontSize: 14 }}>{c.clienteNombre ?? c.clienteTelefono ?? 'Sin nombre'}</strong>
                  <span className="muted small" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{c.ultimoMensaje ? horaMensaje(c.ultimoMensaje) : ''}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--texto-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ultimoTexto}</div>
                <div className="fila" style={{ gap: 6 }}>
                  {c.pedidoEstado ? <EstadoChip estado={c.pedidoEstado} /> : <span className="chip neutro">Sin pedido</span>}
                  {c.esPrueba && <span className="chip prueba">Prueba · {ORIGEN[c.origen]}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="chat" aria-label={conv ? `Chat con ${conv.clienteNombre ?? 'cliente'}` : 'Chat'}>
        {!conv ? (
          <div className="cargando">{detalle.error ?? (seleccion ? 'Cargando…' : 'Elige un chat.')}</div>
        ) : (
          <>
            <header>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{conv.clienteNombre ?? 'Sin nombre'}</div>
                <div className="muted small">{conv.totalMensajes} mensajes · {conv.esPrueba ? `cargado desde ${ORIGEN[conv.origen]}` : 'WhatsApp'}</div>
              </div>
              {conv.esPrueba && <span className="chip prueba" style={{ marginLeft: 'auto' }}>Prueba</span>}
            </header>
            <Mensajes mensajes={detalle.data!.mensajes} />
            <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid var(--borde)' }} className="muted">
              Las respuestas se siguen mandando desde la app de WhatsApp Business.
            </div>
          </>
        )}
      </section>

      {conv && (
        <aside className="panel-resumen" aria-label="Resumen del chat">
          <h2>Resumen</h2>
          {conv.resumen ? <p style={{ fontSize: 14, lineHeight: 1.5, color: '#3a3132' }}>{conv.resumen}</p> : (
            <>
              <p className="muted">Todavía no hay resumen de este chat.</p>
              <button type="button" className="btn" disabled={trabajando !== null}
                onClick={() => accion('resumen', async () => { await api.resumir(conv.id); detalle.recargar(); })}>
                {trabajando === 'resumen' ? 'Resumiendo…' : 'Resumir con IA'}
              </button>
            </>
          )}
          {conv.dudas.length > 0 && (
            <div className="aviso amarillo" style={{ flexDirection: 'column', gap: 4 }}>
              <strong>Por revisar</strong>
              {conv.dudas.slice(0, 3).map((d, i) => <span key={i}>{d.motivo}</span>)}
            </div>
          )}
          {conv.pedidoId ? (
            <Link to={`/pedidos/${conv.pedidoId}`} className="btn primario grande">Ver pedido</Link>
          ) : (
            <button type="button" className="btn primario grande" disabled={trabajando !== null}
              onClick={() => accion('pedido', async () => { const r = await api.pedidoDesdeConversacion(conv.id); navigate(`/pedidos/${r.id}`); })}>
              {trabajando === 'pedido' ? 'Leyendo el chat…' : 'Crear pedido borrador'}
            </button>
          )}
          <button type="button" className="btn" disabled={trabajando !== null}
            onClick={() => accion('link', async () => {
              const r = await api.linkDesdeConversacion(conv.id);
              if (api.demo) {
                // En la vista previa no hay servidor: el formulario del cliente se abre aquí mismo.
                navigate(r.url.slice(1));
                return;
              }
              const ok = await copiar(r.url);
              toast(ok ? 'Link copiado. Pégalo en el chat de WhatsApp del cliente.' : 'Link generado. Ábrelo desde el pedido para copiarlo.');
              navigate(`/pedidos/${r.pedidoId}`);
            })}>
            {api.demo ? 'Abrir el formulario del cliente' : 'Copiar link para que el cliente llene su pedido'}
          </button>
          {conv.esPrueba && (
            <button type="button" className="btn texto" style={{ alignSelf: 'flex-start' }}
              onClick={() => accion('borrar', async () => {
                if (!(await dialogo.confirmar('¿Borrar este chat de prueba?', 'Borrar chat', 'El pedido, si existe, se queda.'))) return;
                await api.borrarConversacion(conv.id); navigate('/'); lista.recargar();
              })}>
              Borrar chat de prueba
            </button>
          )}
        </aside>
      )}
    </div>
  );
}

function Mensajes({ mensajes }: { mensajes: Mensaje[] }) {
  const items = useMemo(() => {
    const out: Array<{ dia?: string; m?: Mensaje }> = [];
    let dia = '';
    for (const m of mensajes) {
      const d = diaMensaje(m.enviado);
      if (d !== dia) { out.push({ dia: d }); dia = d; }
      out.push({ m });
    }
    return out;
  }, [mensajes]);

  return (
    <div className="mensajes">
      {items.map((it, i) => it.dia ? <div key={`d${i}`} className="separador-dia">{it.dia}</div> : (
        <div key={it.m!.id} className={`burbuja ${it.m!.rol} ${it.m!.tipo !== 'texto' && it.m!.rol !== 'sistema' ? 'adjunto' : ''}`}>
          {it.m!.tipo === 'adjunto' || it.m!.tipo === 'multimedia_omitida' ? (
            <><Icono.foto /><span>{it.m!.adjuntoNombre ?? (it.m!.tipo === 'multimedia_omitida' ? 'Foto o video que no viene en el archivo' : 'Archivo')}</span></>
          ) : it.m!.texto}
          {it.m!.rol !== 'sistema' && <div className="hora">{it.m!.editado ? 'editado · ' : ''}{horaMensaje(it.m!.enviado)}</div>}
        </div>
      ))}
    </div>
  );
}
