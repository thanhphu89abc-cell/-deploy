#!/bin/sh
set -e

UPLOAD_DIR="/var/www/html/uploads"
SEED_DIR="/var/www/seed_uploads"

mkdir -p "$UPLOAD_DIR"

if [ -d "$SEED_DIR" ]; then
  for src in "$SEED_DIR"/*; do
    if [ -f "$src" ]; then
      filename="$(basename "$src")"
      dest="$UPLOAD_DIR/$filename"
      if [ ! -f "$dest" ]; then
        cp "$src" "$dest"
      fi
    fi
  done
fi

exec php -S "0.0.0.0:${PORT:-8080}" -t /var/www/html
