# Despliegue en el VPS con Easypanel

VPS de Vultr (Ciudad de México, 1 vCPU, 2 GB de RAM, Ubuntu 22.04) con Easypanel. Dominio: `rnr.antpath.mx`.

## 1. DNS (cPanel de antpath.mx)

1. Zona DNS de `antpath.mx`: registro **A** `rnr` → IP del VPS.
2. Borra cualquier registro de DNS dinámico que apunte `rnr` a otra parte.
3. Si hay registros **CAA**, que permitan `letsencrypt.org`.
4. Comprueba: `dig +short rnr.antpath.mx` debe devolver la IP del VPS.

## 2. Base de datos

En Easypanel: proyecto `rnr` › **+ Service › Postgres** (versión 16), nombre `rnr_db`.
Copia la **Internal Connection URL**: va en `DATABASE_URL`.

## 3. La aplicación

1. **+ Service › App**, nombre `rnr_app`.
2. **Source**: GitHub (el repositorio de este proyecto, rama `main`) con **Build: Dockerfile**.
   Sin GitHub conectado: sube el código a un registro de imágenes y usa **Docker Image**.
3. **Environment**: copia `.env.example` y llena los valores. `SESSION_SECRET` se genera con `openssl rand -hex 32`.
4. **Mounts**: volumen `rnr_datos` montado en `/data` (PDFs y fotos).
5. **Domains**: `rnr.antpath.mx`, puerto `3000`, HTTPS activado. Easypanel pide el certificado de Let's Encrypt.
6. **Deploy**. Al arrancar, el servidor aplica las migraciones y da de alta a `OWNER_EMAIL` como dueño.
7. Comprueba `https://rnr.antpath.mx/api/salud` → `{"ok":true}`.

Memoria: en 2 GB, el servidor genera un PDF a la vez. Si el uso pasa del 80% de forma sostenida, conviene subir a 4 GB.
Agrega 2 GB de swap en el VPS como colchón (`fallocate -l 2G /swapfile`, etc.).

## 4. Google

**Inicio de sesión** (Google Cloud Console del cliente):
1. APIs y servicios › Pantalla de consentimiento: tipo Externo, permisos `openid`, `email`, `profile` solamente.
   Con solo esos permisos no hace falta lista de usuarios de prueba ni la autorización vence a los 7 días.
2. Credenciales › Crear ID de cliente de OAuth › Aplicación web.
   URI de redireccionamiento: `https://rnr.antpath.mx/auth/google/callback` (exacta, sin barra al final).
3. `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` al Environment. El secreto solo se muestra al crearlo.

**Calendario** (cuenta de servicio):
1. Activa Google Calendar API en el proyecto.
2. IAM › Cuentas de servicio › Crear › Claves › Agregar clave JSON.
3. El dueño abre Google Calendar › configuración de su calendario › Compartir con personas específicas ›
   el correo de la cuenta de servicio con permiso **Hacer cambios en eventos**.
4. `GOOGLE_SERVICE_ACCOUNT_JSON` (el JSON o el JSON en base64) y `GOOGLE_CALENDAR_ID` (normalmente el correo del dueño).
5. En el panel: Configuración › Google Calendar › Probar conexión.

## 5. WhatsApp (cuando Meta dé de alta el número)

1. Meta for Developers › app del cliente › WhatsApp › Configuración del webhook:
   - URL: `https://rnr.antpath.mx/webhook/whatsapp`
   - Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
   - Suscribir el campo `messages` (y el de ecos de Coexistence, por confirmar su nombre).
2. Token de usuario del sistema → `WHATSAPP_TOKEN`; ID del número → `WHATSAPP_PHONE_NUMBER_ID`; App Secret → `WHATSAPP_APP_SECRET`.
3. Plantilla de utilidad para mandar la nota fuera de las 24 horas (RF-73): darla de alta en el mismo proceso.

## 6. Respaldos

- Activa **Auto Backups** de Vultr para el VPS.
- Respaldo diario de la base con `scripts/respaldo.sh` (cron en el VPS). Falta configurar la copia fuera del VPS.
- Prueba restaurar un respaldo antes del piloto.

## 7. Actualizar

Cada `git push` a `main` → Easypanel › rnr_app › Deploy (o activa el despliegue automático).
Las migraciones nuevas se aplican solas al arrancar.
