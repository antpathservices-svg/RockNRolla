export const ESTADOS = ['cotizando', 'aceptado', 'en_preparacion', 'listo', 'completado', 'cancelado'] as const;
export type Estado = (typeof ESTADOS)[number];

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  cotizando: 'Cotizando',
  aceptado: 'Aceptado',
  en_preparacion: 'En preparación',
  listo: 'Listo para entregar',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

/** Lo que ve el cliente en su link de seguimiento. */
export const ETIQUETA_ESTADO_CLIENTE: Record<Estado, string> = {
  ...ETIQUETA_ESTADO,
  completado: 'Entregado',
};

/** Siguiente estado que ofrece el botón de la lista. */
export const SIGUIENTE_ESTADO: Partial<Record<Estado, Estado>> = {
  cotizando: 'aceptado',
  aceptado: 'en_preparacion',
  en_preparacion: 'listo',
  listo: 'completado',
};

export type Origen = 'whatsapp' | 'archivo' | 'texto' | 'formulario';
export type Rol = 'dueno' | 'operador';
export type TipoEntrega = 'domicilio' | 'recoger';

export interface Pastel {
  id?: string;
  posicion: number;
  tema: string | null;
  festejado: string | null;
  edad: string | null;
  personas: number | null;
  tipo: string | null;
  pan: string | null;
  relleno: string | null;
  cubierta: string | null;
  decoracion: string | null;
  extras: string[];
  precioCentavos: number | null;
  precioConfirmado: boolean;
}

export interface Duda {
  campo: string;
  motivo: string;
  mensajeIndice?: number | null;
}

export interface Fuente {
  campo: string;
  mensajeIndice: number;
}

export interface Pedido {
  id: string;
  folio: string;
  estado: Estado;
  motivoCancelacion: string | null;
  conversacionId: string | null;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  clienteTipo: string | null;
  origen: string | null;
  fechaEntrega: string | null;
  /** Hora del evento que dijo el cliente; la entrega suele ser antes. */
  horaEvento: string | null;
  horaDesde: string | null;
  horaHasta: string | null;
  tipoEntrega: TipoEntrega | null;
  direccion: string | null;
  envioCentavos: number;
  descuentoCentavos: number;
  anticipoPct: number;
  cuentaAnticipo: string | null;
  cuentaSaldo: string | null;
  anticipoRecibidoEn: string | null;
  vigenciaHasta: string | null;
  aprobadoEn: string | null;
  eventoCalendarioId: string | null;
  tokenPublico: string | null;
  tokenActivo: boolean;
  formularioRecibidoEn: string | null;
  esPrueba: boolean;
  dudas: Duda[];
  fuentes: Fuente[];
  pasteles: Pastel[];
  notas: Array<{ version: number; creado: string }>;
  creado: string;
  actualizado: string;
}

export interface Mensaje {
  id: number;
  indice: number;
  rol: 'cliente' | 'negocio' | 'sistema';
  autor: string | null;
  texto: string;
  tipo: string;
  adjuntoNombre: string | null;
  editado: boolean;
  enviado: string;
}

export interface Conversacion {
  id: string;
  origen: Origen;
  esPrueba: boolean;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  resumen: string | null;
  dudas: Duda[];
  ultimoMensaje: string | null;
  ultimoTexto?: string | null;
  totalMensajes?: number;
  pedidoId?: string | null;
  pedidoEstado?: Estado | null;
  creado: string;
}

/** Resultado de la extracción con el modelo. Los textos vacíos significan "no está en el chat". */
export interface Extraccion {
  resumen: string;
  cliente_nombre: string;
  fecha_entrega: string;
  hora_desde: string;
  hora_hasta: string;
  tipo_entrega: string;
  direccion: string;
  envio: string;
  anticipo_recibido: boolean;
  pasteles: Array<{
    tema: string;
    festejado: string;
    edad: string;
    personas: string;
    tipo: string;
    pan: string;
    relleno: string;
    cubierta: string;
    decoracion: string;
    extras: string[];
    precio: string;
  }>;
  dudas: Array<{ campo: string; motivo: string; mensaje_indice: number }>;
  fuentes: Array<{ campo: string; mensaje_indice: number }>;
}
