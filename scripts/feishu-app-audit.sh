#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${REPO_ROOT}/.isolated/codex-feishu/state/openclaw-codex-feishu.env"
SECRETS_ENV_FILE="${REPO_ROOT}/.isolated/codex-feishu/state/openclaw-codex-feishu.secrets.env"

die() {
  printf '[feishu-app-audit] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "${ENV_FILE}" ]] || die "missing env file: ${ENV_FILE}"
[[ -f "${SECRETS_ENV_FILE}" ]] || die "missing secrets env file: ${SECRETS_ENV_FILE}"
command -v curl >/dev/null 2>&1 || die "missing required command: curl"
command -v node >/dev/null 2>&1 || die "missing required command: node"

set -a
. "${ENV_FILE}"
. "${SECRETS_ENV_FILE}"
set +a

APP_ID="${CODEX_FEISHU_APP_ID:-}"
APP_SECRET="${CODEX_FEISHU_APP_SECRET:-}"

[[ -n "${APP_ID}" ]] || die "missing CODEX_FEISHU_APP_ID"
[[ -n "${APP_SECRET}" ]] || die "missing CODEX_FEISHU_APP_SECRET"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

TOKEN_JSON="${TMP_DIR}/token.json"
APP_JSON="${TMP_DIR}/app.json"
VERSIONS_JSON="${TMP_DIR}/versions.json"

curl -fsS -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"app_id\":\"${APP_ID}\",\"app_secret\":\"${APP_SECRET}\"}" > "${TOKEN_JSON}"

TENANT_TOKEN="$(
  node - "${TOKEN_JSON}" <<'EOF'
const fs = require("fs");
const file = process.argv[2];
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
if (payload.code !== 0 || !payload.tenant_access_token) {
  process.stderr.write(payload.msg || "failed to get tenant_access_token");
  process.exit(1);
}
process.stdout.write(payload.tenant_access_token);
EOF
)"

curl -fsS \
  -H "Authorization: Bearer ${TENANT_TOKEN}" \
  "https://open.feishu.cn/open-apis/application/v6/applications/${APP_ID}?lang=zh_cn" > "${APP_JSON}"

curl -fsS \
  -H "Authorization: Bearer ${TENANT_TOKEN}" \
  "https://open.feishu.cn/open-apis/application/v6/applications/${APP_ID}/app_versions?page_size=20&lang=zh_cn" > "${VERSIONS_JSON}"

node - "${APP_JSON}" "${VERSIONS_JSON}" <<'EOF'
const fs = require("fs");

const [appFile, versionsFile] = process.argv.slice(2);
const appPayload = JSON.parse(fs.readFileSync(appFile, "utf8"));
const versionsPayload = JSON.parse(fs.readFileSync(versionsFile, "utf8"));

if (appPayload.code !== 0) {
  console.error(`[feishu-app-audit] ERROR: app query failed: ${appPayload.msg || appPayload.code}`);
  process.exit(1);
}

if (versionsPayload.code !== 0) {
  console.error(`[feishu-app-audit] ERROR: app_versions query failed: ${versionsPayload.msg || versionsPayload.code}`);
  process.exit(1);
}

const app = appPayload.data?.app ?? {};
const versions = Array.isArray(versionsPayload.data?.items) ? versionsPayload.data.items : [];
const onlineVersionId = app.online_version_id;
const published = versions.find((item) => item.version_id === onlineVersionId) ?? versions[0] ?? null;
const events = Array.isArray(published?.events) ? published.events : [];
const visibility = published?.remark?.visibility ?? null;
const creatorId = app.creator_id ?? "";
const openIds = Array.isArray(visibility?.visible_list?.open_ids) ? visibility.visible_list.open_ids : [];
const departmentIds = Array.isArray(visibility?.visible_list?.department_ids) ? visibility.visible_list.department_ids : [];
const groupIds = Array.isArray(visibility?.visible_list?.group_ids) ? visibility.visible_list.group_ids : [];
const invisibleOpenIds = Array.isArray(visibility?.invisible_list?.open_ids) ? visibility.invisible_list.open_ids : [];

const formatTime = (value) => {
  if (!value) return "n/a";
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return String(value);
  return new Date(num * 1000).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
};

const onlyOwnerVisible =
  creatorId &&
  openIds.length === 1 &&
  openIds[0] === creatorId &&
  departmentIds.length === 0 &&
  groupIds.length === 0 &&
  invisibleOpenIds.length === 0;

const hasAnyEvent = (aliases) => aliases.some((alias) => events.includes(alias));
const hasMessageReceive = hasAnyEvent([
  "im.message.receive_v1",
  "Receive message",
  "接收消息"
]);
const hasCardAction = hasAnyEvent([
  "card.action.trigger",
  "Card action trigger",
  "消息卡片回传",
  "卡片行为触发",
  "卡片回传"
]);

let failed = false;

console.log(`[feishu-app-audit] app=${app.app_name || "unknown"} (${app.app_id || "unknown"})`);
console.log(`[feishu-app-audit] callback_type=${app.callback_info?.callback_type || "unknown"} online_version_id=${onlineVersionId || "none"}`);
console.log(`[feishu-app-audit] published_version=${published?.version || "none"} publish_time=${formatTime(published?.publish_time)}`);
console.log(`[feishu-app-audit] published_events=${events.length ? events.join(", ") : "(empty)"}`);
console.log(
  `[feishu-app-audit] visibility=open_ids:${openIds.length} department_ids:${departmentIds.length} group_ids:${groupIds.length}`
);

if (app.callback_info?.callback_type !== "websocket") {
  console.error("[feishu-app-audit] FAIL: 应用回调方式不是 websocket。");
  failed = true;
}

if (!hasMessageReceive) {
  console.error("[feishu-app-audit] FAIL: 已发布版本缺少事件 `im.message.receive_v1`。");
  failed = true;
}

if (!hasCardAction) {
  console.error("[feishu-app-audit] FAIL: 已发布版本缺少事件 `card.action.trigger`。");
  failed = true;
}

if (onlyOwnerVisible) {
  console.error("[feishu-app-audit] FAIL: 已发布版本当前仅对应用创建者可见，普通用户无法给 bot 发消息。");
  failed = true;
}

if (!onlineVersionId) {
  console.error("[feishu-app-audit] FAIL: 当前没有线上发布版本。");
  failed = true;
}

if (failed) {
  console.error("[feishu-app-audit] 建议：在飞书开放平台重新检查“版本管理与发布”和“可用范围”。");
  process.exit(1);
}

console.log("[feishu-app-audit] OK: 应用发布事件与基本可见范围看起来正常。");
EOF
