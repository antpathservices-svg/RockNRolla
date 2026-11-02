/**
 * Lector de chats de WhatsApp.
 *
 * Acepta tres formatos y un plan B:
 *  - Exportación de Android:   21/10/2026, 8:34 a. m. - Nombre: mensaje
 *  - Texto copiado de la app:  [8:34 a. m., 21/10/2026] Nombre: mensaje
 *  - Exportación de iPhone:    [21/10/26, 08:34:12] Nombre: mensaje
 *  - Desconocido: todo el texto queda como un solo mensaje sin autor.
 *
 * Las fechas se interpretan en hora de Monterrey (UTC-06:00, sin horario de verano).
 */

export type ChatFormat = 'android' | 'copiado' | 'ios' | 'desconocido';
export type MessageKind = 'texto' | 'adjunto' | 'multimedia_omitida' | 'sistema';

export interface ParsedMessage {
  /** Posición del mensaje en el chat, empezando en 0. */
  index: number;
  /** Fecha y hora en ISO 8601 con zona de Monterrey, p. ej. 2026-10-21T08:34:00-06:00 */
  sentAt: string;
  /** Nombre de quien envía; null en líneas del sistema. */
  author: string | null;
  text: string;
  kind: MessageKind;
  attachmentName?: string;
  edited: boolean;
}

export interface ParseResult {
  format: ChatFormat;
  messages: ParsedMessage[];
  /** Autores distintos, en orden de aparición. */
  authors: string[];
  lineCount: number;
}

export const MONTERREY_OFFSET = '-06:00';

const INVISIBLES = /[‎‏‪-‮⁦-⁩﻿]/g;
const SPACES = /[   ]/g;

const AMPM = String.raw`(?:\s*([ap])\.?\s?m\.?)?`;
const RE_ANDROID = new RegExp(
  String.raw`^(\d{1,2})/(\d{1,2})/(\d{2,4}),?\s+(\d{1,2}):(\d{2})${AMPM}\s+-\s+(.*)$`,
  'i',
);
const RE_COPIADO = new RegExp(
  String.raw`^\[(\d{1,2}):(\d{2})${AMPM},\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\]\s?(.*)$`,
  'i',
);
const RE_IOS = new RegExp(
  String.raw`^\[(\d{1,2})/(\d{1,2})/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?${AMPM}\]\s?(.*)$`,
  'i',
);

const RE_ADJUNTO = /^(.+?\.[a-z0-9]{2,5})\s+\((?:archivo adjunto|file attached)\)\s*$/i;
const RE_ADJUNTO_IOS = /^<(?:adjunto|attached):\s*(.+?)>\s*$/i;
const RE_OMITIDO = /^<?\s*(multimedia omitid[oa]|media omitted|imagen omitida|image omitted|audio omitido|audio omitted|video omitido|video omitted|sticker omitido|sticker omitted|documento omitido|document omitted)\s*>?$/i;
const RE_EDITADO = /\s*<(?:se edit[oó] este mensaje\.?|this message was edited)>\s*$/i;

interface RawLine {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  rest: string;
}

function normalizeYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function to24h(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const pm = ampm.toLowerCase() === 'p';
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function matchLine(line: string, format: Exclude<ChatFormat, 'desconocido'>): RawLine | null {
  if (format === 'android') {
    const m = RE_ANDROID.exec(line);
    if (!m) return null;
    return {
      day: +m[1], month: +m[2], year: normalizeYear(+m[3]),
      hour: to24h(+m[4], m[6]), minute: +m[5], second: 0, rest: m[7],
    };
  }
  if (format === 'copiado') {
    const m = RE_COPIADO.exec(line);
    if (!m) return null;
    return {
      day: +m[4], month: +m[5], year: normalizeYear(+m[6]),
      hour: to24h(+m[1], m[3]), minute: +m[2], second: 0, rest: m[7],
    };
  }
  const m = RE_IOS.exec(line);
  if (!m) return null;
  return {
    day: +m[1], month: +m[2], year: normalizeYear(+m[3]),
    hour: to24h(+m[4], m[7]), minute: +m[5], second: m[6] ? +m[6] : 0, rest: m[8],
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoMonterrey(r: RawLine): string {
  return `${r.year}-${pad(r.month)}-${pad(r.day)}T${pad(r.hour)}:${pad(r.minute)}:${pad(r.second)}${MONTERREY_OFFSET}`;
}

function cleanLine(line: string): string {
  return line.replace(INVISIBLES, '').replace(SPACES, ' ').replace(/\r$/, '');
}

/** Elige el formato con más líneas reconocidas. */
export function detectFormat(lines: string[]): ChatFormat {
  const formats: Array<Exclude<ChatFormat, 'desconocido'>> = ['android', 'copiado', 'ios'];
  let best: ChatFormat = 'desconocido';
  let bestCount = 0;
  for (const f of formats) {
    let count = 0;
    for (const l of lines) if (matchLine(l, f)) count++;
    if (count > bestCount) {
      best = f;
      bestCount = count;
    }
  }
  return best;
}

function classify(text: string): { kind: MessageKind; attachmentName?: string } {
  const t = text.trim();
  const a = RE_ADJUNTO.exec(t) ?? RE_ADJUNTO_IOS.exec(t);
  if (a) return { kind: 'adjunto', attachmentName: a[1].trim() };
  if (RE_OMITIDO.test(t)) return { kind: 'multimedia_omitida' };
  return { kind: 'texto' };
}

/** Separa "Nombre: mensaje". Si no hay autor, es una línea del sistema. */
function splitAuthor(rest: string): { author: string | null; text: string } {
  const i = rest.indexOf(': ');
  if (i <= 0 || i > 80) {
    // "Nombre:" con mensaje vacío
    if (rest.endsWith(':') && rest.length <= 81) return { author: rest.slice(0, -1).trim(), text: '' };
    return { author: null, text: rest };
  }
  return { author: rest.slice(0, i).trim(), text: rest.slice(i + 2) };
}

export function parseChat(input: string): ParseResult {
  const lines = input.split('\n').map(cleanLine);
  const lineCount = lines.filter((l) => l.trim() !== '').length;
  const format = detectFormat(lines);

  if (format === 'desconocido') {
    const text = lines.join('\n').trim();
    return {
      format,
      lineCount,
      authors: [],
      messages: text
        ? [{ index: 0, sentAt: new Date().toISOString(), author: null, text, kind: 'texto', edited: false }]
        : [],
    };
  }

  const messages: ParsedMessage[] = [];
  const authors: string[] = [];

  for (const line of lines) {
    const raw = matchLine(line, format);
    if (raw) {
      const { author, text } = splitAuthor(raw.rest);
      if (author && !authors.includes(author)) authors.push(author);
      messages.push({
        index: messages.length,
        sentAt: isoMonterrey(raw),
        author,
        text,
        kind: author ? 'texto' : 'sistema',
        edited: false,
      });
      continue;
    }
    // Línea de continuación de un mensaje de varias líneas
    const last = messages[messages.length - 1];
    if (last) last.text = last.text ? `${last.text}\n${line}` : line;
  }

  for (const m of messages) {
    if (RE_EDITADO.test(m.text)) {
      m.edited = true;
      m.text = m.text.replace(RE_EDITADO, '');
    }
    m.text = m.text.replace(/\s+$/g, '');
    if (m.kind === 'sistema') continue;
    const c = classify(m.text);
    m.kind = c.kind;
    if (c.attachmentName) m.attachmentName = c.attachmentName;
  }

  return { format, messages, authors, lineCount };
}
