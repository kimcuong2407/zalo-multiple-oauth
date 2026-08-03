#!/bin/sh
set -eu

CMD=${1:-help}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
LABEL=com.zalo.multi-bridge
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
HOST=${ZALO_MULTI_HOST:-127.0.0.1}
PORT=${ZALO_MULTI_PORT:-8786}
DATA_DIR=${ZALO_MULTI_DATA_DIR:-$HOME/.zalo-multi-bridge}
LOG_DIR="$DATA_DIR/logs"
NODE_BIN=$(command -v node 2>/dev/null || printf '')

require_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    printf '%s\n' "This script only supports macOS." >&2
    exit 1
  fi
}

require_node() {
  if [ -z "$NODE_BIN" ]; then
    printf '%s\n' "Error: node is not on PATH." >&2
    exit 1
  fi
}

resolve_base_url() {
  printf 'http://%s:%s/health' "$HOST" "$PORT"
}

generate_plist() {
  mkdir -p "$PLIST_DIR"
  mkdir -p "$LOG_DIR"
  cat >"$PLIST_PATH" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ZALO_MULTI_HOST</key>
        <string>$HOST</string>
        <key>ZALO_MULTI_PORT</key>
        <string>$PORT</string>
        <key>ZALO_MULTI_DATA_DIR</key>
        <string>$DATA_DIR</string>
    </dict>
</dict>
</plist>
PLIST_EOF
  printf 'Installed %s\n' "$PLIST_PATH"
}

install_service() {
  require_macos
  require_node
  printf 'Project: %s\n' "$PROJECT_DIR"
  printf 'Node: %s\n' "$NODE_BIN"
  printf 'Data: %s\n' "$DATA_DIR"
  printf 'Host: %s\n' "$HOST"
  printf 'Port: %s\n\n' "$PORT"

  if [ -f "$PLIST_PATH" ]; then
    printf '%s\n' "Existing service found; stopping it first..."
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  fi

  generate_plist
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  launchctl kickstart -kp "gui/$(id -u)/$LABEL" 2>/dev/null || true
  printf '%s\n' "Service installed and started."
  printf 'Health => %s\n' "$(resolve_base_url)"
}

uninstall_service() {
  require_macos
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && \
    printf 'Service unloaded.\n' || \
    printf 'Service was not loaded.\n'
  if [ -f "$PLIST_PATH" ]; then
    rm -f "$PLIST_PATH"
    printf 'Removed %s\n' "$PLIST_PATH"
  fi
  printf '%s\n' "Credentials and message database have NOT been removed."
}

service_status() {
  require_macos
  printf 'launchd status:\n'
  launchctl print "gui/$(id -u)/$LABEL" 2>&1 || true
  printf '\n'
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail --max-time 5 "$(resolve_base_url)" 2>/dev/null && printf 'Health OK: %s\n' "$(resolve_base_url)" || printf 'Health endpoint not reachable at %s\n' "$(resolve_base_url)"
  fi
}

show_logs() {
  require_macos
  if [ ! -d "$LOG_DIR" ]; then
    printf '%s\n' "Log directory does not exist: $LOG_DIR" >&2
    exit 1
  fi
  exec tail -n 100 -f "$LOG_DIR/stdout.log" "$LOG_DIR/stderr.log"
}

restart_service() {
  require_macos
  launchctl kickstart -kp "gui/$(id -u)/$LABEL" 2>/dev/null || {
    printf '%s\n' "Could not restart. Try: ./scripts/service-macos.sh install" >&2
    exit 1
  }
  printf '%s\n' "Service restarted."
}

case "$CMD" in
  install) install_service ;;
  uninstall) uninstall_service ;;
  restart) restart_service ;;
  status) service_status ;;
  logs) show_logs ;;
  *)
    printf '%s\n' "Usage: ./scripts/service-macos.sh <command>" >&2
    printf '%s\n' "Commands: install, uninstall, restart, status, logs" >&2
    exit 1
    ;;
esac
