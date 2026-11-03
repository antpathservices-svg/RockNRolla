import { useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ETIQUETA_ESTADO } from '@rnr/shared';
import type { PanelCtx } from '../App';
import type { EventoGoogle, PedidoCalendario } from '../api';
import { api, EstadoChip, hoy, Icono, useCarga, useToast } from '../ui';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MAX_EN_CELDA = 3;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fecha = (s: string) => new Date(`${s}T12:00:00Z`);
function sumarDias(s: string, n: number): string {
  const d = fecha(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Días que se ven en la cuadrícula del mes: de lunes a domingo, semanas completas. */
function cuadricula(mes: string): string[] {
  const primero = `${mes}-01`;
  const d = fecha(primero);
  const lunes = sumarDias(primero, -((d.getUTCDay() + 6) % 7));
  const ultimo = (() => { const x = fecha(primero); x.setUTCMonth(x.getUTCMonth() + 1, 0); return iso(x); })();
  const dias: string[] = [];
  for (let s = lunes; s <= ultimo || dias.length % 7 !== 0; s = sumarDias(s, 1)) dias.push(s);
  return dias;
}

function moverMes(mes: string, n: number): string {
  const d = fecha(`${mes}-01`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return iso(d).slice(0, 7);
}

type Item =
  | { tipo: 'pedido'; hora: string | null; p: PedidoCalendario }
  | { tipo: 'google'; hora: string | null; e: EventoGoogle };

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const horaTexto = (desde: string | null, hasta: string | null) => (desde ? (hasta ? `${desde}–${hasta}` : desde) : 'Todo el día');

export function Calendario() {
  const { usuario } = useOutletContext<PanelCtx>();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : hoy().slice(0, 7);
  const dia = params.get('dia') ?? (hoy().startsWith(mes) ? hoy() : `${mes}-01`);
  const verCotizaciones = params.get('cotizaciones') !== '0';
  const verGoogle = params.get('google') !== '0';
  const [fresco, setFresco] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);

  const dias = useMemo(() => cuadricula(mes), [mes]);
  const desde = dias[0];
  const hasta = dias[dias.length - 1];
  const vista = useCarga(() => api.calendario(desde, hasta, fresco > 0), [desde, hasta, fresco]);

  const set = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) if (v === null) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  /** Lo de cada día, ordenado: primero lo de todo el día, luego por hora. */
  const porDia = useMemo(() => {
    const m = new Map<string, Item[]>();
    const add = (d: string, it: Item) => { if (!m.has(d)) m.set(d, []); m.get(d)!.push(it); };
    for (const p of vista.data?.pedidos ?? []) {
      if (!p.fechaEntrega || (!verCotizaciones && p.estado === 'cotizando')) continue;
      add(p.fechaEntrega, { tipo: 'pedido', hora: p.horaDesde, p });
    }
    if (verGoogle) {
      for (const e of vista.data?.eventos ?? []) {
        for (let d = e.fecha < desde ? desde : e.fecha; d <= e.fechaFin && d <= hasta; d = sumarDias(d, 1)) {
          add(d, { tipo: 'google', hora: d === e.fecha ? e.horaDesde : null, e });
        }
      }
    }
    for (const l of m.values()) l.sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''));
    return m;
  }, [vista.data, verCotizaciones, verGoogle, desde, hasta]);

  const google = vista.data?.google;
  const pendientes = (vista.data?.pedidos ?? []).filter((p) => p.sincronizacion === 'pendiente').length;
  const [anio, numMes] = mes.split('-').map(Number);
  const delDia = porDia.get(dia) ?? [];
  const fd = fecha(dia);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await api.sincronizarCalendario(desde, hasta);
      toast(r.encolados ? `Enviando ${r.encolados} ${r.encolados === 1 ? 'pedido' : 'pedidos'} a Google Calendar.` : 'No hay pedidos aceptados en estas fechas.');
      // Google tarda unos segundos en reflejarlo
      setTimeout(() => setFresco((n) => n + 1), 4000);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <main className="contenido calendario">
      <div className="fila" style={{ gap: 12 }}>
        <h1>Calendario</h1>
        <div className="fila" style={{ marginLeft: 'auto', gap: 8 }}>
          <button type="button" className="btn" style={{ minWidth: 44, padding: 0 }} aria-label="Mes anterior" onClick={() => set({ mes: moverMes(mes, -1), dia: null })}>‹</button>
          <button type="button" className="btn" onClick={() => set({ mes: null, dia: null })}>Hoy</button>
          <button type="button" className="btn" style={{ minWidth: 44, padding: 0 }} aria-label="Mes siguiente" onClick={() => set({ mes: moverMes(mes, 1), dia: null })}>›</button>
        </div>
      </div>

      {google?.estado === 'conectado' && (
        <div className="aviso verde" role="status">
          <span>
            Sincronizado con Google Calendar. Los pedidos aceptados se agregan solos.
            {pendientes > 0 && <> <strong>{pendientes} {pendientes === 1 ? 'pedido aún no aparece' : 'pedidos aún no aparecen'} en Google.</strong></>}
          </span>
          <span className="fila" style={{ marginLeft: 'auto', gap: 6 }}>
            <button type="button" className="btn texto" style={{ color: 'var(--verde)' }} onClick={() => setFresco((n) => n + 1)} disabled={vista.cargando}>Actualizar</button>
            <button type="button" className="btn texto" style={{ color: 'var(--verde)' }} onClick={sincronizar} disabled={sincronizando}>
              {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            {usuario.rol === 'dueno' && (
              <a className="btn texto" style={{ color: 'var(--verde)' }} href={`https://calendar.google.com/calendar/r/month/${anio}/${numMes}/1`} target="_blank" rel="noreferrer">Abrir Google Calendar</a>
            )}
          </span>
        </div>
      )}
      {google?.estado === 'sin_configurar' && (
        <div className="aviso amarillo" role="status">
          <span>Por ahora solo se ven los pedidos. {usuario.rol === 'dueno' ? <>Conecta Google Calendar en <Link to="/configuracion">Configuración</Link> para ver aquí también tu agenda.</> : 'El dueño puede conectar Google Calendar en Configuración.'}</span>
        </div>
      )}
      {google?.estado === 'error' && (
        <div className="aviso rojo" role="alert"><Icono.alerta /><span>No se pudo leer Google Calendar: {google.error} Se muestran solo los pedidos.</span></div>
      )}
      {vista.error && <div className="aviso rojo" role="alert">{vista.error}</div>}

      <div className="fila" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 20 }}>{mayuscula(MESES[numMes - 1])} {anio}</h2>
        {vista.cargando && <span className="muted">Cargando…</span>}
        <div role="group" aria-label="Qué mostrar" className="fila" style={{ marginLeft: 'auto', gap: 8 }}>
          <button type="button" className="filtro" aria-pressed={verCotizaciones} onClick={() => set({ cotizaciones: verCotizaciones ? '0' : null })}>Cotizaciones</button>
          {google && google.estado !== 'sin_configurar' && (
            <button type="button" className="filtro" aria-pressed={verGoogle} onClick={() => set({ google: verGoogle ? '0' : null })}>Otros eventos de Google</button>
          )}
        </div>
      </div>

      <div className="cal-cuerpo">
        <div className="cal-mes" role="grid" aria-label={`${MESES[numMes - 1]} ${anio}`}>
          <div className="cal-fila cal-encabezado" role="row">
            {DIAS.map((d) => <div key={d} role="columnheader">{d}</div>)}
          </div>
          {Array.from({ length: dias.length / 7 }, (_, s) => (
            <div key={s} className="cal-fila" role="row">
              {dias.slice(s * 7, s * 7 + 7).map((d) => {
                const items = porDia.get(d) ?? [];
                const fuera = !d.startsWith(mes);
                const n = fecha(d).getUTCDate();
                return (
                  <button
                    key={d} type="button" role="gridcell"
                    className={['cal-dia', fuera && 'fuera', d === hoy() && 'hoy', d === dia && 'elegido'].filter(Boolean).join(' ')}
                    aria-selected={d === dia}
                    aria-label={`${DIAS_LARGOS[fecha(d).getUTCDay()]} ${n} de ${MESES[fecha(d).getUTCMonth()]}: ${items.length ? `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'}` : 'libre'}`}
                    onClick={() => set({ dia: d, ...(fuera ? { mes: d.slice(0, 7) } : {}) })}
                  >
                    <span className="num">{n}</span>
                    <span className="cal-items" aria-hidden="true">
                      {items.slice(0, MAX_EN_CELDA).map((it, i) => <Pastilla key={i} it={it} />)}
                      {items.length > MAX_EN_CELDA && <span className="cal-mas">+{items.length - MAX_EN_CELDA} más</span>}
                    </span>
                    {items.length > 0 && <span className="cal-puntos" aria-hidden="true">{items.slice(0, 4).map((it, i) => <i key={i} className={it.tipo === 'pedido' ? `p-${it.p.estado}` : 'g'} />)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <section className="tarjeta cal-detalle" aria-live="polite">
          <h2>{mayuscula(`${DIAS_LARGOS[fd.getUTCDay()]} ${fd.getUTCDate()} de ${MESES[fd.getUTCMonth()]}`)}</h2>
          {delDia.length === 0 && <p className="muted">Sin entregas ni eventos este día.</p>}
          <ul>
            {delDia.map((it, i) => it.tipo === 'pedido' ? (
              <li key={`p${i}`} className={`cal-li p-${it.p.estado}`}>
                <div className="hora">{horaTexto(it.p.horaDesde, it.p.horaHasta)}</div>
                <div style={{ minWidth: 0 }}>
                  <Link to={`/pedidos/${it.p.id}`} style={{ fontWeight: 600, color: 'var(--texto)' }}>
                    {it.p.folio} · {it.p.clienteNombre ?? 'Sin nombre'}
                  </Link>
                  <div className="small muted">
                    {[it.p.temas, it.p.personas ? `${it.p.personas} personas` : null, it.p.tipoEntrega === 'recoger' ? 'Recoge en sucursal' : it.p.direccion].filter(Boolean).join(' · ')}
                  </div>
                  <div className="fila" style={{ gap: 6, marginTop: 4 }}>
                    <EstadoChip estado={it.p.estado} />
                    {it.p.esPrueba && <span className="chip prueba">Prueba</span>}
                    {it.p.sincronizacion === 'conectado' && <span className="chip neutro">En Google Calendar</span>}
                    {it.p.sincronizacion === 'pendiente' && <span className="chip vencida">Aún no está en Google</span>}
                    {it.p.estado === 'cotizando' && <span className="small muted">Se agrega a Google al recibir el anticipo</span>}
                  </div>
                </div>
              </li>
            ) : (
              <li key={`g${i}`} className="cal-li g">
                <div className="hora">{it.hora ? horaTexto(it.e.horaDesde, it.e.horaHasta) : 'Todo el día'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{it.e.titulo}</div>
                  <div className="small muted">Google Calendar{it.e.ubicacion ? ` · ${it.e.ubicacion}` : ''}</div>
                  {it.e.enlace && <a className="small" href={it.e.enlace} target="_blank" rel="noreferrer">Abrir en Google Calendar</a>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="muted">
        Los colores siguen el estado del pedido ({(['cotizando', 'aceptado', 'en_preparacion', 'listo', 'completado'] as const).map((e) => ETIQUETA_ESTADO[e]).join(', ')}); en gris, otros eventos de tu calendario.
        Las cotizaciones se ven con borde punteado porque aún no están confirmadas.
      </p>
    </main>
  );
}

function Pastilla({ it }: { it: Item }) {
  if (it.tipo === 'pedido') {
    const t = [it.p.horaDesde, it.p.clienteNombre ?? it.p.folio].filter(Boolean).join(' ');
    return <span className={`cal-pill p-${it.p.estado}`}>{t}{it.p.sincronizacion === 'pendiente' ? ' ·' : ''}</span>;
  }
  return <span className="cal-pill g">{[it.hora, it.e.titulo].filter(Boolean).join(' ')}</span>;
}
