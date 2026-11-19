#!/usr/bin/env bash
# Network Monitor setup
#   ./scripts/setup.sh dev    -> Postgres, Redis, worker, realtime in Docker; web app on localhost (pnpm dev)
#   ./scripts/setup.sh prod   -> everything in Docker (web behind nginx on http://localhost:3000)
#   ./scripts/setup.sh down   -> stop containers (data kept)
#   ./scripts/setup.sh reset  -> stop containers AND delete database data
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-dev}"

say()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }
rand() { openssl rand -base64 32 | tr -d '\n'; }
pwgen(){ openssl rand -hex 16; }

DEV_COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
PROD_COMPOSE="docker compose -f docker-compose.yml"

case "$MODE" in
  down)  $DEV_COMPOSE down; exit 0 ;;
  reset) read -rp "Delete ALL database data? [y/N] " a; [[ "$a" == y* ]] || exit 0
         $DEV_COMPOSE down -v; exit 0 ;;
  dev|prod) ;;
  *) die "Usage: $0 [dev|prod|down|reset]" ;;
esac

# ---------- 1. prerequisites ----------
say "Checking prerequisites"
need docker  "Install Docker: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin missing (docker compose)."
docker info >/dev/null 2>&1 || die "Docker daemon not running (or your user is not in the docker group)."
need openssl "Install openssl (e.g. sudo apt install openssl)."
if [[ "$MODE" == dev ]]; then
  need node "Install Node.js 20+ (https://nodejs.org or nvm)."
  if ! command -v pnpm >/dev/null 2>&1; then
    say "pnpm not found; activating via corepack"
    corepack enable && corepack prepare pnpm@9.12.0 --activate || die "Could not enable pnpm. Run: npm i -g pnpm@9"
  fi
fi

# ---------- 2. .env (used by Docker containers) ----------
if [[ ! -f .env ]]; then
  say "Creating .env with generated secrets"
  cp .env.example .env
  PGPASS=$(pwgen); ADMINPASS=$(pwgen)
  sed -i.bak \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPASS}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://netmon:${PGPASS}@postgres:5432/netmon?schema=public|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand)|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMINPASS}|" \
    -e "s|^ROUTER_CREDENTIALS_KEY=.*|ROUTER_CREDENTIALS_KEY=$(rand)|" \
    .env && rm -f .env.bak
  chmod 600 .env
  printf '\n  Admin login: %s / %s\n  (saved in .env — change it after first login)\n\n' \
    "$(grep ^ADMIN_EMAIL= .env | cut -d= -f2)" "$ADMINPASS"
else
  say ".env already exists — keeping it"
  for k in SESSION_SECRET ADMIN_PASSWORD ROUTER_CREDENTIALS_KEY POSTGRES_PASSWORD; do
    grep -qE "^$k=.+" .env || die "$k is empty in .env. Fill it in (openssl rand -base64 32) or delete .env and re-run."
  done
fi
set -a; source .env; set +a

# ---------- 3. apps/web/.env (used by web app on localhost) ----------
if [[ "$MODE" == dev ]]; then
  say "Writing apps/web/.env (localhost addresses for Postgres/Redis)"
  sed -e "s|@postgres:5432|@localhost:5432|" -e "s|redis://redis:|redis://localhost:|" .env > apps/web/.env
  chmod 600 apps/web/.env
  export DATABASE_URL="${DATABASE_URL//@postgres:5432/@localhost:5432}"
  export REDIS_URL="${REDIS_URL//redis:\/\/redis:/redis:\/\/localhost:}"
fi

# ---------- 4. start containers ----------
wait_healthy() {
  local svc=$1 compose=$2 i
  for i in $(seq 1 30); do
    [[ "$($compose ps --format '{{.Health}}' "$svc" 2>/dev/null)" == healthy ]] && return 0
    sleep 2
  done
  die "$svc did not become healthy. Check: $compose logs $svc"
}

if [[ "$MODE" == dev ]]; then
  say "Starting Postgres and Redis in Docker"
  $DEV_COMPOSE up -d postgres redis
  wait_healthy postgres "$DEV_COMPOSE"; wait_healthy redis "$DEV_COMPOSE"

  say "Installing packages"
  pnpm install

  say "Preparing database"
  pnpm --filter web exec prisma generate
  if ! find apps/web/prisma/migrations -mindepth 1 -maxdepth 1 -type d | grep -q .; then
    pnpm --filter web exec prisma migrate dev --name init
  else
    pnpm --filter web exec prisma migrate deploy
  fi
  pnpm --filter web db:seed

  say "Starting worker and realtime in Docker"
  $DEV_COMPOSE up -d --build worker realtime

  cat <<MSG

Setup complete.
  Start the web app:   pnpm dev            -> http://localhost:3000
  Containers status:   $DEV_COMPOSE ps
  Logs:                $DEV_COMPOSE logs -f worker realtime
  Stop:                ./scripts/setup.sh down
  Collector:           Create a token with: pnpm --filter web collector:create <name>
                       Then configure .env.collector and start:
                       export \$(grep -v '^#' .env.collector | xargs) && pnpm --filter @netmon/collector dev
MSG
else
  say "Building and starting everything in Docker"
  $PROD_COMPOSE up -d --build postgres redis
  wait_healthy postgres "$PROD_COMPOSE"
  $PROD_COMPOSE up -d --build web worker realtime nginx
  say "Applying database migrations and seed inside the web container"
  $PROD_COMPOSE exec web sh -c "npx prisma migrate deploy && npx tsx prisma/seed.ts" \
    || die "Migration failed. Make sure migrations exist (run './scripts/setup.sh dev' once on a dev machine to create them)."
  printf '\nRunning at http://localhost:3000\nStatus: %s ps\n' "$PROD_COMPOSE"
fi
