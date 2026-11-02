import type { Db } from '../db.js';

/** Ajustes del panel de configuración, con su valor inicial. */
export const AJUSTES_INICIALES = {
  nombre_negocio: 'Rock n Rolla Cakes',
  vigencia_dias: 15,
  anticipo_pct: 50,
  cuentas_cobro: ['Efectivo', 'BANREGIO', 'BBVA'],
  origenes: ['Instagram', 'Facebook', 'Publicidad', 'Cliente recurrente', 'Recomendación'],
  formulario: {
    tipos: ['1 piso', '2 pisos', '3 pisos o más', '3D', 'Cupcakes', 'Plancha'],
    panes: ['Vainilla', 'Cremoso de vainilla', 'Chocolate', 'Red velvet', 'Marmoleado', 'Combinado', 'Que me recomienden'],
    rellenos: ['Mermelada de fresa', 'Nutella', 'Cajeta', 'Dulce de leche', 'Mermelada de piña', 'Chabacano', 'Crema pastelera', 'Que me recomienden', 'Otro'],
    extras: ['Cake topper', 'Galletas', 'Figuras en fondant', 'Oblea comestible', 'Otro'],
    max_extras: 5,
    aviso: 'Te confirmamos el precio por WhatsApp. El anticipo del 50% se paga después, con los datos de cuenta que te enviaremos.',
    aviso_privacidad_url: '',
  },
  nota: {
    subtitulo: 'Nota de pedido',
    contacto: ['WhatsApp 811 710 1907 • Instagram @rockandrollacakes • Facebook', 'Rock N Rolla Cakes • Nexxus Escobedo'],
    agradecimiento: '¡Gracias por confiar en Rock N Rolla Cakes!',
    lema: 'Hecho con pasión para celebrar tus mejores momentos • Tan exquisito como una canción',
  },
  link_dias_validez: 30,
  pausa_tramos_dias: 7,
};

export type Ajustes = typeof AJUSTES_INICIALES;
export type ClaveAjuste = keyof Ajustes;

/** Lo que un operador puede cambiar: listas y textos del formulario y de la nota. */
export const AJUSTES_OPERADOR: ClaveAjuste[] = ['formulario', 'nota'];

export async function getAjustes(db: Db): Promise<Ajustes> {
  const { rows } = await db.query<{ clave: string; valor: unknown }>('select clave, valor from ajustes');
  const out: Record<string, unknown> = structuredClone(AJUSTES_INICIALES);
  for (const r of rows) if (r.clave in out) out[r.clave] = r.valor;
  return out as Ajustes;
}

export async function setAjuste(db: Db, clave: ClaveAjuste, valor: unknown, usuario: string): Promise<void> {
  await db.query(
    `insert into ajustes (clave, valor, actualizado, actualizado_por) values ($1, $2, now(), $3)
     on conflict (clave) do update set valor = excluded.valor, actualizado = now(), actualizado_por = excluded.actualizado_por`,
    [clave, JSON.stringify(valor), usuario],
  );
}
