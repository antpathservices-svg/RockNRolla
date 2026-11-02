import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ESTADOS, ETIQUETA_ESTADO, SIGUIENTE_ESTADO, type Estado } from '@rnr/shared';
import type { PedidoFila } from '../api';
import { api, EstadoChip, fechaCorta, hoy, semaforo, useCarga, useDialogo, useToast } from '../ui';

const COLOR_BOTON: Partial<Record<Estado, string>> = {
  aceptado: 'var(--azul)', en_preparacion: 'var(--morado)', listo: 'var(--verde)', completado: 'var(--texto-2)',
};

function finDeSemana(): string {
  const d = new Date(`${hoy()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7);
  return d.toISOString().slice(0, 10);
}

export function Pedidos() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialogo = useDialogo();
  const estado =(params.get('estado') as Estado | null) ?? undefined;
  const semana = params.get('semana') === '1';
  const orden = (params.get('orden') as 'fecha' | 'estado' | null) ?? 'fecha';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [busqueda, setBusqueda] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const lista = useCarga(
    () => api.pedidos({ estado, q: busqueda || undefined, orden, ...(semana ? { desde: hoy(), hasta: finDeSemana() } : {}) }),
    [estado, busqueda, orden, semana],
  );

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  async function avanzar(p: PedidoFila, a: Estado) {
    let motivo: string | undefined;
    if (a === 'cancelado') {
      motivo = (await dialogo.pedirTexto(`Cancelar el pedido ${p.folio}`, '¿Por qué se cancela?', 'Cancelar pedido')) ?? undefined;
      if (!motivo?.trim()) return;
    }
    try {
      await api.cambiarEstado(p.id, a, motivo);
      toast(`${p.folio} ahora está en ${ETIQUETA_ESTADO[a]}.`);
      lista.recargar();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <main className="contenido">
      <div className="fila" style={{ gap: 12 }}>
        <h1>Pedidos</h1>
        {lista.data && <span className="muted" style={{ fontSize: 14 }}>{lista.data.length} {lista.data.length === 1 ? 'pedido' : 'pedidos'}</span>}
        <button type="button" className="btn primario" style={{ marginLeft: 'auto' }}
          onClick={async () => { const r = await api.crearPedido(); navigate(`/pedidos/${r.id}`); }}>
          + Nuevo pedido
        </button>
      </div>

      <div className="campo" style={{ maxWidth: 420 }}>
        <label htmlFor="buscar-pedido">Buscar por cliente, festejado o folio</label>
        <input id="buscar-pedido" type="search" placeholder="Ej.: Ana o 0012" value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value || null); }} />
      </div>

      <div role="group" aria-label="Filtrar pedidos" className="fila">
        <button type="button" className="filtro" aria-pressed={!estado} onClick={() => set('estado', null)}>Todos</button>
        {ESTADOS.map((e) => (
          <button key={e} type="button" className="filtro" aria-pressed={estado === e} onClick={() => set('estado', estado === e ? null : e)}>{ETIQUETA_ESTADO[e]}</button>
        ))}
        <span aria-hidden="true" style={{ width: 1, height: 24, background: 'var(--borde-input)' }} />
        <button type="button" className="filtro" aria-pressed={semana} onClick={() => set('semana', semana ? null : '1')}>Entregas de esta semana</button>
        <label htmlFor="orden" className="muted" style={{ marginLeft: 'auto' }}>Ordenar por</label>
        <select id="orden" style={{ width: 'auto' }} value={orden} onChange={(e) => set('orden', e.target.value === 'fecha' ? null : e.target.value)}>
          <option value="fecha">Fecha de entrega</option>
          <option value="estado">Estado</option>
        </select>
      </div>

      {lista.error && <div className="aviso rojo" role="alert">{lista.error}</div>}
      {lista.data && lista.data.length === 0 && <p className="muted">No hay pedidos con estos filtros.</p>}
      {lista.data && lista.data.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead>
              <tr><th>Folio</th><th>Entrega</th><th>Cliente y festejado</th><th>Tema</th><th>Estado</th><th>Cambiar a</th></tr>
            </thead>
            <tbody>
              {lista.data.map((p) => {
                const vencida = p.estado === 'cotizando' && Boolean(p.vigenciaHasta && p.vigenciaHasta < hoy());
                const s = vencida ? { color: '#9a9092', texto: 'Cotización vencida', tono: 'var(--gris)' } : semaforo(p.fechaEntrega, p.estado);
                const sig = SIGUIENTE_ESTADO[p.estado];
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.folio}{p.esPrueba && <div><span className="chip prueba">Prueba</span></div>}</td>
                    <td>
                      <div className="fila" style={{ flexWrap: 'nowrap' }}>
                        <span className="punto" style={{ background: s.color }} aria-hidden="true" />
                        <div>
                          <div style={{ fontWeight: 600 }}>{fechaCorta(p.fechaEntrega, p.horaDesde)}</div>
                          <div className="small" style={{ color: s.tono }}>{s.texto}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Link to={`/pedidos/${p.id}`} style={{ fontWeight: 600, color: 'var(--texto)' }}>{p.clienteNombre ?? 'Sin nombre'}</Link>
                      <div className="small muted">
                        {[p.festejados, p.totalPasteles > 1 ? `${p.totalPasteles} pasteles` : p.personas ? `${p.personas} personas` : null].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{p.temas ?? <span className="muted">Sin tema</span>}</td>
                    <td><EstadoChip estado={p.estado} vencida={vencida} /></td>
                    <td>
                      <div className="fila" style={{ flexWrap: 'nowrap' }}>
                        {vencida ? (
                          <button type="button" className="btn peligro" onClick={() => avanzar(p, 'cancelado')}>Cancelar</button>
                        ) : sig ? (
                          <button type="button" className="btn" style={{ borderColor: COLOR_BOTON[sig], color: COLOR_BOTON[sig], fontWeight: 600 }} onClick={() => avanzar(p, sig)}>
                            {sig === 'aceptado' ? 'Aceptado · anticipo recibido' : ETIQUETA_ESTADO[sig]}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Cada fecha lleva su texto (faltan días, mañana, venció); el punto de color solo lo refuerza. Toca el nombre del cliente para abrir el pedido.</p>
    </main>
  );
}
