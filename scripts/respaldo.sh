#!/usr/bin/env bash
# Respaldo diario de la base de datos (requisito: perder como máximo un día de datos).
#
# Uso en el VPS (cron, todos los días a las 3:17 a. m.):
#   17 3 * * * DATABASE_URL=... RESPALDOS=/root/respaldos /ruta/scripts/respaldo.sh >> /var/log/rnr-respaldo.log 2>&1
#
# Guarda 14 días en $RESPALDOS. La copia FUERA del VPS (por ejemplo con rclone a Google Drive
# o a un bucket) está por configurar: sin ella, un fallo del VPS se lleva también los respaldos.
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"
RESPALDOS="${RESPALDOS:-./respaldos}"
DIAS="${DIAS:-14}"
mkdir -p "$RESPALDOS"

archivo="$RESPALDOS/rnr-$(date +%Y%m%d-%H%M).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$archivo"
echo "Respaldo creado: $archivo ($(du -h "$archivo" | cut -f1))"

# Registrar la fecha para que el panel la muestre
psql "$DATABASE_URL" -q -c "insert into ajustes (clave, valor) values ('ultimo_respaldo', to_jsonb(now()::text))
  on conflict (clave) do update set valor = excluded.valor, actualizado = now()"

find "$RESPALDOS" -name 'rnr-*.sql.gz' -mtime +"$DIAS" -delete

# Copia fuera del VPS (descomentar cuando exista el destino):
# rclone copy "$archivo" remoto:rnr-respaldos/

# Restaurar (probar antes del piloto):
#   gunzip -c rnr-AAAAMMDD-HHMM.sql.gz | psql "$DATABASE_URL_DESTINO"
