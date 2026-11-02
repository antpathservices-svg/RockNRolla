import type { ParsedMessage } from './chat-parser.js';

export interface ChatSegment {
  /** Índice del primer mensaje del tramo. */
  startIndex: number;
  endIndex: number;
  from: string;
  to: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Divide el chat en tramos cuando pasan más de `gapDays` días sin mensajes. */
export function splitSegments(messages: ParsedMessage[], gapDays = 7): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let current: ChatSegment | null = null;
  let prevTime = 0;
  for (const m of messages) {
    const t = Date.parse(m.sentAt);
    if (!current || t - prevTime > gapDays * DAY_MS) {
      current = { startIndex: m.index, endIndex: m.index, from: m.sentAt, to: m.sentAt, count: 0 };
      segments.push(current);
    }
    current.endIndex = m.index;
    current.to = m.sentAt;
    current.count++;
    prevTime = t;
  }
  return segments;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Propone quién es el negocio y quién el cliente. El negocio es el autor cuyo nombre
 * se parece al nombre configurado del negocio; el cliente, el primer autor distinto.
 */
export function guessRoles(authors: string[], businessName: string): { negocio: string | null; cliente: string | null } {
  const b = norm(businessName);
  const negocio = authors.find((a) => {
    const n = norm(a);
    return n.length > 0 && (n.includes(b) || b.includes(n));
  }) ?? null;
  const cliente = authors.find((a) => a !== negocio) ?? null;
  return { negocio, cliente };
}
