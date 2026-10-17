#!/usr/bin/env bash
# `pnpm drill:restore`: practise recovering the database (operations.md § Backups and recovery).
# Dumps the source database, restores it into a fresh one, checks that every table came back with
# the same row count, reports the time taken, then removes the copy.
#
# Local (Docker):  pnpm drill:restore                      # source = salon, in the ray-project-db-1 container
# Other source:    SOURCE_DB=salon_e2e DB_CONTAINER=... pnpm drill:restore
# Production uses Neon point-in-time restore to a branch instead; this drill proves the dump is usable.
set -euo pipefail

CONTAINER="${DB_CONTAINER:-ray-project-db-1}"
USER_NAME="${DB_USER:-salon}"
SOURCE="${SOURCE_DB:-salon}"
TARGET="drill_restore_$(date +%s)"
psql() { docker exec -i "$CONTAINER" psql -U "$USER_NAME" -v ON_ERROR_STOP=1 -qtAX "$@"; }

counts() {
  psql -d "$1" -c "SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
    SELECT table_name AS t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS n
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') x"
}

start=$(date +%s)
echo "Restore drill: $SOURCE → $TARGET"
before=$(counts "$SOURCE")
docker exec "$CONTAINER" pg_dump -U "$USER_NAME" -Fc -d "$SOURCE" -f /tmp/drill.dump
psql -d postgres -c "CREATE DATABASE $TARGET"
trap 'psql -d postgres -c "DROP DATABASE IF EXISTS $TARGET WITH (FORCE)"; docker exec "$CONTAINER" rm -f /tmp/drill.dump' EXIT
docker exec "$CONTAINER" pg_restore -U "$USER_NAME" -d "$TARGET" --no-owner /tmp/drill.dump
after=$(counts "$TARGET")

# The safety rules must come back too, not just the rows.
constraints=$(psql -d "$TARGET" -c "SELECT count(*) FROM pg_constraint WHERE conname = 'booking_no_overlap'")
triggers=$(psql -d "$TARGET" -c "SELECT count(DISTINCT tgname) FROM pg_trigger WHERE tgname LIKE '%same_salon%'")
migrations=$(psql -d "$TARGET" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
elapsed=$(( $(date +%s) - start ))

if [[ "$before" == "$after" && "$constraints" == "1" && "$triggers" -gt 0 ]]; then
  echo "✓ All tables restored with identical row counts; double-booking constraint and $triggers same-salon triggers present; $migrations migrations recorded."
  echo "✓ Time to restore: ${elapsed}s (RTO target: 4 hours)"
else
  echo "✗ Restore check failed"
  echo "  before: $before"
  echo "  after:  $after"
  echo "  constraint=$constraints triggers=$triggers"
  exit 1
fi
