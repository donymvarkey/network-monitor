#!/usr/bin/env bash
# NetWatch production maintenance. Never deletes volumes (no "down -v" anywhere in this file).
#
#   ./scripts/netmon.sh install            first-time install (creates .env, builds, migrates, seeds)
#   ./scripts/netmon.sh start              start all services
#   ./scripts/netmon.sh stop               stop all services (data kept)
#   ./scripts/netmon.sh restart [svc]      restart everything or one service
#   ./scripts/netmon.sh update             backup -> rebuild -> migrate -> restart
#   ./scripts/netmon.sh migrate            apply pending database migrations
#   ./scripts/netmon.sh backup             run one verified database backup now
#   ./scripts/netmon.sh backups            list backups
#   ./scripts/netmon.sh restore <file>     restore a backup (asks for confirmation)
#   ./scripts/netmon.sh logs [svc]         follow logs (all or one service)
#   ./scripts/netmon.sh health             container health + application health check
#   ./scripts/netmon.sh status             docker compose ps
set -euo pipefail
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.yml"
say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[[ -f .env ]] || [[ "${1:-}" == install ]] || die ".env not found. Run: ./scripts/netmon.sh install"
[[ -f .env ]] && { set -a; source .env; set +a; }
BACKUP_PATH="${BACKUP_PATH:-./backups}"

wait_healthy() {
  local svc=$1 i
  for i in $(seq 1 60); do
    [[ "$($C ps --format '{{.Health}}' "$svc" 2>/dev/null)" == healthy ]] && return 0
    sleep 3
  done
  die "$svc did not become healthy. Check: ./scripts/netmon.sh logs $svc"
}
backup_now() {
  mkdir -p "$BACKUP_PATH"
  $C run --rm --no-deps -T --entrypoint /bin/sh backup /scripts/backup.sh
}

case "${1:-}" in
  install)
    command -v docker >/dev/null || die "Docker is not installed"
    if [[ ! -f .env ]]; then ./scripts/setup.sh prod; exit 0; fi
    say "Building images"; $C build
    say "Starting database and cache"; $C up -d postgres redis; wait_healthy postgres; wait_healthy redis
    say "Starting services"; $C up -d
    "$0" migrate
    $C exec -T web sh -c "cd apps/web && npx tsx prisma/seed.ts" || say "Seed skipped (admin probably exists)"
    "$0" health ;;
  start)   $C up -d; wait_healthy web; say "Running on http://localhost:${HTTP_PORT:-3000}" ;;
  stop)    $C stop ;;
  restart) shift; $C restart "$@" ;;
  status)  $C ps ;;
  migrate)
    say "Applying migrations"
    $C exec -T web sh -c "cd apps/web && npx prisma migrate deploy" ;;
  update)
    say "Backing up before update"; backup_now || die "Backup failed — update aborted (nothing changed)"
    if [[ -d .git ]]; then say "Pulling latest code"; git pull --ff-only; fi
    say "Rebuilding images"; $C build
    say "Restarting services"; $C up -d
    wait_healthy web
    "$0" migrate
    "$0" health ;;
  backup)  backup_now ;;
  backups) ls -lh "$BACKUP_PATH" 2>/dev/null | grep -E 'netmon-.*\.dump$' || echo "No backups in $BACKUP_PATH" ;;
  restore)
    f="${2:-}"; [[ -n "$f" ]] || die "Usage: $0 restore <file name in $BACKUP_PATH>"
    f=$(basename "$f"); [[ -f "$BACKUP_PATH/$f" ]] || die "Not found: $BACKUP_PATH/$f"
    read -rp "Restore $f? Current data will be REPLACED by the backup. Type 'restore' to continue: " a
    [[ "$a" == restore ]] || exit 0
    say "Safety backup of the current database first"; backup_now || die "Safety backup failed — restore aborted"
    say "Stopping web and worker"; $C stop web worker
    $C run --rm --no-deps -T --entrypoint /bin/sh backup /scripts/restore.sh "/backups/$f"
    say "Starting services"; $C up -d web worker
    "$0" migrate ;;
  logs)    shift; $C logs -f --tail=200 "$@" ;;
  health)
    $C ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}'
    echo
    if out=$(curl -fsS "http://127.0.0.1:${HTTP_PORT:-3000}/api/v1/health" 2>&1); then echo "Application: $out"; else echo "Application health check failed: $out"; exit 1; fi ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
