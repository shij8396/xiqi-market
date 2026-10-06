#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
umask 077
mkdir -p backups
chmod 700 backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ "$(id -u)" -eq 0 ]; then
  docker_command=(docker)
else
  docker_command=(sudo docker)
fi
compose=("${docker_command[@]}" compose --env-file "${1:-.env.private}" -f "${2:-deploy/compose.private.yml}")
"${compose[@]}" exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' | gzip > "backups/database-$stamp.sql.gz"
gzip -t "backups/database-$stamp.sql.gz"
"${compose[@]}" exec -T app tar -C /app/uploads -czf - . > "backups/uploads-$stamp.tar.gz"
gzip -t "backups/uploads-$stamp.tar.gz"
printf 'Backup created: %s/backups/%s\n' "$project_root" "$stamp"
