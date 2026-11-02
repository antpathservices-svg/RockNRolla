import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Calendario } from './services/calendar.js';
import type { Extractor } from './services/extraction.js';
import type { GeneradorPdf } from './services/pdf.js';
import type { WhatsApp } from './services/whatsapp.js';

/** Dependencias compartidas por las rutas. En pruebas se reemplazan por dobles. */
export interface Ctx {
  config: Config;
  db: Db;
  extractor: Extractor;
  calendario: Calendario;
  whatsapp: WhatsApp;
  pdf: GeneradorPdf;
  /** Encola la sincronización del calendario de un pedido. */
  sincronizarCalendario(pedidoId: string): Promise<void>;
}

export interface SesionUsuario {
  email: string;
  nombre: string | null;
  rol: 'dueno' | 'operador';
}

declare module '@fastify/secure-session' {
  interface SessionData {
    user: SesionUsuario;
    oauthState: string;
  }
}
