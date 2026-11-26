#!/bin/sh
# Cập nhật website trên VM: kéo mã mới của main, build image gắn tag theo commit, khởi động lại.
# Chạy trong thư mục cloud/:  sh deploy/update.sh
# Quay lui về một commit đã deploy trước đó (image của nó còn trên máy):
#   IMAGE_TAG=<commit cũ> docker compose up -d --no-build
set -eu

cd "$(dirname "$0")/.."

git pull --ff-only

IMAGE_TAG=$(git rev-parse --short=12 HEAD)
export IMAGE_TAG

# --pull: lấy bản vá mới nhất của ảnh nền đã ghim (cùng digest thì không tải lại)
docker compose build --pull
docker compose pull database

# latest luôn là bản vừa deploy, để `docker compose up -d` gõ tay hay backup.sh không quay về bản cũ
for service in migrate api web; do
  docker tag "freekiosk-manager-$service:$IMAGE_TAG" "freekiosk-manager-$service:latest"
done

docker compose up -d

echo "Đang chạy image tag $IMAGE_TAG"
docker compose ps
