import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Usuario } from './api';
import { Bandeja } from './pages/Bandeja';
import { Calendario } from './pages/Calendario';
import { Cliente } from './pages/Cliente';
import { Configuracion } from './pages/Configuracion';
import { Entrar } from './pages/Entrar';
import { NuevaPrueba } from './pages/NuevaPrueba';
import { PedidoPage } from './pages/Pedido';
import { Pedidos } from './pages/Pedidos';
import { api, Icono } from './ui';
import logo from '../public/logo.png';

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/p/:token" element={<Cliente />} />
      <Route element={<Panel />}>
        <Route index element={<Bandeja />} />
        <Route path="conversaciones/:id" element={<Bandeja />} />
        <Route path="prueba" element={<NuevaPrueba />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="pedidos/:id" element={<PedidoPage />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="configuracion" element={<Configuracion />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export interface PanelCtx { usuario: Usuario }

function Panel() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    api.yo().then(setUsuario).catch(() => navigate('/entrar', { replace: true }));
  }, [navigate]);
  if (!usuario) return <div className="cargando">Cargando…</div>;
  const enBandeja = loc.pathname === '/' || loc.pathname.startsWith('/conversaciones') || loc.pathname === '/prueba';

  return (
    <div className="app">
      <nav className="nav" aria-label="Menú principal">
        <div className="marca"><img src={logo} alt="" /><span>Rock N Rolla<br />Cakes</span></div>
        <NavLink to="/" className={enBandeja ? 'activo' : undefined} aria-current={enBandeja ? 'page' : undefined}>
          <Icono.chat />Bandeja
        </NavLink>
        <NavLink to="/pedidos" className={({ isActive }) => (isActive ? 'activo' : undefined)}><Icono.lista />Pedidos</NavLink>
        <NavLink to="/calendario" className={({ isActive }) => (isActive ? 'activo' : undefined)}><Icono.calendario />Calendario</NavLink>
        <NavLink to="/configuracion" className={({ isActive }) => (isActive ? 'activo' : undefined)}><Icono.ajustes />Configuración</NavLink>
        <div className="pie">
          <span>{usuario.nombre ?? usuario.email} · {usuario.rol === 'dueno' ? 'Dueño' : 'Operador'}</span>
          {api.demo ? <span>Vista previa con datos de ejemplo</span> : (
            <button type="button" onClick={async () => { await api.salir(); navigate('/entrar'); }}>Cerrar sesión</button>
          )}
        </div>
      </nav>
      <Outlet context={{ usuario } satisfies PanelCtx} />
    </div>
  );
}
