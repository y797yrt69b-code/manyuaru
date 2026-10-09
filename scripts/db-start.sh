#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi
if ! grep -q '^DATABASE_URL=postgres' .env.local; then
  if docker container inspect manyuaru-poc-db >/dev/null 2>&1; then
    echo '既存DBがあります。.env.localをバックアップから復旧してください。上書きしません。' >&2
    exit 1
  fi
  POC_DB_PASSWORD=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")
  POC_APP_PASSWORD=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://poc_app:${POC_APP_PASSWORD}@127.0.0.1:55432/tryon|" .env.local
  chmod 600 .env.local
  docker run -d --name manyuaru-poc-db --restart=no -p 127.0.0.1:55432:5432 \
    -e POSTGRES_DB=tryon -e POSTGRES_PASSWORD="$POC_DB_PASSWORD" \
    -v manyuaru-poc-db:/var/lib/postgresql/data \
    postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3 >/dev/null
  for i in {1..30}; do
    if docker exec manyuaru-poc-db pg_isready -U postgres -d tryon >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec -i manyuaru-poc-db psql -v ON_ERROR_STOP=1 -U postgres -d tryon <<SQL
CREATE ROLE poc_server NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE poc_app LOGIN PASSWORD '$POC_APP_PASSWORD' NOSUPERUSER NOBYPASSRLS;
GRANT poc_server TO poc_app;
SQL
else
  docker start manyuaru-poc-db >/dev/null
fi
for i in {1..30}; do
  if docker exec manyuaru-poc-db pg_isready -U postgres -d tryon >/dev/null 2>&1; then
    npm run db:migrate
    exit 0
  fi
  sleep 1
done
echo 'DB起動を確認できません。docker logs manyuaru-poc-dbを確認してください。' >&2
exit 1
