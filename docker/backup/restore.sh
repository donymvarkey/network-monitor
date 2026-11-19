#!/bin/sh
# Restore a dump into the database. Verifies checksum and archive first. Destructive for current data:
# objects in the dump are dropped and recreated (--clean --if-exists). Volumes are never deleted.
set -eu
FILE="${1:?usage: restore.sh <file.dump>}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }
if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256") || { echo "checksum mismatch — refusing to restore" >&2; exit 1; }
else
  echo "warning: no .sha256 file next to the dump; skipping checksum" >&2
fi
pg_restore --list "$FILE" >/dev/null || { echo "archive unreadable — refusing to restore" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --single-transaction -d "$PGDATABASE" "$FILE"
echo "restore OK from $FILE"
