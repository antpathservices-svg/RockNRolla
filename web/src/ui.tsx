import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ETIQUETA_ESTADO, type Estado } from '@rnr/shared';
import { httpApi, type Api } from './api';
import { demoApi } from './demo';

export const api: Api = import.meta.env.MODE === 'demo' ? demoApi : httpApi;

// ---------- Íconos (trazo, decorativos) ----------
const svg = (d: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icono = {
  chat: () => svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  lista: () => svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></>),
  ajustes: () => svg(<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />),
  subir: () => svg(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />, 32),
  alerta: () => svg(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>, 20),
  foto: () => svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>),
  ok: () => svg(<path d="M20 6 9 17l-5-5" />, 32),
  atras: () => svg(<path d="m15 18-6-6 6-6" />, 22),
  camara: () => svg(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>, 20),
};

export function EstadoChip({ estado, vencida }: { estado: Estado; vencida?: boolean }) {
  if (vencida && estado === 'cotizando') return <span className="chip vencida">Cotizando · vencida</span>;
  return <span className={`chip ${estado}`}>{ETIQUETA_ESTADO[estado]}</span>;
}

/** Copia al portapapeles; devuelve false si el navegador lo bloquea. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

// ---------- Fechas ----------
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Hoy en Monterrey, YYYY-MM-DD. */
export function hoy(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

export function fechaCorta(iso: string | null, hora?: string | null): string {
  if (!iso) return 'Sin fecha';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}${hora ? ` · ${hora}` : ''}`;
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400_000);
}

/** Semáforo de entrega: texto + color (el color solo refuerza). */
export function semaforo(fecha: string | null, estado: Estado): { color: string; texto: string; tono: string } {
  if (!fecha) return { color: '#9a9092', texto: 'Sin fecha', tono: 'var(--gris)' };
  if (estado === 'completado' || estado === 'cancelado') return { color: '#9a9092', texto: estado === 'completado' ? 'Entregado' : 'Cancelado', tono: 'var(--gris)' };
  const d = diasEntre(hoy(), fecha);
  if (d < 0) return { color: '#b3261e', texto: d === -1 ? 'Venció ayer' : `Venció hace ${-d} días`, tono: 'var(--rojo)' };
  if (d === 0) return { color: '#c26a00', texto: 'Hoy', tono: '#8a4b00' };
  if (d <= 2) return { color: '#c26a00', texto: d === 1 ? 'Mañana' : 'En 2 días', tono: '#8a4b00' };
  return { color: '#2f7d3a', texto: `Faltan ${d} días`, tono: '#2f6b36' };
}

/** Fecha y hora de Monterrey (UTC-06:00, sin horario de verano) a partir de cualquier ISO. */
function enMonterrey(iso: string): string {
  return new Date(Date.parse(iso) - 6 * 3600_000).toISOString();
}

export function horaMensaje(iso: string): string {
  const [h, m] = enMonterrey(iso).slice(11, 16).split(':').map(Number);
  const suf = h < 12 ? 'a. m.' : 'p. m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suf}`;
}

export function diaMensaje(iso: string): string {
  const [y, m, d] = enMonterrey(iso).slice(0, 10).split('-').map(Number);
  return `${d} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1]}${y !== new Date().getFullYear() ? ` de ${y}` : ''}`;
}

// ---------- Avisos breves ----------
const ToastCtx = createContext<(m: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      <DialogoProvider>{children}</DialogoProvider>
      <div role="status" aria-live="polite">{msg && <div className="toast">{msg}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Diálogos propios (en lugar de confirm() y prompt() del navegador) ----------
interface PeticionDialogo { titulo: string; texto?: string; accion: string; peligro?: boolean; pideTexto?: string; resolver: (v: string | null) => void }
const DialogoCtx = createContext<(p: Omit<PeticionDialogo, 'resolver'>) => Promise<string | null>>(async () => null);

function DialogoProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<PeticionDialogo | null>(null);
  const [valor, setValor] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const abrir = useCallback((d: Omit<PeticionDialogo, 'resolver'>) => new Promise<string | null>((resolver) => {
    setValor('');
    setP({ ...d, resolver });
  }), []);
  useEffect(() => { if (p && ref.current && !ref.current.open) ref.current.showModal(); }, [p]);
  const cerrar = (v: string | null) => { p?.resolver(v); ref.current?.close(); setP(null); };
  return (
    <DialogoCtx.Provider value={abrir}>
      {children}
      {p && (
        <dialog ref={ref} className="dialogo" aria-labelledby="dialogo-titulo" onCancel={(e) => { e.preventDefault(); cerrar(null); }}>
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!p.pideTexto || valor.trim()) cerrar(p.pideTexto ? valor.trim() : 'ok'); }}>
            <h2 id="dialogo-titulo">{p.titulo}</h2>
            {p.texto && <p className="muted" style={{ fontSize: 14 }}>{p.texto}</p>}
            {p.pideTexto && (
              <div className="campo">
                <label htmlFor="dialogo-valor">{p.pideTexto}</label>
                <textarea id="dialogo-valor" rows={3} autoFocus value={valor} onChange={(e) => setValor(e.target.value)} />
              </div>
            )}
            <div className="fila" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => cerrar(null)}>Regresar</button>
              <button type="submit" className={`btn ${p.peligro ? 'peligro' : 'primario'}`} disabled={Boolean(p.pideTexto) && !valor.trim()}>{p.accion}</button>
            </div>
          </form>
        </dialog>
      )}
    </DialogoCtx.Provider>
  );
}

/** confirmar('¿Quitar…?', 'Quitar') → true/false; pedirTexto('Motivo', …) → texto o null. */
export function useDialogo() {
  const abrir = useContext(DialogoCtx);
  return {
    confirmar: async (titulo: string, accion: string, texto?: string) => (await abrir({ titulo, accion, texto, peligro: true })) !== null,
    pedirTexto: (titulo: string, etiqueta: string, accion: string) => abrir({ titulo, pideTexto: etiqueta, accion, peligro: true }),
  };
}

/** Carga datos con estado de error y recarga. */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const recargar = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    let vivo = true;
    setError(null);
    fn().then((d) => vivo && setData(d)).catch((e: Error) => vivo && setError(e.message));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, recargar, setData };
}
