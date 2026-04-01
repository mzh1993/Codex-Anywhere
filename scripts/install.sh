#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_SCRIPT="${REPO_ROOT}/scripts/bootstrap-codex-feishu.sh"

RUNTIME_MODE="${RUNTIME_MODE:-secure_linux}"
BASE_PORT="${BASE_PORT:-19789}"
ENABLE_SYSTEMD=1
START_SYSTEMD=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

One-command installer for Linux hosts.

Options:
  --runtime-mode MODE  secure_linux | native_windows_fast (default: ${RUNTIME_MODE})
  --base-port PORT     Gateway base port (default: ${BASE_PORT})
  --no-systemd         Do not enable/start the user systemd service
  -h, --help           Show this help

Required environment:
  CODEX_FEISHU_APP_ID
  CODEX_FEISHU_APP_SECRET

Optional environment:
  CODEX_FEISHU_GATEWAY_TOKEN
  CODEXZH_API_KEY
EOF
}

log() {
  printf '[install] %s\n' "$*"
}

die() {
  printf '[install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --runtime-mode)
        RUNTIME_MODE="$2"
        shift 2
        ;;
      --base-port)
        BASE_PORT="$2"
        shift 2
        ;;
      --no-systemd)
        ENABLE_SYSTEMD=0
        START_SYSTEMD=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  case "${RUNTIME_MODE}" in
    secure_linux|native_windows_fast) ;;
    *) die "invalid runtime mode: ${RUNTIME_MODE}" ;;
  esac

  require_command bash
  require_command node
  require_command npm
  require_command codex

  [[ -n "${CODEX_FEISHU_APP_ID:-}" ]] || die "missing CODEX_FEISHU_APP_ID"
  [[ -n "${CODEX_FEISHU_APP_SECRET:-}" ]] || die "missing CODEX_FEISHU_APP_SECRET"

  log "bootstrap runtime and isolated config"
  "${BOOTSTRAP_SCRIPT}" bootstrap --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}"

  log "persist secrets into isolated state"
  "${BOOTSTRAP_SCRIPT}" persist-secrets --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}"

  log "run preflight checks"
  "${BOOTSTRAP_SCRIPT}" preflight --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}"

  if [[ "${ENABLE_SYSTEMD}" -eq 1 ]]; then
    if command -v systemctl >/dev/null 2>&1; then
      log "install and start user systemd service"
      "${BOOTSTRAP_SCRIPT}" install-systemd --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}" --enable --start
      log "done: systemctl --user status openclaw-codex-feishu.service"
    else
      log "systemctl not found; skip service install"
      log "run foreground: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
    fi
  else
    log "systemd install disabled"
    log "run foreground: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
  fi
}

main "$@"
