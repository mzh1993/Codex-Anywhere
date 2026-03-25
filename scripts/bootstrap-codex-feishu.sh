#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OPENCLAW_VERSION_DEFAULT="2026.3.22"
PROFILE_NAME_DEFAULT="codex-feishu"
BASE_PORT_DEFAULT="19789"
FEISHU_DOMAIN_DEFAULT="feishu"
GATEWAY_TOKEN_ENV_VAR_DEFAULT="CODEX_FEISHU_GATEWAY_TOKEN"
APP_ID_ENV_VAR_DEFAULT="CODEX_FEISHU_APP_ID"
APP_SECRET_ENV_VAR_DEFAULT="CODEX_FEISHU_APP_SECRET"
MODEL_PROVIDER_ID_DEFAULT="codexzh"
MODEL_ID_DEFAULT="gpt-5.4"
MODEL_BASE_URL_DEFAULT="https://api.codexzh.com/v1"
MODEL_API_ENV_VAR_DEFAULT="CODEXZH_API_KEY"
LOCAL_CODEX_AUTH_JSON_DEFAULT="${HOME}/.codex/auth.json"
SYSTEMD_UNIT_NAME_DEFAULT="openclaw-codex-feishu.service"
SYSTEMD_MARKER="# Managed by codex_feishu bootstrap"
CONFLICT_PORT_SPACING=20
MIN_BWRAP_VERSION="0.9.0"
HOST_BWRAP_BIN="/usr/bin/bwrap"

OPENCLAW_VERSION="${OPENCLAW_VERSION_DEFAULT}"
PROFILE_NAME="${PROFILE_NAME_DEFAULT}"
BASE_PORT="${BASE_PORT_DEFAULT}"
FEISHU_DOMAIN="${FEISHU_DOMAIN_DEFAULT}"
GATEWAY_TOKEN_ENV_VAR="${GATEWAY_TOKEN_ENV_VAR_DEFAULT}"
APP_ID_ENV_VAR="${APP_ID_ENV_VAR_DEFAULT}"
APP_SECRET_ENV_VAR="${APP_SECRET_ENV_VAR_DEFAULT}"
MODEL_PROVIDER_ID="${MODEL_PROVIDER_ID_DEFAULT}"
MODEL_ID="${MODEL_ID_DEFAULT}"
MODEL_BASE_URL="${MODEL_BASE_URL_DEFAULT}"
MODEL_API_ENV_VAR="${MODEL_API_ENV_VAR_DEFAULT}"
LOCAL_CODEX_AUTH_JSON="${LOCAL_CODEX_AUTH_JSON_DEFAULT}"
APP_ID_VALUE="${APP_ID_VALUE:-}"
ENABLE_SYSTEMD=0
START_SYSTEMD=0

EXISTING_OPENCLAW_HOME="${HOME}/.openclaw"
EXISTING_OPENCLAW_CONFIG="${EXISTING_OPENCLAW_HOME}/openclaw.json"
EXISTING_SHARED_BRIDGE_STATE="${EXISTING_OPENCLAW_HOME}/codex-bridge"
EXISTING_SYSTEMD_DIR="${HOME}/.config/systemd/user"

RUNTIME_DIR="${REPO_ROOT}/.runtime/openclaw-${OPENCLAW_VERSION}"
ISOLATED_ROOT="${REPO_ROOT}/.isolated/${PROFILE_NAME}"
OPENCLAW_HOME_DIR="${ISOLATED_ROOT}/home"
OPENCLAW_STATE_DIR="${ISOLATED_ROOT}/state"
XDG_ROOT="${ISOLATED_ROOT}/xdg"
XDG_CONFIG_DIR="${XDG_ROOT}/config"
XDG_CACHE_DIR="${XDG_ROOT}/cache"
XDG_DATA_DIR="${XDG_ROOT}/data"
WORKSPACE_DIR="${REPO_ROOT}/workspaces/${PROFILE_NAME}"
CONFIG_TEMPLATE="${REPO_ROOT}/config/openclaw.codex-feishu.json5"
CONFIG_OUT="${OPENCLAW_STATE_DIR}/openclaw.codex-feishu.json5"
ENV_FILE="${OPENCLAW_STATE_DIR}/openclaw-codex-feishu.env"
SECRETS_ENV_FILE="${OPENCLAW_STATE_DIR}/openclaw-codex-feishu.secrets.env"
SYSTEMD_UNIT_PATH="${EXISTING_SYSTEMD_DIR}/${SYSTEMD_UNIT_NAME_DEFAULT}"
LOCAL_OPENCLAW_BIN=""

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [options]

Commands:
  bootstrap         Install pinned local openclaw runtime + render config
  preflight         Run fail-closed isolation checks
  render-config     Render config/openclaw.codex-feishu.json5 into isolated state
  gateway-run       Run the isolated gateway in the foreground
  gateway-status    Query the isolated gateway status with the local runtime
  codex-onboard     Compatibility shim; current model path does not require OAuth
  codex-login       Compatibility shim; current model path does not require OAuth
  persist-secrets   Persist isolated Feishu App ID / App Secret for service use
  install-systemd   Generate a dedicated systemd user unit without gateway install
  print-env         Print the isolated environment variables
  help              Show this message

Options:
  --runtime-dir PATH         Override runtime installation directory
  --home-dir PATH            Override OPENCLAW_HOME
  --state-dir PATH           Override OPENCLAW_STATE_DIR
  --xdg-root PATH            Override XDG root (config/cache/data derive from it)
  --workspace-dir PATH       Override isolated workspace path
  --config-out PATH          Override rendered config path
  --base-port PORT           Override gateway base port (default: ${BASE_PORT_DEFAULT})
  --openclaw-version VER     Override pinned OpenClaw version (default: ${OPENCLAW_VERSION_DEFAULT})
  --feishu-domain VALUE      feishu | lark | https://... (default: ${FEISHU_DOMAIN_DEFAULT})
  --gateway-token-env VAR    Env var name for the isolated gateway auth token
  --app-id VALUE             Compare this Feishu App ID in preflight
  --app-id-env VAR           Env var name for the isolated Feishu App ID
  --app-secret-env VAR       Env var name for the isolated Feishu App Secret
  --model-provider-id VALUE  Custom provider id (default: ${MODEL_PROVIDER_ID_DEFAULT})
  --model-id VALUE           Custom provider model id (default: ${MODEL_ID_DEFAULT})
  --model-base-url URL       Custom provider base URL (default: ${MODEL_BASE_URL_DEFAULT})
  --model-api-env VAR        Env var name for custom provider API key
  --local-codex-auth PATH    Local Codex auth.json path for API-key reuse
  --systemd-unit-path PATH   Override generated systemd user unit path
  --enable                   With install-systemd, run systemctl --user enable
  --start                    With install-systemd, run systemctl --user start

Environment:
  ${GATEWAY_TOKEN_ENV_VAR_DEFAULT}  Gateway auth token for this isolated instance
  ${APP_ID_ENV_VAR_DEFAULT}      New isolated Feishu App ID
  ${APP_SECRET_ENV_VAR_DEFAULT}  New isolated Feishu App Secret
  ${MODEL_API_ENV_VAR_DEFAULT}   API key for ${MODEL_PROVIDER_ID_DEFAULT} (falls back to ${LOCAL_CODEX_AUTH_JSON_DEFAULT})

Notes:
  - This script intentionally never calls the global "openclaw gateway install".
  - The rendered config and all state live under this repository's isolated paths.
  - systemd service credentials are stored in ${SECRETS_ENV_FILE}.
EOF
}

log() {
  printf '[codex-feishu] %s\n' "$*"
}

die() {
  printf '[codex-feishu] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

version_ge() {
  local current="$1"
  local minimum="$2"
  [[ "$(printf '%s\n%s\n' "${minimum}" "${current}" | sort -V | head -n1)" == "${minimum}" ]]
}

detect_bwrap_version() {
  "${HOST_BWRAP_BIN}" --version 2>&1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true
}

probe_codex_linux_sandbox() {
  local output
  if ! output="$(codex sandbox linux -- /bin/true 2>&1)"; then
    output="$(printf '%s' "${output}" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
    die "codex sandbox linux probe failed: ${output}"
  fi
}

resolve_path() {
  readlink -m "$1"
}

sed_escape() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

abs_diff() {
  local left="$1"
  local right="$2"
  if (( left >= right )); then
    echo $(( left - right ))
  else
    echo $(( right - left ))
  fi
}

json_get() {
  local file_path="$1"
  local js_expr="$2"
  node - "$file_path" "$js_expr" <<'EOF'
const fs = require("fs");
const [filePath, expr] = process.argv.slice(2);
try {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const value = Function("data", `return (${expr});`)(data);
  if (value === undefined || value === null) {
    process.stdout.write("");
  } else if (typeof value === "object") {
    process.stdout.write(JSON.stringify(value));
  } else {
    process.stdout.write(String(value));
  }
} catch {
  process.stdout.write("");
}
EOF
}

json_get_file_key() {
  local file_path="$1"
  local key="$2"
  node - "$file_path" "$key" <<'EOF'
const fs = require("fs");
const [filePath, key] = process.argv.slice(2);
try {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const value = raw?.[key];
  process.stdout.write(typeof value === "string" ? value : "");
} catch {
  process.stdout.write("");
}
EOF
}

current_app_id() {
  if [[ -n "${APP_ID_VALUE}" ]]; then
    printf '%s' "${APP_ID_VALUE}"
    return
  fi
  if [[ -n "${!APP_ID_ENV_VAR:-}" ]]; then
    printf '%s' "${!APP_ID_ENV_VAR}"
    return
  fi
  printf ''
}

resolve_model_api_key() {
  if [[ -n "${!MODEL_API_ENV_VAR:-}" ]]; then
    printf '%s' "${!MODEL_API_ENV_VAR}"
    return
  fi
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printf '%s' "${OPENAI_API_KEY}"
    return
  fi
  if [[ -f "${LOCAL_CODEX_AUTH_JSON}" ]]; then
    json_get_file_key "${LOCAL_CODEX_AUTH_JSON}" "OPENAI_API_KEY"
    return
  fi
  printf ''
}

generate_gateway_token() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))'
}

derive_paths() {
  if [[ "${RUNTIME_DIR}" == "${REPO_ROOT}/.runtime/openclaw-${OPENCLAW_VERSION_DEFAULT}" ]]; then
    RUNTIME_DIR="${REPO_ROOT}/.runtime/openclaw-${OPENCLAW_VERSION}"
  fi
  if [[ "${ISOLATED_ROOT}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}" ]]; then
    ISOLATED_ROOT="${REPO_ROOT}/.isolated/${PROFILE_NAME}"
  fi
  if [[ "${OPENCLAW_HOME_DIR}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/home" ]]; then
    OPENCLAW_HOME_DIR="${ISOLATED_ROOT}/home"
  fi
  if [[ "${OPENCLAW_STATE_DIR}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/state" ]]; then
    OPENCLAW_STATE_DIR="${ISOLATED_ROOT}/state"
  fi
  if [[ "${XDG_ROOT}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/xdg" ]]; then
    XDG_ROOT="${ISOLATED_ROOT}/xdg"
  fi
  if [[ "${XDG_CONFIG_DIR}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/xdg/config" ]]; then
    XDG_CONFIG_DIR="${XDG_ROOT}/config"
  fi
  if [[ "${XDG_CACHE_DIR}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/xdg/cache" ]]; then
    XDG_CACHE_DIR="${XDG_ROOT}/cache"
  fi
  if [[ "${XDG_DATA_DIR}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/xdg/data" ]]; then
    XDG_DATA_DIR="${XDG_ROOT}/data"
  fi
  if [[ "${WORKSPACE_DIR}" == "${REPO_ROOT}/workspaces/${PROFILE_NAME_DEFAULT}" ]]; then
    WORKSPACE_DIR="${REPO_ROOT}/workspaces/${PROFILE_NAME}"
  fi
  if [[ "${CONFIG_OUT}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/state/openclaw.codex-feishu.json5" ]]; then
    CONFIG_OUT="${OPENCLAW_STATE_DIR}/openclaw.codex-feishu.json5"
  fi
  if [[ "${ENV_FILE}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/state/openclaw-codex-feishu.env" ]]; then
    ENV_FILE="${OPENCLAW_STATE_DIR}/openclaw-codex-feishu.env"
  fi
  if [[ "${SECRETS_ENV_FILE}" == "${REPO_ROOT}/.isolated/${PROFILE_NAME_DEFAULT}/state/openclaw-codex-feishu.secrets.env" ]]; then
    SECRETS_ENV_FILE="${OPENCLAW_STATE_DIR}/openclaw-codex-feishu.secrets.env"
  fi
}

ensure_local_openclaw_bin() {
  LOCAL_OPENCLAW_BIN="${RUNTIME_DIR}/node_modules/.bin/openclaw"
}

ensure_directories() {
  mkdir -p \
    "${RUNTIME_DIR}" \
    "${OPENCLAW_HOME_DIR}" \
    "${OPENCLAW_STATE_DIR}" \
    "${XDG_CONFIG_DIR}" \
    "${XDG_CACHE_DIR}" \
    "${XDG_DATA_DIR}" \
    "${WORKSPACE_DIR}" \
    "$(dirname "${CONFIG_OUT}")" \
    "$(dirname "${ENV_FILE}")" \
    "$(dirname "${SECRETS_ENV_FILE}")"
}

write_runtime_package_json() {
  local package_json="${RUNTIME_DIR}/package.json"
  if [[ -f "${package_json}" ]]; then
    return
  fi
  cat >"${package_json}" <<EOF
{
  "name": "codex-feishu-openclaw-runtime",
  "private": true
}
EOF
}

install_runtime() {
  require_command npm
  require_command node
  ensure_directories
  write_runtime_package_json
  ensure_local_openclaw_bin

  if [[ -x "${LOCAL_OPENCLAW_BIN}" ]]; then
    local installed_version
    installed_version="$("${LOCAL_OPENCLAW_BIN}" -v 2>/dev/null | sed -n 's/^OpenClaw //p' | awk '{print $1}')"
    if [[ "${installed_version}" == "${OPENCLAW_VERSION}" ]]; then
      log "local openclaw ${OPENCLAW_VERSION} already installed at ${RUNTIME_DIR}"
      apply_runtime_patches
      return
    fi
  fi

  log "installing isolated openclaw@${OPENCLAW_VERSION} into ${RUNTIME_DIR}"
  npm install \
    --prefix "${RUNTIME_DIR}" \
    --save-exact \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    "openclaw@${OPENCLAW_VERSION}"

  ensure_local_openclaw_bin
  [[ -x "${LOCAL_OPENCLAW_BIN}" ]] || die "local openclaw binary was not created at ${LOCAL_OPENCLAW_BIN}"
  apply_runtime_patches
}

apply_runtime_patches() {
  require_command node
  local monitor_file net_file
  monitor_file="${RUNTIME_DIR}/node_modules/openclaw/dist/monitor-CPPX9Bc9.js"
  net_file="${RUNTIME_DIR}/node_modules/openclaw/dist/net-Dk658jWW.js"
  [[ -f "${monitor_file}" ]] || die "missing monitor file to patch: ${monitor_file}"
  [[ -f "${net_file}" ]] || die "missing network file to patch: ${net_file}"

  node - "${monitor_file}" <<'EOF'
const fs = require("fs");
const filePath = process.argv[2];
let source = fs.readFileSync(filePath, "utf8");

if (!source.includes('claimed by codex bridge')) {
  const needle = `\t\t} else {\n\t\t\tconst ctxPayload = await buildCtxPayloadForAgent(route.agentId, route.sessionKey, route.accountId, ctx.mentionedBot);\n\t\t\tconst identity = resolveAgentOutboundIdentity(cfg, route.agentId);`;
  const replacement = `\t\t} else {\n\t\t\tconst ctxPayload = await buildCtxPayloadForAgent(route.agentId, route.sessionKey, route.accountId, ctx.mentionedBot);\n\t\t\tconst codexBridgeClaim = globalThis.__codexFeishuBridgeClaim;\n\t\t\tif (typeof codexBridgeClaim === "function") try {\n\t\t\t\tconst claimResult = await codexBridgeClaim({\n\t\t\t\t\tchannel: "feishu",\n\t\t\t\t\taccountId: account.accountId,\n\t\t\t\t\tconversationId: ctx.chatId,\n\t\t\t\t\tparentConversationId,\n\t\t\t\t\tsenderId: ctx.senderOpenId,\n\t\t\t\t\tsenderName: ctx.senderName ?? ctx.senderOpenId,\n\t\t\t\t\tmessageId: ctx.messageId,\n\t\t\t\t\tisGroup,\n\t\t\t\t\tcontent: ctx.content,\n\t\t\t\t\tbody: ctx.content,\n\t\t\t\t\tbodyForAgent: ctx.content\n\t\t\t\t}, {\n\t\t\t\t\tchannelId: "feishu",\n\t\t\t\t\taccountId: account.accountId,\n\t\t\t\t\tconversationId: ctx.chatId,\n\t\t\t\t\tparentConversationId,\n\t\t\t\t\tsenderId: ctx.senderOpenId,\n\t\t\t\t\tmessageId: ctx.messageId\n\t\t\t\t});\n\t\t\t\tif (claimResult?.handled) {\n\t\t\t\t\tlog(\`feishu[\${account.accountId}]: claimed by codex bridge (message=\${ctx.messageId})\`);\n\t\t\t\t\tif (isGroup && historyKey && chatHistories) clearHistoryEntriesIfEnabled({\n\t\t\t\t\t\thistoryMap: chatHistories,\n\t\t\t\t\t\thistoryKey,\n\t\t\t\t\t\tlimit: historyLimit\n\t\t\t\t\t});\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t} catch (err) {\n\t\t\t\tlog(\`feishu[\${account.accountId}]: codex bridge claim failed: \${String(err)}\`);\n\t\t\t}\n\t\t\tconst identity = resolveAgentOutboundIdentity(cfg, route.agentId);`;
  if (!source.includes(needle)) {
    console.error(`patch needle not found in ${filePath}`);
    process.exit(1);
  }
  source = source.replace(needle, replacement);
  fs.writeFileSync(filePath, source);
}
EOF

  node - "${net_file}" <<'EOF'
const fs = require("fs");
const filePath = process.argv[2];
let source = fs.readFileSync(filePath, "utf8");

const loopbackNeedle = `\tif (mode === "loopback") {\n\t\tif (await canBindToHost("127.0.0.1")) return "127.0.0.1";\n\t\treturn "0.0.0.0";\n\t}`;
const loopbackReplacement = `\tif (mode === "loopback") return "127.0.0.1";`;
if (source.includes(loopbackNeedle)) {
  source = source.replace(loopbackNeedle, loopbackReplacement);
}

const customNeedle = `\tif (mode === "custom") {\n\t\tconst host = customHost?.trim();\n\t\tif (!host) return "0.0.0.0";\n\t\tif (isValidIPv4(host) && await canBindToHost(host)) return host;\n\t\treturn "0.0.0.0";\n\t}`;
const customReplacement = `\tif (mode === "custom") {\n\t\tconst host = customHost?.trim();\n\t\tif (!host) return "0.0.0.0";\n\t\tif (isValidIPv4(host)) return host;\n\t\treturn "0.0.0.0";\n\t}`;
if (source.includes(customNeedle)) {
  source = source.replace(customNeedle, customReplacement);
}

fs.writeFileSync(filePath, source);
EOF

  log "applied isolated runtime patches in ${monitor_file} and ${net_file}"
}

assert_path_not_shared() {
  local candidate_resolved existing_resolved
  candidate_resolved="$(resolve_path "$1")"
  existing_resolved="$(resolve_path "${EXISTING_OPENCLAW_HOME}")"
  if [[ "${candidate_resolved}" == "${existing_resolved}" ]] || [[ "${candidate_resolved}" == "${existing_resolved}"/* ]]; then
    die "path must not point into ${EXISTING_OPENCLAW_HOME}: ${candidate_resolved}"
  fi
}

run_preflight() {
  require_command node
  require_command codex
  [[ -x "${HOST_BWRAP_BIN}" ]] || die "missing required command: ${HOST_BWRAP_BIN}"

  local bwrap_version
  bwrap_version="$(detect_bwrap_version)"
  [[ -n "${bwrap_version}" ]] || die "failed to detect bubblewrap version from 'bwrap --version'"
  version_ge "${bwrap_version}" "${MIN_BWRAP_VERSION}" || die "${HOST_BWRAP_BIN} must be >= ${MIN_BWRAP_VERSION}; current ${bwrap_version}"
  probe_codex_linux_sandbox

  [[ -f "${CONFIG_TEMPLATE}" ]] || die "missing config template: ${CONFIG_TEMPLATE}"

  if ! [[ "${BASE_PORT}" =~ ^[0-9]+$ ]]; then
    die "base port must be numeric: ${BASE_PORT}"
  fi

  assert_path_not_shared "${OPENCLAW_HOME_DIR}"
  assert_path_not_shared "${OPENCLAW_STATE_DIR}"
  assert_path_not_shared "${XDG_ROOT}"
  assert_path_not_shared "${WORKSPACE_DIR}"
  assert_path_not_shared "${CONFIG_OUT}"
  assert_path_not_shared "${ENV_FILE}"
  assert_path_not_shared "${SECRETS_ENV_FILE}"

  if [[ -e "${EXISTING_SHARED_BRIDGE_STATE}" ]]; then
    die "shared bridge state exists at ${EXISTING_SHARED_BRIDGE_STATE}; remove it before continuing"
  fi

  local existing_port
  existing_port="$(json_get "${EXISTING_OPENCLAW_CONFIG}" 'data?.gateway?.port')"
  if [[ "${existing_port}" =~ ^[0-9]+$ ]]; then
    local port_distance
    port_distance="$(abs_diff "${BASE_PORT}" "${existing_port}")"
    if (( port_distance < CONFLICT_PORT_SPACING )); then
      die "base port ${BASE_PORT} is too close to existing ~/.openclaw gateway port ${existing_port}; need >= ${CONFLICT_PORT_SPACING} spacing"
    fi
  fi

  local requested_app_id existing_app_id
  requested_app_id="$(current_app_id)"
  existing_app_id="$(json_get "${EXISTING_OPENCLAW_CONFIG}" 'data?.channels?.feishu?.appId')"
  if [[ -n "${requested_app_id}" && -n "${existing_app_id}" && "${requested_app_id}" == "${existing_app_id}" ]]; then
    die "isolated Feishu App ID matches existing ~/.openclaw App ID (${existing_app_id}); create a second bot"
  fi

  local unit_path_resolved default_gateway_unit
  unit_path_resolved="$(resolve_path "${SYSTEMD_UNIT_PATH}")"
  default_gateway_unit="$(resolve_path "${EXISTING_SYSTEMD_DIR}/openclaw-gateway.service")"
  if [[ "${unit_path_resolved}" == "${default_gateway_unit}" ]]; then
    die "systemd unit path must not reuse the default openclaw gateway service: ${SYSTEMD_UNIT_PATH}"
  fi

  if [[ -f "${SYSTEMD_UNIT_PATH}" ]] && ! grep -qF "${SYSTEMD_MARKER}" "${SYSTEMD_UNIT_PATH}"; then
    die "refusing to overwrite an unmanaged systemd unit: ${SYSTEMD_UNIT_PATH}"
  fi

  log "preflight passed"
}

render_config() {
  ensure_directories
  run_preflight
  if [[ -z "${!APP_ID_ENV_VAR:-}" ]]; then
    load_secrets_env_file || true
  fi

  local rendered app_id_value
  app_id_value="$(current_app_id)"
  [[ -n "${app_id_value}" ]] || die "missing ${APP_ID_ENV_VAR}; Feishu appId must be available before rendering config"

  local model_api_value
  model_api_value="$(resolve_model_api_key)"
  [[ -n "${model_api_value}" ]] || die "missing ${MODEL_API_ENV_VAR}; export it or provide OPENAI_API_KEY in ${LOCAL_CODEX_AUTH_JSON}"

  rendered="$(sed \
    -e "s|__BASE_PORT__|${BASE_PORT}|g" \
    -e "s|__REPO_ROOT__|$(sed_escape "$(resolve_path "${REPO_ROOT}")")|g" \
    -e "s|__STATE_DIR__|$(sed_escape "$(resolve_path "${OPENCLAW_STATE_DIR}")")|g" \
    -e "s|__WORKSPACE_DIR__|$(sed_escape "$(resolve_path "${WORKSPACE_DIR}")")|g" \
    -e "s|__FEISHU_DOMAIN__|$(sed_escape "${FEISHU_DOMAIN}")|g" \
    -e "s|__GATEWAY_TOKEN_ENV_VAR__|$(sed_escape "${GATEWAY_TOKEN_ENV_VAR}")|g" \
    -e "s|__APP_ID_VALUE__|$(sed_escape "${app_id_value}")|g" \
    -e "s|__APP_SECRET_ENV_VAR__|$(sed_escape "${APP_SECRET_ENV_VAR}")|g" \
    -e "s|__MODEL_PROVIDER_ID__|$(sed_escape "${MODEL_PROVIDER_ID}")|g" \
    -e "s|__MODEL_ID__|$(sed_escape "${MODEL_ID}")|g" \
    -e "s|__MODEL_BASE_URL__|$(sed_escape "${MODEL_BASE_URL}")|g" \
    -e "s|__MODEL_API_ENV_VAR__|$(sed_escape "${MODEL_API_ENV_VAR}")|g" \
    "${CONFIG_TEMPLATE}")"

  printf '%s\n' "${rendered}" >"${CONFIG_OUT}"
  log "rendered config to ${CONFIG_OUT}"
}

write_env_file() {
  ensure_local_openclaw_bin
  local runtime_bin_dir effective_path
  runtime_bin_dir="$(resolve_path "${RUNTIME_DIR}")/node_modules/.bin"
  effective_path="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
  case ":${effective_path}:" in
    *":${runtime_bin_dir}:"*) ;;
    *)
      effective_path="${runtime_bin_dir}:${effective_path}"
      ;;
  esac
  cat >"${ENV_FILE}" <<EOF
OPENCLAW_HOME=$(resolve_path "${OPENCLAW_HOME_DIR}")
OPENCLAW_STATE_DIR=$(resolve_path "${OPENCLAW_STATE_DIR}")
OPENCLAW_CONFIG_PATH=$(resolve_path "${CONFIG_OUT}")
XDG_CONFIG_HOME=$(resolve_path "${XDG_CONFIG_DIR}")
XDG_CACHE_HOME=$(resolve_path "${XDG_CACHE_DIR}")
XDG_DATA_HOME=$(resolve_path "${XDG_DATA_DIR}")
PATH=${effective_path}
EOF
  chmod 600 "${ENV_FILE}"
  log "wrote isolated env file to ${ENV_FILE}"
}

validate_secret_value() {
  local name="$1"
  local value="$2"
  if [[ "${value}" == *$'\n'* ]] || [[ "${value}" == *$'\r'* ]]; then
    die "${name} must not contain newlines"
  fi
  if [[ "${value}" =~ [[:space:]] ]]; then
    die "${name} must not contain whitespace"
  fi
}

write_secrets_env_file() {
  ensure_gateway_token
  local gateway_token_value app_id_value app_secret_value model_api_value
  gateway_token_value="${!GATEWAY_TOKEN_ENV_VAR:-}"
  app_id_value="${!APP_ID_ENV_VAR:-}"
  app_secret_value="${!APP_SECRET_ENV_VAR:-}"
  model_api_value="$(resolve_model_api_key)"

  [[ -n "${gateway_token_value}" ]] || die "missing ${GATEWAY_TOKEN_ENV_VAR}; failed to generate isolated gateway token"
  [[ -n "${app_id_value}" ]] || die "missing ${APP_ID_ENV_VAR}; export the isolated Feishu App ID first"
  [[ -n "${app_secret_value}" ]] || die "missing ${APP_SECRET_ENV_VAR}; export the isolated Feishu App Secret first"
  [[ -n "${model_api_value}" ]] || die "missing ${MODEL_API_ENV_VAR}; export it or provide OPENAI_API_KEY in ${LOCAL_CODEX_AUTH_JSON}"
  validate_secret_value "${GATEWAY_TOKEN_ENV_VAR}" "${gateway_token_value}"
  validate_secret_value "${APP_ID_ENV_VAR}" "${app_id_value}"
  validate_secret_value "${APP_SECRET_ENV_VAR}" "${app_secret_value}"
  validate_secret_value "${MODEL_API_ENV_VAR}" "${model_api_value}"

  cat >"${SECRETS_ENV_FILE}" <<EOF
${GATEWAY_TOKEN_ENV_VAR}=${gateway_token_value}
${APP_ID_ENV_VAR}=${app_id_value}
${APP_SECRET_ENV_VAR}=${app_secret_value}
${MODEL_API_ENV_VAR}=${model_api_value}
EOF
  chmod 600 "${SECRETS_ENV_FILE}"
  log "wrote isolated secrets env file to ${SECRETS_ENV_FILE}"
}

maybe_write_secrets_env_file() {
  if [[ -n "${!APP_ID_ENV_VAR:-}" && -n "${!APP_SECRET_ENV_VAR:-}" ]] && [[ -n "$(resolve_model_api_key)" ]]; then
    write_secrets_env_file
  fi
}

load_secrets_env_file() {
  [[ -f "${SECRETS_ENV_FILE}" ]] || return 1
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -n "${line}" ]] || continue
    [[ "${line}" == *=* ]] || die "invalid secrets env line in ${SECRETS_ENV_FILE}: ${line}"
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      "${GATEWAY_TOKEN_ENV_VAR}"|"${APP_ID_ENV_VAR}"|"${APP_SECRET_ENV_VAR}"|"${MODEL_API_ENV_VAR}")
        printf -v "${key}" '%s' "${value}"
        export "${key}"
        ;;
      *)
        die "unexpected key in ${SECRETS_ENV_FILE}: ${key}"
        ;;
    esac
  done <"${SECRETS_ENV_FILE}"
}

with_isolated_env() {
  local -a env_args
  env_args=(
    "OPENCLAW_HOME=$(resolve_path "${OPENCLAW_HOME_DIR}")"
    "OPENCLAW_STATE_DIR=$(resolve_path "${OPENCLAW_STATE_DIR}")"
    "OPENCLAW_CONFIG_PATH=$(resolve_path "${CONFIG_OUT}")"
    "XDG_CONFIG_HOME=$(resolve_path "${XDG_CONFIG_DIR}")"
    "XDG_CACHE_HOME=$(resolve_path "${XDG_CACHE_DIR}")"
    "XDG_DATA_HOME=$(resolve_path "${XDG_DATA_DIR}")"
    "PATH=$(resolve_path "${RUNTIME_DIR}")/node_modules/.bin:${PATH}"
  )
  if [[ -n "${!APP_ID_ENV_VAR:-}" ]]; then
    env_args+=("${APP_ID_ENV_VAR}=${!APP_ID_ENV_VAR}")
  fi
  if [[ -n "${!APP_SECRET_ENV_VAR:-}" ]]; then
    env_args+=("${APP_SECRET_ENV_VAR}=${!APP_SECRET_ENV_VAR}")
  fi
  if [[ -n "${!GATEWAY_TOKEN_ENV_VAR:-}" ]]; then
    env_args+=("${GATEWAY_TOKEN_ENV_VAR}=${!GATEWAY_TOKEN_ENV_VAR}")
  fi
  if [[ -n "${!MODEL_API_ENV_VAR:-}" ]]; then
    env_args+=("${MODEL_API_ENV_VAR}=${!MODEL_API_ENV_VAR}")
  fi
  env "${env_args[@]}" "$@"
}

ensure_feishu_credentials_for_gateway() {
  if [[ -z "${!APP_ID_ENV_VAR:-}" || -z "${!APP_SECRET_ENV_VAR:-}" ]]; then
    load_secrets_env_file || true
  fi
  [[ -n "${!APP_ID_ENV_VAR:-}" ]] || die "missing ${APP_ID_ENV_VAR}; export the isolated Feishu App ID first"
  [[ -n "${!APP_SECRET_ENV_VAR:-}" ]] || die "missing ${APP_SECRET_ENV_VAR}; export the isolated Feishu App Secret first"
}

ensure_model_api_key() {
  if [[ -z "${!MODEL_API_ENV_VAR:-}" ]]; then
    load_secrets_env_file || true
  fi
  if [[ -z "${!MODEL_API_ENV_VAR:-}" ]]; then
    local model_api_value
    model_api_value="$(resolve_model_api_key)"
    [[ -n "${model_api_value}" ]] || die "missing ${MODEL_API_ENV_VAR}; export it or provide OPENAI_API_KEY in ${LOCAL_CODEX_AUTH_JSON}"
    printf -v "${MODEL_API_ENV_VAR}" '%s' "${model_api_value}"
    export "${MODEL_API_ENV_VAR}"
  fi
}

ensure_gateway_token() {
  if [[ -z "${!GATEWAY_TOKEN_ENV_VAR:-}" ]]; then
    load_secrets_env_file || true
  fi
  if [[ -z "${!GATEWAY_TOKEN_ENV_VAR:-}" ]]; then
    local gateway_token_value
    gateway_token_value="$(generate_gateway_token)"
    [[ -n "${gateway_token_value}" ]] || die "failed to generate ${GATEWAY_TOKEN_ENV_VAR}"
    printf -v "${GATEWAY_TOKEN_ENV_VAR}" '%s' "${gateway_token_value}"
    export "${GATEWAY_TOKEN_ENV_VAR}"
  fi
}

ensure_feishu_credentials_for_service() {
  if [[ -n "${!APP_ID_ENV_VAR:-}" || -n "${!APP_SECRET_ENV_VAR:-}" || -n "$(resolve_model_api_key)" ]]; then
    write_secrets_env_file
    return
  fi
  [[ -f "${SECRETS_ENV_FILE}" ]] || die "missing ${SECRETS_ENV_FILE}; run persist-secrets or export ${APP_ID_ENV_VAR}/${APP_SECRET_ENV_VAR} before install-systemd"
}

cmd_bootstrap() {
  install_runtime
  run_preflight
  render_config
  write_env_file
  maybe_write_secrets_env_file
  log "bootstrap completed"
  log "next: export ${APP_ID_ENV_VAR} / ${APP_SECRET_ENV_VAR}"
  log "      model auth uses ${MODEL_API_ENV_VAR} or ${LOCAL_CODEX_AUTH_JSON}"
  log "      $(basename "$0") gateway-run"
}

cmd_gateway_run() {
  install_runtime
  render_config
  write_env_file
  ensure_gateway_token
  ensure_feishu_credentials_for_gateway
  ensure_model_api_key
  log "starting isolated gateway on port ${BASE_PORT}"
  with_isolated_env "${LOCAL_OPENCLAW_BIN}" gateway run
}

cmd_gateway_status() {
  install_runtime
  render_config
  write_env_file
  printf 'Isolated config: %s\n' "$(resolve_path "${CONFIG_OUT}")"
  printf 'Isolated state:  %s\n' "$(resolve_path "${OPENCLAW_STATE_DIR}")"
  printf 'Isolated home:   %s\n' "$(resolve_path "${OPENCLAW_HOME_DIR}")"
  printf 'Isolated XDG:    %s\n' "$(resolve_path "${XDG_ROOT}")"
  printf 'Workspace:       %s\n' "$(resolve_path "${WORKSPACE_DIR}")"
  printf 'Runtime:         %s\n' "$(resolve_path "${LOCAL_OPENCLAW_BIN}")"
  printf 'Gateway port:    %s\n' "${BASE_PORT}"
  printf 'Systemd unit:    %s\n' "$(resolve_path "${SYSTEMD_UNIT_PATH}")"
  printf 'Secrets env:     %s\n' "$(resolve_path "${SECRETS_ENV_FILE}")"
  printf 'Model provider:  %s/%s\n' "${MODEL_PROVIDER_ID}" "${MODEL_ID}"
  printf 'Model base URL:  %s\n' "${MODEL_BASE_URL}"

  if [[ -f "${SYSTEMD_UNIT_PATH}" ]]; then
    printf 'Service file:    present\n'
  else
    printf 'Service file:    not installed\n'
  fi

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn | awk '{print $4}' | grep -qE "[:.]${BASE_PORT}\$"; then
      printf 'Port check:      listening on %s\n' "${BASE_PORT}"
    else
      printf 'Port check:      not listening on %s\n' "${BASE_PORT}"
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"${BASE_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      printf 'Port check:      listening on %s\n' "${BASE_PORT}"
    else
      printf 'Port check:      not listening on %s\n' "${BASE_PORT}"
    fi
  else
    printf 'Port check:      unavailable (missing ss/lsof)\n'
  fi
}

cmd_codex_onboard() {
  ensure_model_api_key
  log "current model path uses API key provider ${MODEL_PROVIDER_ID}; Codex OAuth is not required"
}

cmd_codex_login() {
  ensure_model_api_key
  log "current model path uses API key provider ${MODEL_PROVIDER_ID}; Codex OAuth is not required"
}

cmd_persist_secrets() {
  ensure_directories
  run_preflight
  write_secrets_env_file
}

generate_systemd_unit() {
  install_runtime
  render_config
  write_env_file
  ensure_feishu_credentials_for_service
  mkdir -p "$(dirname "${SYSTEMD_UNIT_PATH}")"

  cat >"${SYSTEMD_UNIT_PATH}" <<EOF
${SYSTEMD_MARKER}
[Unit]
Description=Isolated OpenClaw Gateway for Codex Feishu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$(resolve_path "${REPO_ROOT}")
EnvironmentFile=$(resolve_path "${ENV_FILE}")
EnvironmentFile=$(resolve_path "${SECRETS_ENV_FILE}")
ExecStart=$(resolve_path "${LOCAL_OPENCLAW_BIN}") gateway run
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

  log "wrote systemd user unit to ${SYSTEMD_UNIT_PATH}"
}

cmd_install_systemd() {
  generate_systemd_unit
  if [[ "$(resolve_path "$(dirname "${SYSTEMD_UNIT_PATH}")")" != "$(resolve_path "${EXISTING_SYSTEMD_DIR}")" ]]; then
    log "unit path is outside ${EXISTING_SYSTEMD_DIR}; skipping systemctl integration"
    return
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemctl not found; unit file generated only"
    return
  fi

  if ! systemctl --user daemon-reload; then
    log "systemctl --user daemon-reload failed; unit file generated only"
    return
  fi
  if (( ENABLE_SYSTEMD == 1 )); then
    systemctl --user enable "$(basename "${SYSTEMD_UNIT_PATH}")"
  fi
  if (( START_SYSTEMD == 1 )); then
    systemctl --user start "$(basename "${SYSTEMD_UNIT_PATH}")"
  fi

  log "systemd unit ready"
  log "manual commands:"
  log "  systemctl --user status $(basename "${SYSTEMD_UNIT_PATH}")"
  log "  systemctl --user enable $(basename "${SYSTEMD_UNIT_PATH}")"
  log "  systemctl --user start $(basename "${SYSTEMD_UNIT_PATH}")"
}

cmd_print_env() {
  ensure_local_openclaw_bin
  cat <<EOF
OPENCLAW_HOME=$(resolve_path "${OPENCLAW_HOME_DIR}")
OPENCLAW_STATE_DIR=$(resolve_path "${OPENCLAW_STATE_DIR}")
OPENCLAW_CONFIG_PATH=$(resolve_path "${CONFIG_OUT}")
XDG_CONFIG_HOME=$(resolve_path "${XDG_CONFIG_DIR}")
XDG_CACHE_HOME=$(resolve_path "${XDG_CACHE_DIR}")
XDG_DATA_HOME=$(resolve_path "${XDG_DATA_DIR}")
WORKSPACE_DIR=$(resolve_path "${WORKSPACE_DIR}")
LOCAL_OPENCLAW_BIN=$(resolve_path "${LOCAL_OPENCLAW_BIN:-${RUNTIME_DIR}/node_modules/.bin/openclaw}")
SECRETS_ENV_FILE=$(resolve_path "${SECRETS_ENV_FILE}")
BASE_PORT=${BASE_PORT}
GATEWAY_TOKEN_ENV_VAR=${GATEWAY_TOKEN_ENV_VAR}
APP_ID_ENV_VAR=${APP_ID_ENV_VAR}
APP_SECRET_ENV_VAR=${APP_SECRET_ENV_VAR}
MODEL_PROVIDER_ID=${MODEL_PROVIDER_ID}
MODEL_ID=${MODEL_ID}
MODEL_BASE_URL=${MODEL_BASE_URL}
MODEL_API_ENV_VAR=${MODEL_API_ENV_VAR}
LOCAL_CODEX_AUTH_JSON=$(resolve_path "${LOCAL_CODEX_AUTH_JSON}")
EOF
}

parse_args() {
  local command="${1:-help}"
  if (($# > 0)); then
    shift
  fi

  while (($# > 0)); do
    case "$1" in
      --runtime-dir)
        RUNTIME_DIR="$2"
        shift 2
        ;;
      --home-dir)
        OPENCLAW_HOME_DIR="$2"
        shift 2
        ;;
      --state-dir)
        OPENCLAW_STATE_DIR="$2"
        shift 2
        ;;
      --xdg-root)
        XDG_ROOT="$2"
        XDG_CONFIG_DIR="${XDG_ROOT}/config"
        XDG_CACHE_DIR="${XDG_ROOT}/cache"
        XDG_DATA_DIR="${XDG_ROOT}/data"
        shift 2
        ;;
      --workspace-dir)
        WORKSPACE_DIR="$2"
        shift 2
        ;;
      --config-out)
        CONFIG_OUT="$2"
        shift 2
        ;;
      --base-port)
        BASE_PORT="$2"
        shift 2
        ;;
      --openclaw-version)
        OPENCLAW_VERSION="$2"
        shift 2
        ;;
      --feishu-domain)
        FEISHU_DOMAIN="$2"
        shift 2
        ;;
      --gateway-token-env)
        GATEWAY_TOKEN_ENV_VAR="$2"
        shift 2
        ;;
      --app-id)
        APP_ID_VALUE="$2"
        shift 2
        ;;
      --app-id-env)
        APP_ID_ENV_VAR="$2"
        shift 2
        ;;
      --app-secret-env)
        APP_SECRET_ENV_VAR="$2"
        shift 2
        ;;
      --model-provider-id)
        MODEL_PROVIDER_ID="$2"
        shift 2
        ;;
      --model-id)
        MODEL_ID="$2"
        shift 2
        ;;
      --model-base-url)
        MODEL_BASE_URL="$2"
        shift 2
        ;;
      --model-api-env)
        MODEL_API_ENV_VAR="$2"
        shift 2
        ;;
      --local-codex-auth)
        LOCAL_CODEX_AUTH_JSON="$2"
        shift 2
        ;;
      --systemd-unit-path)
        SYSTEMD_UNIT_PATH="$2"
        shift 2
        ;;
      --enable)
        ENABLE_SYSTEMD=1
        shift
        ;;
      --start)
        START_SYSTEMD=1
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

  derive_paths
  ensure_local_openclaw_bin

  case "${command}" in
    bootstrap)
      cmd_bootstrap
      ;;
    preflight)
      run_preflight
      ;;
    render-config)
      render_config
      ;;
    gateway-run)
      cmd_gateway_run
      ;;
    gateway-status)
      cmd_gateway_status
      ;;
    codex-onboard)
      cmd_codex_onboard
      ;;
    codex-login)
      cmd_codex_login
      ;;
    persist-secrets)
      cmd_persist_secrets
      ;;
    install-systemd)
      cmd_install_systemd
      ;;
    print-env)
      cmd_print_env
      ;;
    help|"")
      usage
      ;;
    *)
      die "unknown command: ${command}"
      ;;
  esac
}

parse_args "$@"
