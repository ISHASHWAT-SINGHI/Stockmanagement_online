#!/bin/bash
# backup.sh — Manual database backup before migrations or deployments.
# Usage: bash scripts/backup.sh

set -e

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set in .env"
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups"
BACKUP_FILE="${BACKUP_DIR}/stockpro_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "Backing up database to $BACKUP_FILE ..."
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

echo "✓ Backup complete: $BACKUP_FILE"
echo "  Size: $(du -sh $BACKUP_FILE | cut -f1)"
