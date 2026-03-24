#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${REPO_ROOT}/.isolated/codex-feishu/state/openclaw-codex-feishu.env"
SECRETS_ENV_FILE="${REPO_ROOT}/.isolated/codex-feishu/state/openclaw-codex-feishu.secrets.env"
OPENCLAW_BIN="${REPO_ROOT}/.runtime/openclaw-2026.3.22/node_modules/openclaw/openclaw.mjs"
GATEWAY_URL_DEFAULT="ws://127.0.0.1:19789"

die() {
  printf '[openclaw-isolated] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "${ENV_FILE}" ]] || die "missing env file: ${ENV_FILE}"
[[ -f "${SECRETS_ENV_FILE}" ]] || die "missing secrets env file: ${SECRETS_ENV_FILE}"
[[ -x "${OPENCLAW_BIN}" ]] || die "missing local openclaw runtime: ${OPENCLAW_BIN}"

set -a
. "${ENV_FILE}"
. "${SECRETS_ENV_FILE}"
set +a

[[ -n "${CODEX_FEISHU_GATEWAY_TOKEN:-}" ]] || die "missing CODEX_FEISHU_GATEWAY_TOKEN in ${SECRETS_ENV_FILE}"

export OPENCLAW_GATEWAY_TOKEN="${CODEX_FEISHU_GATEWAY_TOKEN}"
export OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-${GATEWAY_URL_DEFAULT}}"

exec "${OPENCLAW_BIN}" "$@"
