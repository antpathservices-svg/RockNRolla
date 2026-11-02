import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ESTADOS, ETIQUETA_ESTADO_CLIENTE, type Estado } from '@rnr/shared';
import type { EnvioPublico, PublicoPedido } from '../api';
import { api, fechaCorta, Icono } from '../ui';
import logo from '../../public/logo.png';

/**
 * Link del cliente: cinco pantallas (Tu pedido, Tu pastel, Entrega, Resumen, Listo), una idea por
 * pantalla, sin crear cuenta. Lo llenado se guarda en el teléfono mientras se avanza.
 */

interface PastelForm { tipo: string; personas: number; pan: string; relleno: string; rellenoOtro: string; extras: string[]; festejado: string; edad: string; descripcion: string }
interface Borrador { paso: number; nombre: string; telefono: string; fecha: string; hora: string; entrega: '' | 'domicilio' | 'recoger'; direccion: string; pasteles: PastelForm[]; editando: number; privacidad: boolean }

const nuevoPastel = (): PastelForm => ({ tipo: '', personas: 20, pan: '', relleno: '', rellenoOtro: '', extras: [], festejado: '', edad: '', descripcion: '' });
const PASOS = ['Tu pedido', 'Tu pastel', 'Entrega', 'Resumen', 'Listo'];
const hoyLocal = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

function leer(token: string): Borrador | null {
  try { return JSON.parse(localStorage.getItem(`rnr-pedido-${token}`) ?? 'null'); } catch { return null; }
}
function guardar(token: string, b: Borrador) {
  try { localStorage.setItem(`rnr-pedido-${token}`, JSON.stringify(b)); } catch { /* sin almacenamiento: se sigue sin guardar */ }
}

export function Cliente() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<PublicoPedido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fotos, setFotos] = useState<File[]>([]);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  useEffect(() => {
    api.publico(token).then((d) => {
      setInfo(d);
      const prev = leer(token);
      setB(prev && !d.enviado ? prev : {
        paso: d.enviado ? 4 : 0,
        nombre: d.prellenado.clienteNombre ?? '', telefono: '', fecha: d.prellenado.fechaEvento ?? '', hora: d.prellenado.horaEvento ?? '',
        entrega: (d.prellenado.tipoEntrega as Borrador['entrega']) ?? '', direccion: d.prellenado.direccion ?? '',
        pasteles: [nuevoPastel()], editando: 0, privacidad: false,
      });
    }).catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => { if (b && b.paso < 4) guardar(token, b); }, [b, token]);

  const p = b ? b.pasteles[b.editando] : null;
  const faltan = useMemo(() => {
    if (!b || !info) return [];
    const f: string[] = [];
    if (b.paso === 0) {
      if (!b.nombre.trim()) f.push('tu nombre');
      if (info.prellenado.necesitaTelefono && !/\d{10}/.test(b.telefono.replace(/\D/g, ''))) f.push('tu WhatsApp');
      if (!b.fecha) f.push('la fecha');
      if (!b.hora) f.push('la hora');
    }
    if (b.paso === 1 && p) {
      if (!p.tipo) f.push('el tipo de pastel');
      if (!p.pan) f.push('el pan');
      if (!p.relleno || (p.relleno === 'Otro' && !p.rellenoOtro.trim())) f.push('el relleno');
    }
    if (b.paso === 2) {
      if (!b.entrega) f.push('cómo lo recibes');
      if (b.entrega === 'domicilio' && !b.direccion.trim()) f.push('la dirección');
    }
    if (b.paso === 3 && !b.privacidad) f.push('aceptar el aviso de privacidad');
    return f;
  }, [b, info, p]);

  if (error) return <Marco><main><div className="aviso rojo" role="alert">{error}</div></main></Marco>;
  if (!info || !b || !p) return <Marco><div className="cargando">Cargando…</div></Marco>;

  const set = (patch: Partial<Borrador>) => setB({ ...b, ...patch });
  const setP = (patch: Partial<PastelForm>) => set({ pasteles: b.pasteles.map((x, i) => (i === b.editando ? { ...x, ...patch } : x)) });
  const ir = (paso: number) => { set({ paso }); window.scrollTo(0, 0); };
  const op = info.opciones;

  async function enviar() {
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const body: EnvioPublico = {
        clienteNombre: b!.nombre.trim(),
        ...(b!.telefono ? { clienteTelefono: b!.telefono.trim() } : {}),
        fechaEvento: b!.fecha, horaEvento: b!.hora, tipoEntrega: b!.entrega as 'domicilio' | 'recoger',
        ...(b!.entrega === 'domicilio' ? { direccion: b!.direccion.trim() } : {}),
        aceptaPrivacidad: true,
        pasteles: b!.pasteles.map((x) => ({
          tipo: x.tipo, personas: x.personas, pan: x.pan, relleno: x.relleno === 'Otro' ? x.rellenoOtro.trim() : x.relleno,
          extras: x.extras, festejado: x.festejado || undefined, edad: x.edad || undefined, descripcion: x.descripcion || undefined,
        })),
      };
      await api.enviarPublico(token, body);
      for (const f of fotos) await api.subirFotoPublica(token, f).catch(() => undefined);
      try { localStorage.removeItem(`rnr-pedido-${token}`); } catch { /* nada */ }
      setInfo(await api.publico(token));
      ir(4);
    } catch (e) {
      setErrorEnvio((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const atras = b.paso > 0 && b.paso < 4 ? () => ir(b.paso === 3 ? 2 : b.paso - 1) : undefined;

  return (
    <Marco paso={b.paso} atras={atras}>
      {b.paso === 0 && (
        <main>
          <div><h1>Tu pedido</h1><p style={{ marginTop: 6, color: 'var(--texto-2)' }}>Son 3 pasos cortos. No necesitas crear cuenta.</p></div>
          <div className="campo"><label htmlFor="nombre" style={{ fontSize: 15, fontWeight: 700, color: 'var(--texto)' }}>¿A nombre de quién es el pedido?</label>
            <input id="nombre" autoComplete="name" value={b.nombre} onChange={(e) => set({ nombre: e.target.value })} /></div>
          {info.prellenado.necesitaTelefono && (
            <div className="campo"><label htmlFor="tel" style={{ fontSize: 15, fontWeight: 700, color: 'var(--texto)' }}>Tu WhatsApp</label>
              <input id="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="81 1234 5678" value={b.telefono} onChange={(e) => set({ telefono: e.target.value })} /></div>
          )}
          <div className="campo"><label htmlFor="fecha" style={{ fontSize: 15, fontWeight: 700, color: 'var(--texto)' }}>¿Qué día es tu evento?</label>
            <input id="fecha" type="date" min={hoyLocal()} value={b.fecha} onChange={(e) => set({ fecha: e.target.value })} /></div>
          <div className="campo"><label htmlFor="hora" style={{ fontSize: 15, fontWeight: 700, color: 'var(--texto)' }}>¿A qué hora es?</label>
            <input id="hora" type="time" value={b.hora} onChange={(e) => set({ hora: e.target.value })} /></div>
        </main>
      )}

      {b.paso === 1 && (
        <main>
          <div><h1>Tu pastel</h1><p style={{ marginTop: 6, color: 'var(--texto-2)' }}>Pastel {b.editando + 1}. Al final puedes agregar otro.</p></div>
          <Grupo titulo="¿Qué tipo de pastel quieres?" obligatorio sub="Elige 1">
            {op.tipos.map((t) => <label key={t} className="opcion">{t}<input type="radio" name="tipo" checked={p.tipo === t} onChange={() => setP({ tipo: t })} /></label>)}
          </Grupo>
          <div className="grupo" role="group" aria-labelledby="per-l">
            <div className="fila"><span id="per-l" style={{ fontWeight: 700, fontSize: 16 }}>¿Para cuántas personas?</span><span className="etq-obl">Obligatorio</span></div>
            <div className="fila" style={{ gap: 16 }}>
              <button type="button" className="btn" aria-label="Menos personas" style={{ width: 48, height: 48, borderRadius: '50%', fontSize: 22, padding: 0 }} onClick={() => setP({ personas: Math.max(1, p.personas - 5) })}>−</button>
              <input type="number" inputMode="numeric" min={1} aria-labelledby="per-l" value={p.personas} onChange={(e) => setP({ personas: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80, textAlign: 'center', fontSize: 22, fontWeight: 700 }} />
              <button type="button" className="btn" aria-label="Más personas" style={{ width: 48, height: 48, borderRadius: '50%', fontSize: 22, padding: 0 }} onClick={() => setP({ personas: p.personas + 5 })}>+</button>
            </div>
          </div>
          <Grupo titulo="¿De qué sabor quieres el pan?" obligatorio>
            <div className="fila">{op.panes.map((t) => <label key={t} className="pastilla"><input type="radio" name="pan" checked={p.pan === t} onChange={() => setP({ pan: t })} /> {t}</label>)}</div>
          </Grupo>
          <Grupo titulo="¿Y el relleno?" obligatorio>
            <div className="fila">{op.rellenos.map((t) => <label key={t} className="pastilla"><input type="radio" name="relleno" checked={p.relleno === t} onChange={() => setP({ relleno: t })} /> {t}</label>)}</div>
            {p.relleno === 'Otro' && <><label htmlFor="rel-otro" className="sr">¿Cuál relleno?</label><input id="rel-otro" placeholder="¿Cuál?" value={p.rellenoOtro} onChange={(e) => setP({ rellenoOtro: e.target.value })} /></>}
          </Grupo>
          <Grupo titulo="¿Quieres algún extra?" sub={`Elige hasta ${op.max_extras}`}>
            {op.extras.map((t) => {
              const marcado = p.extras.includes(t);
              return (
                <label key={t} className="opcion">{t}
                  <input type="checkbox" checked={marcado} disabled={!marcado && p.extras.length >= op.max_extras}
                    onChange={() => setP({ extras: marcado ? p.extras.filter((x) => x !== t) : [...p.extras, t] })} />
                </label>
              );
            })}
          </Grupo>
          <div className="grupo">
            <div className="fila"><span style={{ fontWeight: 700, fontSize: 16 }}>¿Para quién es?</span><span className="etq-opc">Opcional</span></div>
            <div className="grid2" style={{ gap: 8, gridTemplateColumns: '2fr 1fr' }}>
              <div className="campo"><label htmlFor="fest">Nombre</label><input id="fest" value={p.festejado} onChange={(e) => setP({ festejado: e.target.value })} /></div>
              <div className="campo"><label htmlFor="edad">Edad</label><input id="edad" inputMode="numeric" value={p.edad} onChange={(e) => setP({ edad: e.target.value })} /></div>
            </div>
          </div>
          <div className="campo">
            <label htmlFor="imagina" style={{ fontWeight: 700, fontSize: 16, color: 'var(--texto)' }}>Cuéntanos cómo lo imaginas <span className="etq-opc" style={{ marginLeft: 6 }}>Opcional</span></label>
            <span id="imagina-ayuda" className="ayuda" style={{ fontSize: 13 }}>Tema, colores, nombre y edad del festejado, y la frase.</span>
            <textarea id="imagina" rows={3} aria-describedby="imagina-ayuda" placeholder="Ej.: Cars, para Nico, 4 años; que diga Feliz cumple" value={p.descripcion} onChange={(e) => setP({ descripcion: e.target.value })} />
          </div>
          <div className="grupo">
            <div className="fila"><span style={{ fontWeight: 700, fontSize: 16 }}>Fotos de ejemplo</span><span className="etq-opc">Opcional</span></div>
            <label className="btn secundario" style={{ borderStyle: 'dashed', minHeight: 56, cursor: 'pointer' }}>
              <Icono.camara /> {fotos.length ? `${fotos.length} de 3 fotos elegidas` : 'Subir hasta 3 fotos'}
              <input type="file" accept="image/*" multiple className="sr" onChange={(e) => setFotos([...fotos, ...Array.from(e.target.files ?? [])].slice(0, 3))} />
            </label>
          </div>
        </main>
      )}

      {b.paso === 2 && (
        <main>
          <h1>Entrega</h1>
          <Grupo titulo="¿Cómo lo recibes?" obligatorio>
            <label className="opcion">Envío a domicilio<input type="radio" name="entrega" checked={b.entrega === 'domicilio'} onChange={() => set({ entrega: 'domicilio' })} /></label>
            <label className="opcion">Paso por él<input type="radio" name="entrega" checked={b.entrega === 'recoger'} onChange={() => set({ entrega: 'recoger' })} /></label>
          </Grupo>
          {b.entrega === 'domicilio' && (
            <div className="campo">
              <label htmlFor="dir" style={{ fontSize: 15, fontWeight: 700, color: 'var(--texto)' }}>¿A dónde lo llevamos?</label>
              <span className="ayuda" style={{ fontSize: 13 }}>Calle y número, colonia y entre qué calles.</span>
              <textarea id="dir" rows={3} autoComplete="street-address" value={b.direccion} onChange={(e) => set({ direccion: e.target.value })} />
              <span className="ayuda" style={{ fontSize: 13 }}>El costo del envío te lo confirmamos por WhatsApp.</span>
            </div>
          )}
        </main>
      )}

      {b.paso === 3 && (
        <main>
          <h1>Revisa tu pedido</h1>
          <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>Evento</div>
            <div style={{ fontWeight: 600 }}>{fechaCorta(b.fecha, b.hora)}</div>
            <div style={{ fontSize: 14, color: 'var(--texto-2)' }}>{b.entrega === 'domicilio' ? `Envío a domicilio · ${b.direccion}` : 'Paso por él'}</div>
            <button type="button" className="btn texto" style={{ alignSelf: 'flex-start', color: 'var(--rosa)', paddingLeft: 0 }} onClick={() => ir(0)}>Editar</button>
          </section>
          <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>{b.pasteles.length} {b.pasteles.length === 1 ? 'pastel' : 'pasteles'}</div>
          {b.pasteles.map((x, i) => (
            <section key={i} className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600 }}>Pastel {i + 1} · {x.tipo} · {x.personas} personas</div>
              <div style={{ fontSize: 14, color: 'var(--texto-2)' }}>{x.pan} con {x.relleno === 'Otro' ? x.rellenoOtro : x.relleno}{x.extras.length ? ` · ${x.extras.join(', ')}` : ''}</div>
              {x.descripcion && <div style={{ fontSize: 14, color: 'var(--texto-2)' }}>{x.descripcion}</div>}
              <div className="fila">
                <button type="button" className="btn texto" style={{ color: 'var(--rosa)', paddingLeft: 0 }} onClick={() => { set({ editando: i, paso: 1 }); window.scrollTo(0, 0); }}>Editar</button>
                {b.pasteles.length > 1 && <button type="button" className="btn texto" onClick={() => set({ pasteles: b.pasteles.filter((_, j) => j !== i), editando: 0 })}>Quitar</button>}
              </div>
            </section>
          ))}
          <button type="button" className="btn secundario grande" style={{ borderStyle: 'dashed' }}
            onClick={() => { set({ pasteles: [...b.pasteles, nuevoPastel()], editando: b.pasteles.length, paso: 1 }); window.scrollTo(0, 0); }}>+ Agregar otro pastel</button>
          <div className="aviso amarillo">{op.aviso}</div>
          <label className="fila" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', minHeight: 44, fontSize: 14 }}>
            <input type="checkbox" checked={b.privacidad} onChange={(e) => set({ privacidad: e.target.checked })} style={{ width: 22, height: 22, flex: 'none' }} />
            <span>Acepto el {op.aviso_privacidad_url ? <a href={op.aviso_privacidad_url} target="_blank" rel="noopener">aviso de privacidad</a> : 'aviso de privacidad'}.</span>
          </label>
          {errorEnvio && <div className="aviso rojo" role="alert">{errorEnvio}</div>}
        </main>
      )}

      {b.paso === 4 && <Listo info={info} />}

      {b.paso < 4 && (
        <footer>
          <span className="small" style={{ textAlign: 'center', color: faltan.length ? 'var(--gris)' : '#2f6b36' }}>
            {faltan.length ? `Falta: ${faltan.join(', ')}` : b.paso === 3 ? 'Todo listo para enviar' : 'Listo: completaste lo obligatorio'}
          </span>
          <button type="button" className="btn primario grande bloque" disabled={faltan.length > 0 || enviando}
            onClick={() => (b.paso === 3 ? enviar() : b.paso === 1 ? ir(b.pasteles.length > 1 ? 3 : 2) : ir(b.paso + 1))}>
            {b.paso === 3 ? (enviando ? 'Enviando…' : 'Enviar pedido') : b.paso === 1 ? 'Agregar pastel' : 'Continuar'}
          </button>
        </footer>
      )}
    </Marco>
  );
}

function Marco({ children, paso, atras }: { children: React.ReactNode; paso?: number; atras?: () => void }) {
  return (
    <div className="form-cliente">
      <header>
        <div className="fila" style={{ flexWrap: 'nowrap' }}>
          {atras && <button type="button" className="btn" aria-label="Regresar" onClick={atras} style={{ border: 0, padding: 0, width: 44, marginLeft: -12 }}><Icono.atras /></button>}
          <img src={logo} alt="" width={32} height={32} />
          <span style={{ fontFamily: 'var(--fuente-marca)', fontWeight: 700, fontSize: 15 }}>Rock N Rolla Cakes</span>
          {paso != null && paso < 4 && <span className="muted small" style={{ marginLeft: 'auto' }}>Paso {paso + 1} de 4</span>}
        </div>
        {api.demo && <Link to="/pedidos" className="small">← Vista previa: volver al panel</Link>}
        {paso != null && paso < 4 && <div className="avance" aria-hidden="true"><div style={{ width: `${((paso + 1) / 4) * 100}%` }} /></div>}
      </header>
      {children}
    </div>
  );
}

function Grupo({ titulo, obligatorio, sub, children }: { titulo: string; obligatorio?: boolean; sub?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grupo">
      <legend>{titulo}<span className={obligatorio ? 'etq-obl' : 'etq-opc'}>{obligatorio ? 'Obligatorio' : 'Opcional'}</span></legend>
      {sub && <span className="muted" style={{ marginTop: -4 }}>{sub}</span>}
      {children}
    </fieldset>
  );
}

function Listo({ info }: { info: PublicoPedido }) {
  const pasos: Estado[] = ESTADOS.filter((e) => e !== 'cancelado');
  const actual = pasos.indexOf(info.estado);
  return (
    <>
      <main>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--verde-claro)', color: 'var(--verde)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icono.ok /></div>
          <h1>{info.estado === 'cancelado' ? 'Pedido cancelado' : 'Recibimos tu pedido'}</h1>
          <p style={{ color: 'var(--texto-2)' }}>Te escribimos por WhatsApp con el precio y los datos para el anticipo. Guarda este link para ver cómo va tu pedido.</p>
        </div>
        <section className="tarjeta"><div className="small muted">Pedido {info.folio}</div>
          {info.resumen && <div style={{ fontWeight: 600 }}>{info.resumen.totalPasteles} {info.resumen.totalPasteles === 1 ? 'pastel' : 'pasteles'}{info.resumen.fechaEntrega ? ` · ${fechaCorta(info.resumen.fechaEntrega)}` : ''}</div>}
        </section>
        {info.estado !== 'cancelado' && (
          <ol aria-label="Estado del pedido" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {pasos.map((e, i) => (
              <li key={e} className={`paso-estado ${i <= actual ? 'hecho' : ''}`} aria-current={i === actual ? 'step' : undefined}>
                <div className="linea"><span className="circulo" />{i < pasos.length - 1 && <span className="barra" />}</div>
                <div style={{ fontSize: 15, fontWeight: i === actual ? 600 : 400, color: i <= actual ? 'var(--texto)' : 'var(--texto-2)' }}>
                  {ETIQUETA_ESTADO_CLIENTE[e]} {i === actual && <span className="chip" style={{ background: 'var(--rosa-claro)', color: 'var(--rosa-hover)', marginLeft: 4 }}>Ahora</span>}
                  {e === 'aceptado' && i > actual && <div className="small muted">Cuando recibamos tu anticipo</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
      <footer><a className="btn grande bloque" href="https://wa.me/528117101907">Escribir por WhatsApp</a></footer>
    </>
  );
}
