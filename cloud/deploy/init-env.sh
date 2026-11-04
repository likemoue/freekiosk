#!/bin/sh
# Tạo tệp .env với các khóa ngẫu nhiên. Không bao giờ ghi đè tệp đã có.
# Cách dùng: sh deploy/init-env.sh https://mdm.ism.io.vn 0.0.0.0 admin@ism.io.vn
set -eu

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo "Đã có tệp .env, không ghi đè. Muốn tạo lại thì xóa tay trước (mất APP_SECRET là mất dữ liệu đã mã hóa)." >&2
  exit 1
fi

public_url="${1:-https://mdm.ism.io.vn}"
bind_address="${2:-127.0.0.1}"
admin_email="${3:-admin@ism.io.vn}"

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

admin_password="$(random_hex 12)"

umask 077
cat > .env <<EOF
PUBLIC_URL=${public_url}
BIND_ADDRESS=${bind_address}
GATEWAY_PORT=8090
POSTGRES_DB=freekiosk
POSTGRES_USER=freekiosk
POSTGRES_PASSWORD=$(random_hex 24)
APP_SECRET=$(random_hex 32)
ADMIN_EMAIL=${admin_email}
ADMIN_PASSWORD=${admin_password}
ORG_NAME=iSMART
TRUST_CF_HEADER=true
EOF

echo "Đã tạo .env"
echo "Đăng nhập lần đầu: ${admin_email} / ${admin_password}"
echo "Lưu lại mật khẩu này, hệ thống sẽ yêu cầu đổi ngay khi đăng nhập."
echo "Sao lưu tệp .env: mất APP_SECRET thì không giải mã được thông tin bí mật đã lưu."
