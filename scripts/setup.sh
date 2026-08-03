#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "Error: Node.js is not installed. Install Node.js 18 or newer, then run this script again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' "Error: npm is not installed. Install npm with Node.js, then run this script again." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf 'Error: Node.js 18 or newer is required; found %s.\n' "$(node --version)" >&2
  exit 1
fi

printf 'Node.js: %s\n' "$(node --version)"
printf 'npm: %s\n' "$(npm --version)"
printf 'Project: %s\n\n' "$PROJECT_DIR"

cd "$PROJECT_DIR"
printf '%s\n' "Installing dependencies from package-lock.json..."
if ! npm ci; then
  printf '\n%s\n' "Dependency installation failed." >&2
  if [ "$(uname -s)" = "Darwin" ]; then
    printf '%s\n' "If better-sqlite3 could not build, run: xcode-select --install" >&2
  fi
  exit 1
fi

printf '\n%s\n' "Setup completed."
printf '%s\n' "Next steps:"
printf '%s\n' "  1. Login: ./scripts/login.sh personal"
printf '%s\n' "  2. Start: ./scripts/start.sh"
