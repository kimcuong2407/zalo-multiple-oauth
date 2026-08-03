#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
ACCOUNT_ID=${1:-}

if [ -z "$ACCOUNT_ID" ]; then
  printf '%s\n' "Usage: ./scripts/login.sh <account-id>" >&2
  printf '%s\n' "Example: ./scripts/login.sh personal" >&2
  exit 1
fi

case "$ACCOUNT_ID" in
  *[!A-Za-z0-9_-]*)
    printf '%s\n' "Error: account-id may contain only letters, numbers, underscores, and hyphens." >&2
    exit 1
    ;;
esac

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  printf '%s\n' "Dependencies are not installed. Run ./scripts/setup.sh first." >&2
  exit 1
fi

printf 'Logging in account "%s".\n' "$ACCOUNT_ID"
printf '%s\n' "A QR code will appear in this terminal. Scan it with the Zalo mobile app."
printf '%s\n\n' "If it expires, the bridge will generate another QR automatically."

cd "$PROJECT_DIR"
exec node cli.js login "$ACCOUNT_ID"
