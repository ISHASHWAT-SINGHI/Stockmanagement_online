#!/bin/bash
# backup.sh — Manual database backup before migrations or deployments.
# Usage (from anywhere): bash backend/scripts/backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$BACKEND_DIR")"

# Read DATABASE_URL from secrets/backend.env (fallback: backend/.env) unless already set.
if [ -z "$DATABASE_URL" ]; then
  for ENV_FILE in "$REPO_DIR/secrets/backend.env" "$BACKEND_DIR/.env"; do
    if [ -f "$ENV_FILE" ]; then
      DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//")
      [ -n "$DATABASE_URL" ] && break
    fi
  done
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set in secrets/backend.env"
  exit 1
fi

# pg_dump does not understand SQLAlchemy driver suffixes such as +asyncpg or +psycopg2.
PG_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?(\+[a-z0-9]+)?://#postgresql://#')

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="$BACKEND_DIR/backups"
BACKUP_FILE="${BACKUP_DIR}/stockpro_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "Backing up database to $BACKUP_FILE ..."
pg_dump "$PG_URL" > "$BACKUP_FILE"

echo "✓ Backup complete: $BACKUP_FILE"
echo "  Size: $(du -sh "$BACKUP_FILE" | cut -f1)"
