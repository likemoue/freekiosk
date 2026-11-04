#!/bin/sh
# Sao lưu cơ sở dữ liệu và tệp đã tải lên. Ví dụ cron chạy mỗi đêm, giữ 14 bản cơ sở dữ liệu:
#   0 2 * * * cd /opt/freekiosk/cloud && sh deploy/backup.sh /var/backups/freekiosk 14
# Tệp media có thể rất nặng và không đổi sau khi tải lên, nên chỉ giữ 1 bản (đổi bằng tham số thứ ba).
set -eu

cd "$(dirname "$0")/.."

target="${1:-./backups}"
keep="${2:-14}"
keep_files="${3:-1}"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$target"

docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$target/db-$stamp.dump"
docker compose run --rm --no-deps -T --entrypoint sh api -c 'tar -C /data -cf - media apk' > "$target/files-$stamp.tar"
cp .env "$target/env-$stamp"
chmod 600 "$target/env-$stamp"

prune() {
  ls -1t "$target/$1-"* 2>/dev/null | tail -n +"$(($2 + 1))" | while read -r old; do rm -f "$old"; done
}
prune db "$keep"
prune env "$keep"
prune files "$keep_files"

echo "Đã sao lưu vào $target ($stamp)"
