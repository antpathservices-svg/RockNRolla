import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { PanelCtx } from '../App';
import type { Ajustes, Conexiones } from '../api';
import { api, useCarga, useDialogo, useToast } from '../ui';

const ESTADO_CON: Record<string, { texto: string; clase: string }> = {
  conectado: { texto: 'Configurado', clase: 'listo' },
  sin_configurar: { texto: 'Sin configurar', clase: 'cancelado' },
  modo_prueba: { texto: 'Modo prueba', clase: 'cotizando' },
  error: { texto: 'Con error', clase: 'cancelado' },
};

export function Configuracion() {
  const { usuario } = useOutletContext<PanelCtx>();
  const esDueno = usuario.rol === 'dueno';
  const toast = useToast();
  const dialogo = useDialogo();
  const con = useCarga(() => api.conexiones(), []);
  const aj = useCarga(() => api.ajustes(), []);
  const usuarios = useCarga(() => (esDueno ? api.usuarios() : Promise.resolve([])), [esDueno]);
  const [form, setForm] = useState<Ajustes | null>(null);
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [nuevoRol, setNuevoRol] = useState<'operador' | 'dueno'>('operador');
  const [probando, setProbando] = useState<string | null>(null);

  useEffect(() => { if (aj.data) setForm(aj.data); }, [aj.data]);

  async function probar(nombre: string) {
    setProbando(nombre);
    const r = await api.probarConexion(nombre).catch((e: Error) => ({ ok: false, error: e.message }));
    setProbando(null);
    toast(r.ok ? 'La conexión funciona.' : `No funcionó: ${r.error}`);
  }

  async function guardar() {
    if (!form) return;
    try {
      const patch: Partial<Ajustes> = esDueno
        ? { vigencia_dias: form.vigencia_dias, anticipo_pct: form.anticipo_pct, nota: form.nota, formulario: form.formulario, cuentas_cobro: form.cuentas_cobro, origenes: form.origenes }
        : { nota: form.nota, formulario: form.formulario };
      aj.setData(await api.guardarAjustes(patch));
      toast('Cambios guardados. Aplican a las notas nuevas.');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const lista = (v: string[]) => v.join('\n');
  const deLista = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <main className="contenido" style={{ maxWidth: 1040 }}>
      <h1>Configuración</h1>

      {esDueno && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Conexiones</h2>
          <p className="muted">Las claves las instala Antpath en el servidor. Aquí solo se ve su estado; nunca se muestran.</p>
          {con.data && <ConexionesGrid c={con.data} probando={probando} onProbar={probar} />}
        </section>
      )}

      {form && (
        <section className="tarjeta grid3">
          <h2 className="col-completa">Cotización y nota</h2>
          {esDueno && (
            <>
              <div className="campo">
                <label htmlFor="c-vig">Vigencia de la cotización</label>
                <div className="fila" style={{ flexWrap: 'nowrap' }}>
                  <input id="c-vig" type="number" inputMode="numeric" min={1} style={{ width: 90 }} value={form.vigencia_dias} onChange={(e) => setForm({ ...form, vigencia_dias: Number(e.target.value) })} /><span>días</span>
                </div>
              </div>
              <div className="campo">
                <label htmlFor="c-ant">Anticipo</label>
                <div className="fila" style={{ flexWrap: 'nowrap' }}>
                  <input id="c-ant" type="number" inputMode="numeric" min={0} max={100} style={{ width: 90 }} value={form.anticipo_pct} onChange={(e) => setForm({ ...form, anticipo_pct: Number(e.target.value) })} /><span>% de los pasteles</span>
                </div>
                <span className="ayuda">El envío se cobra con el saldo</span>
              </div>
              <div className="campo">
                <label htmlFor="c-cuentas">Cuentas de cobro (una por línea)</label>
                <textarea id="c-cuentas" rows={3} value={lista(form.cuentas_cobro)} onChange={(e) => setForm({ ...form, cuentas_cobro: deLista(e.target.value) })} />
              </div>
            </>
          )}
          <div className="campo col-completa">
            <label htmlFor="c-gracias">Texto del pie de la nota</label>
            <input id="c-gracias" value={form.nota.agradecimiento} onChange={(e) => setForm({ ...form, nota: { ...form.nota, agradecimiento: e.target.value } })} />
          </div>
          <div className="campo col-completa">
            <label htmlFor="c-contacto">Datos de contacto de la nota (uno por línea)</label>
            <textarea id="c-contacto" rows={2} value={lista(form.nota.contacto)} onChange={(e) => setForm({ ...form, nota: { ...form.nota, contacto: deLista(e.target.value) } })} />
          </div>

          <h2 className="col-completa" style={{ marginTop: 8 }}>Opciones del formulario del cliente (una por línea)</h2>
          {(['tipos', 'panes', 'rellenos', 'extras'] as const).map((k) => (
            <div className="campo" key={k}>
              <label htmlFor={`f-${k}`}>{{ tipos: 'Tipos de pastel', panes: 'Sabores de pan', rellenos: 'Rellenos', extras: 'Extras' }[k]}</label>
              <textarea id={`f-${k}`} rows={6} value={lista(form.formulario[k])} onChange={(e) => setForm({ ...form, formulario: { ...form.formulario, [k]: deLista(e.target.value) } })} />
            </div>
          ))}
          {esDueno && (
            <div className="campo">
              <label htmlFor="f-origen">Origen del pedido</label>
              <textarea id="f-origen" rows={6} value={lista(form.origenes)} onChange={(e) => setForm({ ...form, origenes: deLista(e.target.value) })} />
            </div>
          )}
          <div className="campo col-completa">
            <label htmlFor="f-aviso">Aviso antes de enviar el pedido</label>
            <textarea id="f-aviso" rows={2} value={form.formulario.aviso} onChange={(e) => setForm({ ...form, formulario: { ...form.formulario, aviso: e.target.value } })} />
          </div>
          <div className="col-completa fila">
            <button type="button" className="btn primario" onClick={guardar}>Guardar cambios</button>
            <span className="muted small">Aplica a las notas nuevas</span>
          </div>
        </section>
      )}

      {esDueno && (
        <section className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Personas con acceso</h2>
          {usuarios.data?.filter((u) => u.activo).map((u) => (
            <div key={u.id} className="fila" style={{ padding: '6px 0', borderTop: '1px solid #f0eaeb', fontSize: 14 }}>
              <span style={{ overflowWrap: 'anywhere' }}>{u.email}</span>
              <span className="muted small" style={{ marginLeft: 'auto' }}>{u.rol === 'dueno' ? 'Dueño' : 'Operador'}</span>
              {u.email !== usuario.email && (
                <button type="button" className="btn texto" onClick={async () => {
                  if (!(await dialogo.confirmar(`¿Quitar el acceso de ${u.email}?`, 'Quitar acceso', 'Ya no podrá entrar al panel.'))) return;
                  await api.quitarUsuario(u.id); usuarios.recargar();
                }}>Quitar acceso</button>
              )}
            </div>
          ))}
          <form className="fila" onSubmit={async (e) => {
            e.preventDefault();
            try { await api.agregarUsuario(nuevoCorreo, nuevoRol); setNuevoCorreo(''); usuarios.recargar(); toast('Acceso agregado. Ya puede entrar con su cuenta de Google.'); }
            catch (err) { toast((err as Error).message); }
          }}>
            <label htmlFor="nuevo-correo" className="sr">Correo de Google</label>
            <input id="nuevo-correo" type="email" required placeholder="correo@gmail.com" value={nuevoCorreo} onChange={(e) => setNuevoCorreo(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} />
            <label htmlFor="nuevo-rol" className="sr">Rol</label>
            <select id="nuevo-rol" value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as 'operador' | 'dueno')} style={{ width: 'auto' }}>
              <option value="operador">Operador</option><option value="dueno">Dueño</option>
            </select>
            <button type="submit" className="btn secundario">+ Agregar correo</button>
          </form>
        </section>
      )}
    </main>
  );
}

function ConexionesGrid({ c, probando, onProbar }: { c: Conexiones; probando: string | null; onProbar: (n: string) => void }) {
  const items: Array<{ id: string; titulo: string; estado: string; texto: React.ReactNode; probar: boolean }> = [
    { id: 'whatsapp', titulo: 'WhatsApp', estado: c.whatsapp.estado, probar: c.whatsapp.estado === 'conectado',
      texto: c.whatsapp.estado === 'conectado' ? `Webhook: ${c.whatsapp.webhook}` : <>El número aún no está dado de alta en Meta. <Link to="/prueba">Cargar un chat de prueba</Link></> },
    { id: 'claude', titulo: 'Claude', estado: c.claude.estado, probar: c.claude.estado === 'conectado', texto: `Modelo ${c.claude.modelo}` },
    { id: 'calendario', titulo: 'Google Calendar', estado: c.calendario.estado, probar: c.calendario.estado === 'conectado',
      texto: 'Comparte tu calendario con la cuenta de servicio, con permiso para hacer cambios en eventos.' },
    { id: 'login', titulo: 'Inicio de sesión con Google', estado: c.login.estado, probar: false, texto: 'Solo nombre, correo y perfil.' },
  ];
  return (
    <div className="grid2" style={{ gap: 12 }}>
      {items.map((it) => (
        <div key={it.id} className="tarjeta" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="fila"><strong style={{ fontSize: 15 }}>{it.titulo}</strong><span className={`chip ${ESTADO_CON[it.estado].clase}`} style={{ marginLeft: 'auto' }}>{ESTADO_CON[it.estado].texto}</span></div>
          <div style={{ fontSize: 13, color: 'var(--texto-2)', overflowWrap: 'anywhere' }}>{it.texto}</div>
          {it.probar && <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} disabled={probando !== null} onClick={() => onProbar(it.id)}>{probando === it.id ? 'Probando…' : 'Probar conexión'}</button>}
        </div>
      ))}
    </div>
  );
}
