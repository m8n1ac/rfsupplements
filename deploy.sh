#!/usr/bin/env bash
# Deploys the RF Supplements Ops CRM on rfs-web. Run on the box (via SSM):
#   /opt/rfs-crm/deploy.sh
set -euo pipefail

APP_DIR=/opt/rfs-crm
SERVICE=rfs-crm

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $APP_DIR/.env — copy .env.example and fill it in." >&2
  exit 1
fi

echo "==> Installing dependencies"
npm ci

echo "==> Applying database migrations"
npm run db:migrate

echo "==> Generating Prisma client"
npm run db:generate

echo "==> Building"
npm run build

# next build --output=standalone emits a self-contained server, but leaves the
# static assets and public/ for the deployer to place next to it.
echo "==> Staging standalone assets"
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

# Fail loudly if the service does not actually come up.
sleep 3
sudo systemctl is-active --quiet "$SERVICE"
echo "==> $SERVICE is active"
