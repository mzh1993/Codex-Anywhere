#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_SCRIPT="${REPO_ROOT}/scripts/bootstrap-codex-feishu.sh"
INSTALL_HEALTH_PATH="${REPO_ROOT}/.isolated/codex-feishu/state/install-health.json"

RUNTIME_MODE="${RUNTIME_MODE:-secure_linux}"
BASE_PORT="${BASE_PORT:-19789}"
ENABLE_SYSTEMD=1
START_SYSTEMD=1
HOSTING_MODE="foreground"
SERVICE_ACTIVE="unknown"
GATEWAY_LISTENING="unknown"

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

record_health() {
  local result="$1"
  local message="$2"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "$(dirname "${INSTALL_HEALTH_PATH}")"
  cat >"${INSTALL_HEALTH_PATH}" <<EOF
{
  "timestamp": "${timestamp}",
  "platform": "linux",
  "result": "${result}",
  "message": "${message}",
  "runtimeMode": "${RUNTIME_MODE}",
  "hostingMode": "${HOSTING_MODE}",
  "serviceActive": "${SERVICE_ACTIVE}",
  "gatewayListening": "${GATEWAY_LISTENING}",
  "basePort": ${BASE_PORT}
}
EOF
}

on_error() {
  local code="$1"
  record_health "error" "install_failed"
  printf '[install] ERROR: install failed. next: %s gateway-status --base-port %s --runtime-mode %s\n' \
    "${BOOTSTRAP_SCRIPT}" "${BASE_PORT}" "${RUNTIME_MODE}" >&2
  exit "${code}"
}

post_install_health_check() {
  local status_output
  status_output="$("${BOOTSTRAP_SCRIPT}" gateway-status --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}")"
  if printf '%s\n' "${status_output}" | grep -q "Port check:      listening on ${BASE_PORT}"; then
    GATEWAY_LISTENING="yes"
  else
    GATEWAY_LISTENING="no"
  fi

  if [[ "${HOSTING_MODE}" == "systemd" ]] && command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active --quiet openclaw-codex-feishu.service; then
      SERVICE_ACTIVE="yes"
    else
      SERVICE_ACTIVE="no"
    fi
  else
    SERVICE_ACTIVE="skipped"
  fi

  if [[ "${GATEWAY_LISTENING}" == "yes" ]] || [[ "${SERVICE_ACTIVE}" == "yes" ]]; then
    record_health "ok" "install_completed"
  elif [[ "${HOSTING_MODE}" == "foreground" ]]; then
    record_health "warn" "foreground_manual_start_required"
    log "post-check: foreground hosting is not started automatically"
    log "next: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
  else
    record_health "warn" "service_not_active_after_install"
    log "post-check warning: gateway not confirmed as listening yet"
    log "next: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
  fi
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
  trap 'on_error $?' ERR
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
      HOSTING_MODE="systemd"
      log "install and start user systemd service"
      "${BOOTSTRAP_SCRIPT}" install-systemd --base-port "${BASE_PORT}" --runtime-mode "${RUNTIME_MODE}" --enable --start
      log "post-check: systemctl --user status openclaw-codex-feishu.service"
    else
      log "systemctl not found; skip service install"
      log "run foreground: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
    fi
  else
    log "systemd install disabled"
    log "run foreground: ${BOOTSTRAP_SCRIPT} gateway-run --base-port ${BASE_PORT} --runtime-mode ${RUNTIME_MODE}"
  fi

  post_install_health_check
  log "install health saved: ${INSTALL_HEALTH_PATH}"
  log "next (Feishu): /codex doctor"
}

main "$@"
