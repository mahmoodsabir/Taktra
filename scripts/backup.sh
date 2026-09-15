#!/usr/bin/env bash
# Snapshot the Taktra data volume.
#
# Everything the product knows — commitments, schedules, and months of accumulated
# memory about its owner — lives in one volume. Losing it loses the product.
#
# Usage:  scripts/backup.sh [destination-dir]
# Cron:   15 3 * * *  /root/Taktra/scripts/backup.sh /var/backups/taktra >> /var/log/taktra-backup.log 2>&1

set -euo pipefail

DEST="${1:-/var/backups/taktra}"
VOLUME="${TAKTRA_VOLUME:-taktra-data}"
KEEP_DAYS="${TAKTRA_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${DEST}/taktra-${STAMP}.tar.gz"

mkdir -p "$DEST"

if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "error: docker volume '${VOLUME}' not found" >&2
  exit 1
fi

# SQLite keeps recent writes in the -wal until a checkpoint, so the whole directory is
# archived rather than just the .db. Copying the .db alone silently loses the newest data.
#
# The container keeps running: this is a crash-consistent copy, which SQLite's WAL is
# designed to recover from. Stopping the service nightly would cost missed reminders for
# no real gain.
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${DEST}:/backup" \
  alpine:3 \
  tar czf "/backup/$(basename "$ARCHIVE")" -C /data .

# Fail loudly on an empty or truncated archive rather than reporting success.
if [ ! -s "$ARCHIVE" ]; then
  echo "error: archive ${ARCHIVE} is empty" >&2
  exit 1
fi
tar tzf "$ARCHIVE" >/dev/null || { echo "error: ${ARCHIVE} is not readable" >&2; exit 1; }

find "$DEST" -name 'taktra-*.tar.gz' -type f -mtime "+${KEEP_DAYS}" -delete

echo "$(date -u +%FT%TZ) backed up ${VOLUME} -> ${ARCHIVE} ($(du -h "$ARCHIVE" | cut -f1))"
