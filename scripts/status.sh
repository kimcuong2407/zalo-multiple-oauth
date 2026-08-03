#!/bin/sh
set -eu

HOST=${ZALO_MULTI_HOST:-127.0.0.1}
PORT=${ZALO_MULTI_PORT:-8786}
BASE_URL=${ZALO_MULTI_BASE_URL:-http://$HOST:$PORT}
BASE_URL=${BASE_URL%/}

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "Error: curl is required to check server status." >&2
  exit 1
fi

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM

if ! curl --fail --silent --show-error --max-time 5 "$BASE_URL/health" >"$TMP_FILE"; then
  printf '\nBridge is not reachable at %s.\n' "$BASE_URL" >&2
  printf '%s\n' "Start it with: ./scripts/start.sh" >&2
  exit 1
fi

printf 'Bridge is running at %s\n' "$BASE_URL"
if command -v python3 >/dev/null 2>&1; then
  python3 -m json.tool <"$TMP_FILE"
else
  cat "$TMP_FILE"
  printf '\n'
fi
