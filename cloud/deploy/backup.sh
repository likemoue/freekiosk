#!/bin/sh
# Sao lưu cơ sở dữ liệu và tệp đã tải lên. Ví dụ cron chạy lúc 2 giờ sáng, giữ 14 bản:
#   0 2 * * * cd /opt/freekiosk/cloud && sh deploy/backup.sh /var/backups/freekiosk 14
set -eu

cd "$(dirname "$0")/.."

target="${1:-./backups}"
keep="${2:-14}"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$target"

docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$target/db-$stamp.dump"
docker compose run --rm --no-deps -T --entrypoint sh api -c 'tar -C /data -cf - media apk' > "$target/files-$stamp.tar"
cp .env "$target/env-$stamp"
chmod 600 "$target/env-$stamp"

# Giữ lại `keep` bản mới nhất của mỗi loại
for kind in db files env; do
  ls -1t "$target/$kind-"* 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$old"; done
done

echo "Đã sao lưu vào $target ($stamp)"
