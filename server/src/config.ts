import { z } from 'zod';

/**
 * Toda la configuración llega por variables de entorno (ADR-07). Las claves nunca se
 * muestran en el panel ni en los registros; el panel solo ve si están presentes.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  // Solo el origen (https://dominio): una ruta pegada por error (p. ej. /entrar) rompería
  // la dirección de regreso de Google y los links del cliente.
  PUBLIC_URL: z.string().url().default('http://localhost:3000').transform((v) => new URL(v).origin),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().regex(/^[0-9a-f]{64}$/i, 'SESSION_SECRET debe ser 64 caracteres hexadecimales (32 bytes)'),
  STORAGE_DIR: z.string().default('./storage'),

  OWNER_EMAIL: z.string().email().optional(),
  DEV_LOGIN_EMAIL: z.string().email().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),

  // OpenRouter: otra vía a los modelos (Claude u otros) con una sola clave
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-sonnet-5.5'),
  // deny: solo proveedores que no guardan ni entrenan con los chats (recomendado con datos reales).
  // allow: necesario para modelos gratuitos como openrouter/free; solo para pruebas.
  OPENROUTER_DATA_COLLECTION: z.enum(['deny', 'allow']).default('deny'),
  // Cuál usar primero cuando están las dos claves. Sin valor: Claude.
  LLM_PROVIDER: z.enum(['claude', 'openrouter']).optional(),
  // Si el primero falla (sin créditos, caído, respuesta inválida), intentar con el otro.
  LLM_FALLBACK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),

  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración incompleta:\n${msgs}\nRevisa el archivo .env (hay un ejemplo en .env.example).`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEV_LOGIN_EMAIL) {
    throw new Error('DEV_LOGIN_EMAIL no se permite en producción.');
  }
  return parsed.data;
}

export const has = {
  claude: (c: Config) => Boolean(c.ANTHROPIC_API_KEY),
  openrouter: (c: Config) => Boolean(c.OPENROUTER_API_KEY),
  googleLogin: (c: Config) => Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET),
  calendar: (c: Config) => Boolean(c.GOOGLE_SERVICE_ACCOUNT_JSON && c.GOOGLE_CALENDAR_ID),
  whatsapp: (c: Config) => Boolean(c.WHATSAPP_TOKEN && c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_APP_SECRET),
};
