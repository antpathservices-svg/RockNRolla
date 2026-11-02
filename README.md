# Plataforma de pedidos · Rock N Rolla Cakes

Chats de WhatsApp → resumen y pedido con IA → revisión del operador → nota en PDF → Google Calendar.
MVP construido por Antpath Consulting.

## Qué hace hoy

| Pantalla | Qué se puede hacer |
| --- | --- |
| Bandeja | Ver los chats, resumirlos con Claude, crear el pedido borrador y copiar el link para el cliente |
| Nueva conversación de prueba | Subir el `.txt` que exporta WhatsApp o pegar el chat copiado (mientras no está la API) |
| Pedidos | Lista con búsqueda, filtros por estado y por semana, orden por fecha o estado, semáforo de entrega y botón para pasar al siguiente estado |
| Pedido (validación) | Revisar y corregir lo que extrajo el modelo, confirmar precios dudosos, varios pasteles, costos (anticipo = 50% de los pasteles; el envío va en el saldo), fotos, aprobar y generar la nota en PDF con folio y vigencia, estados y cancelación con motivo |
| Configuración | Estado de las conexiones (sin mostrar claves) y prueba de cada una, vigencia, anticipo, textos de la nota, opciones del formulario y personas con acceso |
| Link del cliente `/p/:token` | Formulario de 4 pasos en el celular, sin cuenta, con varios pasteles y fotos; luego queda como página de seguimiento |

También: webhook de WhatsApp con firma verificada y sin duplicados, evento de calendario al pasar a Aceptado
(se actualiza al editar y se borra al cancelar), bitácora de cambios, datos bancarios ocultos antes de guardar y
antes de mandar el chat al modelo.

## Estructura

```
packages/shared   Lector de chats, ocultar datos bancarios, montos, folio y tipos (lo usan servidor y web)
server            API con Fastify + PostgreSQL, Claude, PDF con Playwright, Calendar, WhatsApp, cola con pg-boss
web               Panel en React (Vite) y formulario del cliente
docs              Despliegue en Easypanel
scripts           Respaldo diario de la base
```

## Correr en una computadora

Requisitos: Node 22 y PostgreSQL 16 (o Docker).

```bash
npm install
cp .env.example .env
# En .env: NODE_ENV=development, DATABASE_URL local, SESSION_SECRET (openssl rand -hex 32),
# OWNER_EMAIL y DEV_LOGIN_EMAIL con el mismo correo para entrar sin Google.
npx playwright install chromium        # una vez, para los PDF
npm run build -w packages/shared
npm run dev:server                      # http://localhost:3000 (aplica migraciones al arrancar)
npm run dev:web                         # http://localhost:5173 con recarga en vivo
```

Con Docker: `docker compose up --build` y abre http://localhost:3000.

Sin `ANTHROPIC_API_KEY` ni `OPENROUTER_API_KEY` todo funciona menos el resumen y la extracción, que avisan que falta la clave.

## Modelos: Claude y OpenRouter

El resumen y la extracción del pedido pueden usar la API de Anthropic, OpenRouter o las dos:

| Variables | Comportamiento |
| --- | --- |
| Solo `ANTHROPIC_API_KEY` | Usa Claude directo |
| Solo `OPENROUTER_API_KEY` | Usa el modelo de `OPENROUTER_MODEL` por OpenRouter |
| Las dos | Usa primero el de `LLM_PROVIDER` (Claude si no se indica) y, si falla, el otro (`LLM_FALLBACK=true`) |

El respaldo entra cuando el primero falla: sin créditos o tope de gasto, servicio caído o una respuesta con formato
inválido. Con OpenRouter la plataforma pide salida estructurada estricta y solo proveedores que no guardan ni
entrenan con los datos (`data_collection: deny`), porque los chats traen datos personales. El modelo de
`OPENROUTER_MODEL` debe aceptar salida estructurada; en openrouter.ai/models se filtra por "structured outputs".

Modelos gratuitos (`OPENROUTER_MODEL=openrouter/free`): eligen al azar entre los modelos gratis y sus proveedores
suelen guardar o entrenar con lo que reciben, así que solo funcionan con `OPENROUTER_DATA_COLLECTION=allow`.
Úsalos solo con chats de prueba. Tienen límite de 50 peticiones al día (1,000 con al menos 10 créditos comprados)
y la calidad varía según el modelo que toque; si responde en un formato inválido y está configurado Claude, entra
Claude de respaldo.

## Pruebas

```bash
npm test -w packages/shared                                         # lector de chats, montos, folio
TEST_DATABASE_URL=postgres://postgres@localhost:5432/rnr_test npm test -w server   # flujo completo
npm run typecheck
```

La prueba del servidor borra y recrea el esquema de la base que le indiques: usa una base solo para pruebas.

## Vista previa sin servidor

`npm run build:demo -w web` genera `web/dist-demo/index.html`: el panel con datos de ejemplo, sin base de datos
ni Claude (la extracción se aproxima con reglas simples).

## Subir a GitHub

```bash
git init -b main            # si el zip no trae la carpeta .git
git add -A
git commit -m "MVP inicial"
git remote add origin git@github.com:<organización>/rnr-plataforma.git
git push -u origin main
```

El flujo de `.github/workflows/ci.yml` corre las pruebas en cada push.

## Despliegue

Ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md): Easypanel en el VPS, dominio `rnr.antpath.mx`, Google, WhatsApp y respaldos.

## Pendiente o por confirmar

- Alta del número en Meta (Coexistence), nombre exacto del campo de ecos de la app Business y plantilla de utilidad.
- Descargar al servidor las fotos que llegan por WhatsApp (hoy se registra el mensaje con su id de Meta).
- Confirmar que la cuenta de servicio puede escribir en el calendario del dueño.
- Aviso de privacidad (URL en Configuración) y permiso para usar chats reales en pruebas.
- Copia de los respaldos fuera del VPS.
- Transcripción de audios: fuera del MVP.

## Documentación del proyecto

Requisitos, decisiones (ADR), stack, casos de ejemplo y pantallas aprobadas viven en los documentos del proyecto
en Claude (Antpath).
