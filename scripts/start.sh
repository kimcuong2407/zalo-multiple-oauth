#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
HOST=${ZALO_MULTI_HOST:-127.0.0.1}
PORT=${ZALO_MULTI_PORT:-8786}
DATA_DIR=${ZALO_MULTI_DATA_DIR:-$HOME/.zalo-multi-bridge}

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  printf '%s\n' "Dependencies are not installed. Run ./scripts/setup.sh first." >&2
  exit 1
fi

case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    printf '%s\n' "WARNING: The API has no authentication." >&2
    printf 'Do not expose host %s to an untrusted network.\n\n' "$HOST" >&2
    ;;
esac

printf 'Dashboard: http://%s:%s/dashboard\n' "$HOST" "$PORT"
printf 'Health:    http://%s:%s/health\n' "$HOST" "$PORT"
printf 'Data:      %s\n' "$DATA_DIR"
printf '%s\n\n' "Press Ctrl+C to stop the foreground server."

cd "$PROJECT_DIR"
exec npm start
