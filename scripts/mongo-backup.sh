#!/bin/bash
# Ежедневный бэкап MongoDB в docker-compose. Хранит последние 14 копий.
# Установка на VPS (crontab -e), запуск каждую ночь в 03:00:
#   0 3 * * * /path/to/Resto-control/scripts/mongo-backup.sh >> /var/log/resto-backup.log 2>&1

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
DATE="$(date +%Y-%m-%d_%H-%M)"
KEEP=14

mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR"
MONGO_PASSWORD="$(grep -oP '(?<=^MONGO_ROOT_PASSWORD=).*' .env)"

docker compose exec -T mongo mongodump \
  --username resto --password "$MONGO_PASSWORD" --authenticationDatabase admin \
  --archive > "$BACKUP_DIR/resto_control_$DATE.archive"

gzip "$BACKUP_DIR/resto_control_$DATE.archive"

# держим только последние $KEEP архивов
ls -1t "$BACKUP_DIR"/*.archive.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "[$(date)] backup done: resto_control_$DATE.archive.gz"
