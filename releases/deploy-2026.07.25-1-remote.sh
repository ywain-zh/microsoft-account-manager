#!/usr/bin/env bash
set -Eeuo pipefail
export DEPLOY_DIR=/opt/microsoft-account-manager
export CONTAINER_NAME=microsoft-account-manager
export IMAGE_REPO=ghcr.io/ywain-zh/microsoft-account-manager
export IMAGE_TAG=2026.07.25-1
export PREV_IMAGE_TAG=2026.07.14-1
export APP_IMAGE=${IMAGE_REPO}:${IMAGE_TAG}
export PREV_APP_IMAGE=${IMAGE_REPO}:${PREV_IMAGE_TAG}
export RELEASE_DOC=releases/RELEASE-2026-07-25-01.md
cd "$DEPLOY_DIR"
pwd
ls -lah
df -h /
docker system df
test -f .env
test -d data || mkdir -p data
test -f "$RELEASE_DOC"
grep '^APP_IMAGE=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
cp .env ".env.bak.${IMAGE_TAG}"
sed -i "s#^APP_IMAGE=.*#APP_IMAGE=${APP_IMAGE}#" .env
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 microsoft-account-manager
docker stats --no-stream microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while read -r image image_id; do
  case "$image" in
    "${IMAGE_REPO}:"*)
      if [ "$image" != "$APP_IMAGE" ] && { [ -z "${PREV_APP_IMAGE:-}" ] || [ "$image" != "$PREV_APP_IMAGE" ]; }; then
        echo "remove old image: $image"
        docker image rm "$image" || true
      fi
      ;;
  esac
done
df -h /
docker system df
docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep 'microsoft-account-manager' || true
