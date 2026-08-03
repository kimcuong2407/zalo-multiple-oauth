#!/bin/sh
set -eu

ACCOUNT_ID=${1:-}
WAIT_SECONDS=${2:-8}
HOST=${ZALO_MULTI_HOST:-127.0.0.1}
PORT=${ZALO_MULTI_PORT:-8786}
BASE_URL=${ZALO_MULTI_BASE_URL:-http://$HOST:$PORT}
BASE_URL=${BASE_URL%/}

if [ -z "$ACCOUNT_ID" ]; then
  printf '%s\n' "Usage: ./scripts/backfill.sh <account-id> [wait-seconds]" >&2
  exit 1
fi

case "$ACCOUNT_ID" in
  *[!A-Za-z0-9_-]*)
    printf '%s\n' "Error: account-id may contain only letters, numbers, underscores, and hyphens." >&2
    exit 1
    ;;
esac

case "$WAIT_SECONDS" in
  *[!0-9]*|'')
    printf '%s\n' "Error: wait-seconds must be an integer from 1 to 60." >&2
    exit 1
    ;;
esac
if [ "$WAIT_SECONDS" -lt 1 ] || [ "$WAIT_SECONDS" -gt 60 ]; then
  printf '%s\n' "Error: wait-seconds must be from 1 to 60." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "Error: curl is required." >&2
  exit 1
fi

WAIT_MS=$((WAIT_SECONDS * 1000))
printf 'Requesting old messages for "%s" (wait %ss)...\n' "$ACCOUNT_ID" "$WAIT_SECONDS"
RESPONSE=$(curl --fail --silent --show-error --max-time "$((WAIT_SECONDS + 10))" \
  -X POST "$BASE_URL/accounts/$ACCOUNT_ID/backfill?wait=$WAIT_MS") || {
  printf '%s\n' "Backfill failed. Check that the bridge is running and the account is active." >&2
  exit 1
}

if command -v python3 >/dev/null 2>&1; then
  printf '%s' "$RESPONSE" | python3 -m json.tool
else
  printf '%s\n' "$RESPONSE"
fi
printf '%s\n' "Run this command again to request an older batch. Backfill is best-effort."
