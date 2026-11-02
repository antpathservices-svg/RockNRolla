import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, type SinSesion } from '../api';
import { api } from '../ui';
import logo from '../../public/logo.png';

const ERRORES: Record<string, string> = {
  sin_acceso: 'Tu correo no tiene acceso. Pídele al dueño que te agregue en Configuración.',
  correo: 'Google no confirmó tu correo. Intenta con otra cuenta.',
  cancelado: 'No se completó el inicio de sesión. Intenta de nuevo.',
};

export function Entrar() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [opciones, setOpciones] = useState<SinSesion | null>(null);

  useEffect(() => {
    api.yo()
      .then(() => navigate('/', { replace: true }))
      .catch((e) => setOpciones(e instanceof ApiError ? (e.data as SinSesion) : { google: false, dev: false }));
  }, [navigate]);

  const error = params.get('error');
  return (
    <main className="entrar">
      <div className="tarjeta">
        <img src={logo} alt="Rock N Rolla Cakes" width={88} height={88} />
        <h1 style={{ fontSize: 22 }}>Pedidos de Rock N Rolla Cakes</h1>
        {error && <div className="aviso rojo" role="alert">{ERRORES[error] ?? 'No se pudo iniciar sesión.'}</div>}
        {!opciones ? <p className="muted">Cargando…</p> : (
          <>
            {opciones.google && <a className="btn primario grande bloque" href="/auth/google">Entrar con Google</a>}
            {opciones.dev && (
              <button type="button" className="btn bloque" onClick={async () => { await api.entrarDev(); navigate('/'); }}>
                Entrar en modo desarrollo
              </button>
            )}
            {!opciones.google && !opciones.dev && <p className="muted">El inicio de sesión aún no está configurado en el servidor.</p>}
          </>
        )}
        <p className="muted">Solo entran los correos autorizados por el dueño.</p>
      </div>
    </main>
  );
}
