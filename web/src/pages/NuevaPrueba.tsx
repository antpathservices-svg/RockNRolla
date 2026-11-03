import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { VistaPrevia } from '../api';
import { api, diaMensaje, Icono, useToast } from '../ui';

const FORMATO: Record<string, string> = {
  android: 'formato Android reconocido',
  copiado: 'texto copiado de la app reconocido',
  ios: 'formato iPhone reconocido',
  desconocido: 'no se reconoció el formato: se tomará como un solo mensaje',
};
const MAX = 2 * 1024 * 1024;

export function NuevaPrueba() {
  const navigate = useNavigate();
  const toast = useToast();
  const [modo, setModo] = useState<'texto' | 'archivo'>('archivo');
  const [texto, setTexto] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [cliente, setCliente] = useState<string>('');
  const [tramo, setTramo] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const [creando, setCreando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Vista previa cada vez que cambia el texto (con espera para no saturar)
  useEffect(() => {
    setVista(null);
    if (!texto.trim()) return;
    const t = setTimeout(() => {
      api.vistaPrevia(texto).then((v) => {
        setVista(v);
        setCliente(v.propuesta.cliente ?? v.autores[0] ?? '');
        setTramo(-1);
      }).catch((e: Error) => setError(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [texto]);

  async function leerArchivo(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.txt')) return setError('El archivo debe ser .txt (en WhatsApp: Exportar chat › Sin archivos).');
    if (f.size > MAX) return setError('El archivo pesa más de 2 MB. Exporta el chat sin archivos.');
    setNombreArchivo(f.name);
    setTexto(await f.text());
  }

  async function crear() {
    if (!vista) return;
    setCreando(true);
    try {
      const t = tramo >= 0 ? vista.tramos[tramo] : null;
      const { id } = await api.importar({
        texto,
        origen: modo,
        nombreArchivo: nombreArchivo ?? undefined,
        clienteAutor: cliente || undefined,
        desdeIndice: t?.startIndex,
        hastaIndice: t?.endIndex,
      });
      navigate(`/conversaciones/${id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <main className="contenido" style={{ maxWidth: 1040 }}>
      <Link to="/" className="volver"><Icono.atras />Bandeja</Link>
      <h1>Nueva conversación de prueba</h1>
      <p style={{ fontSize: 14, color: 'var(--texto-2)' }}>Mientras no esté conectada la API de WhatsApp, carga aquí un chat para probar el resumen, el pedido y la nota.</p>

      <div role="tablist" aria-label="Forma de cargar el chat" className="tabs">
        <button type="button" role="tab" aria-selected={modo === 'texto'} onClick={() => { setModo('texto'); setTexto(''); setNombreArchivo(null); }}>Pegar texto</button>
        <button type="button" role="tab" aria-selected={modo === 'archivo'} onClick={() => { setModo('archivo'); setTexto(''); }}>Subir archivo .txt</button>
      </div>

      <div className="dos-col">
        <section className="principal">
          {modo === 'archivo' ? (
            <>
              <label
                htmlFor="archivo"
                className={`zona-archivo ${encima ? 'encima' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
                onDragLeave={() => setEncima(false)}
                onDrop={(e) => { e.preventDefault(); setEncima(false); leerArchivo(e.dataTransfer.files[0]); }}
              >
                <span style={{ color: 'var(--rosa)' }}><Icono.subir /></span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Arrastra el archivo o elige uno</span>
                <span className="muted">En WhatsApp: chat › Más › Exportar chat › Sin archivos. Hasta 2 MB.</span>
                <input ref={input} id="archivo" type="file" accept=".txt,text/plain" onChange={(e) => leerArchivo(e.target.files?.[0])} />
              </label>
              {nombreArchivo && vista && (
                <div className="tarjeta fila" style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, minWidth: 0 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{nombreArchivo}</strong>
                    <div className="small" style={{ color: vista.formato === 'desconocido' ? '#6b4e00' : '#2f6b36' }}>{vista.lineas} líneas · {FORMATO[vista.formato]}</div>
                  </div>
                  <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => input.current?.click()}>Cambiar archivo</button>
                </div>
              )}
            </>
          ) : (
            <div className="campo">
              <label htmlFor="pegar">Pega aquí los mensajes copiados de WhatsApp</label>
              <span className="ayuda">En la app: mantén presionado un mensaje, selecciona los demás y toca Copiar.</span>
              <textarea id="pegar" rows={14} value={texto} onChange={(e) => setTexto(e.target.value.slice(0, MAX))}
                placeholder="[8:34 a. m., 21/10/2026] Cliente: Quería dos pasteles para el 20 de noviembre" />
              {vista && <span className="ayuda">{FORMATO[vista.formato]}</span>}
            </div>
          )}
          {error && <div className="aviso rojo" role="alert">{error}</div>}
        </section>

        <aside className="lateral tarjeta" aria-label="Vista previa" style={{ gap: 14 }}>
          <h2>Vista previa</h2>
          {!vista ? <p className="muted">Aquí verás cuántos mensajes se leyeron antes de crear la conversación.</p> : (
            <>
              <div className="grid2" style={{ gap: 10 }}>
                <div className="stat"><b>{vista.mensajes}</b><span className="muted small">mensajes leídos</span></div>
                <div className="stat"><b>{vista.adjuntos}</b><span className="muted small">fotos y archivos</span></div>
              </div>
              {vista.autores.length > 1 && (
                <fieldset className="grupo">
                  <legend style={{ fontSize: 13 }}>¿Quién es el cliente?</legend>
                  {vista.autores.map((a) => (
                    <label key={a} className="opcion" style={{ fontSize: 14 }}>
                      <input type="radio" name="cliente" checked={cliente === a} onChange={() => setCliente(a)} />
                      {a}{a === vista.propuesta.negocio && <span className="muted small" style={{ marginLeft: 'auto' }}>parece el negocio</span>}
                    </label>
                  ))}
                </fieldset>
              )}
              {vista.tramos.length > 1 && (
                <fieldset className="grupo">
                  <legend style={{ fontSize: 13 }}>El chat tiene pausas largas. ¿Qué tramo procesamos?</legend>
                  <label className="opcion" style={{ fontSize: 14 }}>
                    <input type="radio" name="tramo" checked={tramo === -1} onChange={() => setTramo(-1)} /> Todo el chat
                  </label>
                  {vista.tramos.map((t, i) => (
                    <label key={i} className="opcion" style={{ fontSize: 14 }}>
                      <input type="radio" name="tramo" checked={tramo === i} onChange={() => setTramo(i)} />
                      Del {diaMensaje(t.from)} al {diaMensaje(t.to)} ({t.count})
                    </label>
                  ))}
                </fieldset>
              )}
              {vista.mensajesConDatosBancarios > 0 && (
                <div className="aviso morado">Se ocultaron los datos bancarios de {vista.mensajesConDatosBancarios} {vista.mensajesConDatosBancarios === 1 ? 'mensaje' : 'mensajes'}. No se guardan ni llegan al modelo.</div>
              )}
              <button type="button" className="btn primario grande" disabled={creando || vista.mensajes === 0} onClick={crear}>
                {creando ? 'Creando…' : 'Crear conversación'}
              </button>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
