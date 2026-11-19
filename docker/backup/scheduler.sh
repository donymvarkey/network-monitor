#!/bin/sh
# Runs backup.sh every BACKUP_INTERVAL_HOURS and writes a heartbeat for the System Health page.
set -u
HOURS="${BACKUP_INTERVAL_HOURS:-24}"
beat() { psql -qtA -c "INSERT INTO \"ServiceHeartbeat\" (service, \"startedAt\", \"lastBeatAt\", info) VALUES ('backup', now(), now(), '{\"intervalHours\": ${HOURS}}') ON CONFLICT (service) DO UPDATE SET \"lastBeatAt\" = now(), info = EXCLUDED.info" >/dev/null 2>&1 || true; }
until pg_isready -q; do sleep 5; done
# Wait for migrations (tables) before the first run.
until psql -qtA -c 'SELECT 1 FROM "BackupRecord" LIMIT 1' >/dev/null 2>&1; do echo "waiting for database schema"; sleep 15; done
trap 'exit 0' TERM INT
while true; do
  beat
  /scripts/backup.sh || echo "backup run failed; will retry next cycle" >&2
  i=0; while [ "$i" -lt $((HOURS * 60)) ]; do sleep 60 & wait $!; i=$((i + 1)); [ $((i % 5)) -eq 0 ] && beat; done
done
