#!/bin/sh
# Khôi phục từ một bản sao lưu của deploy/backup.sh. Thay thế toàn bộ dữ liệu hiện có.
# Cách dùng: sh deploy/restore.sh /var/backups/freekiosk 20261103-020000
set -eu

cd "$(dirname "$0")/.."

source_dir="${1:?Thiếu thư mục sao lưu}"
stamp="${2:?Thiếu mốc thời gian, ví dụ 20261103-020000}"
dump="$source_dir/db-$stamp.dump"
files="$source_dir/files-$stamp.tar"
[ -f "$dump" ] && [ -f "$files" ] || { echo "Không tìm thấy $dump hoặc $files" >&2; exit 1; }

printf 'Toàn bộ dữ liệu hiện tại sẽ bị thay thế. Gõ "dong y" để tiếp tục: '
read -r answer
[ "$answer" = "dong y" ] || { echo "Đã hủy."; exit 1; }

docker compose stop api web
docker compose up -d --wait database
docker compose exec -T database sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$dump"
docker compose run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/media /data/apk && tar -C /data -xf -' < "$files"
docker compose up -d

echo "Đã khôi phục. Hãy kiểm tra: curl -s http://127.0.0.1:\${GATEWAY_PORT:-8090}/healthz"
echo "Lưu ý: tệp .env phải có đúng APP_SECRET của bản sao lưu, xem $source_dir/env-$stamp"
