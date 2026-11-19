#!/bin/sh
# One PostgreSQL backup: pg_dump (custom format) -> verify -> checksum -> rotate -> record.
# Works inside the "backup" container (postgres:16-alpine) or on any host with pg_dump/psql.
# Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE, BACKUP_DIR (/backups), BACKUP_KEEP (14)
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="netmon-${TS}.dump"
TMP="$BACKUP_DIR/.${NAME}.partial"
psql_q() { psql -v ON_ERROR_STOP=1 -qtA -c "$1"; }

ID=$(psql_q "INSERT INTO \"BackupRecord\" (id, \"fileName\", status, \"startedAt\") VALUES (gen_random_uuid(), '${NAME}', 'RUNNING', now()) RETURNING id" 2>/dev/null | head -1 || true)
fail() {
  rm -f "$TMP"
  echo "backup FAILED: $1" >&2
  [ -n "$ID" ] && psql_q "UPDATE \"BackupRecord\" SET status='FAILED', error=\$\$$1\$\$, \"finishedAt\"=now() WHERE id='${ID}'" >/dev/null 2>&1 || true
  exit 1
}

pg_dump -Fc -Z 6 -f "$TMP" || fail "pg_dump exited with an error"
# Integrity: the archive must list cleanly and contain the core tables.
pg_restore --list "$TMP" > "$TMP.toc" 2>/dev/null || fail "archive is unreadable (pg_restore --list failed)"
for t in Device Network Collector; do grep -q "TABLE public ${t} " "$TMP.toc" || { rm -f "$TMP.toc"; fail "archive is missing table ${t}"; }; done
rm -f "$TMP.toc"
mv "$TMP" "$BACKUP_DIR/$NAME"
SHA=$(sha256sum "$BACKUP_DIR/$NAME" | cut -d' ' -f1)
echo "$SHA  $NAME" > "$BACKUP_DIR/$NAME.sha256"
SIZE=$(wc -c < "$BACKUP_DIR/$NAME" | tr -d ' ')

# Rotation: keep the newest $KEEP dumps (only files this script created).
ls -1t "$BACKUP_DIR"/netmon-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done

[ -n "$ID" ] && psql_q "UPDATE \"BackupRecord\" SET status='SUCCESS', verified=true, sha256='${SHA}', \"sizeBytes\"=${SIZE}, \"finishedAt\"=now() WHERE id='${ID}'" >/dev/null 2>&1 || true
echo "backup OK: $BACKUP_DIR/$NAME ($SIZE bytes, sha256 $SHA)"
