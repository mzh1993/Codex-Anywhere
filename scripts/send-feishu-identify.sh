#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${SCRIPT_DIR}/openclaw-isolated.sh"
SYSTEMD_UNIT="openclaw-codex-feishu.service"

DEFAULT_MESSAGE='请严格原样只输出这一句，不要添加任何前后文：这是新的隔离 Codex Feishu 机器人（AppID 后四位 bbd8，端口 19789）。请在这个会话里回复“你好”或发送 /acp doctor。'
MESSAGE="${DEFAULT_MESSAGE}"
TARGET=""
WAIT_SECONDS=18

usage() {
  cat <<'EOF'
Usage: send-feishu-identify.sh --to <target> [--message <text>] [--wait <seconds>]

Examples:
  ./scripts/send-feishu-identify.sh --to 'user:ou_xxx'
  ./scripts/send-feishu-identify.sh --to 'user:ou_xxx' --wait 25

Notes:
  - This script only talks to the isolated gateway on port 19789.
  - Feishu open_id is app-scoped. An open_id from another bot/app will fail with
    "open_id cross app".
  - For a second Feishu app, proactive DM requires either:
      1) an open_id obtained by this second app itself, or
      2) a tenant-stable user_id plus contact directory authority.
EOF
}

die() {
  printf '[send-feishu-identify] ERROR: %s\n' "$*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --to)
      TARGET="${2:-}"
      shift 2
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    --wait)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "${TARGET}" ]] || {
  usage >&2
  die "--to is required"
}

[[ "${WAIT_SECONDS}" =~ ^[0-9]+$ ]] || die "--wait must be an integer number of seconds"
[[ -x "${CLI}" ]] || die "missing helper script: ${CLI}"

"${CLI}" health --json >/dev/null

START_SINCE="$(date '+%Y-%m-%d %H:%M:%S')"

ADD_JSON="$(
  "${CLI}" cron add \
    --name "identify-new-feishu-bot" \
    --at 10s \
    --session isolated \
    --message "${MESSAGE}" \
    --thinking minimal \
    --light-context \
    --announce \
    --channel feishu \
    --to "${TARGET}" \
    --delete-after-run \
    --json
)"

JOB_ID="$(node -e 'let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{const data=JSON.parse(raw);process.stdout.write(data.id||"");});' <<<"${ADD_JSON}")"
[[ -n "${JOB_ID}" ]] || die "failed to parse cron job id"

sleep "${WAIT_SECONDS}"

RUNS_JSON="$("${CLI}" cron runs --id "${JOB_ID}" --limit 1)"

RUN_STATUS="$(node -e 'let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{const data=JSON.parse(raw);const entry=(data.entries||[])[0]||{};process.stdout.write(String(entry.status||""));});' <<<"${RUNS_JSON}")"
RUN_ERROR="$(node -e 'let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{const data=JSON.parse(raw);const entry=(data.entries||[])[0]||{};process.stdout.write(String(entry.error||""));});' <<<"${RUNS_JSON}")"
RUN_SUMMARY="$(node -e 'let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{const data=JSON.parse(raw);const entry=(data.entries||[])[0]||{};process.stdout.write(String(entry.summary||""));});' <<<"${RUNS_JSON}")"

if [[ "${RUN_STATUS}" == "ok" ]]; then
  printf '[send-feishu-identify] delivered: %s\n' "${RUN_SUMMARY}"
  exit 0
fi

JOURNAL="$(journalctl --user -u "${SYSTEMD_UNIT}" --since "${START_SINCE}" --no-pager || true)"

if printf '%s\n' "${JOURNAL}" | rg -q 'open_id cross app'; then
  cat >&2 <<EOF
[send-feishu-identify] ERROR: delivery failed because the target open_id belongs to another Feishu app.

Target: ${TARGET}
Action:
  1. Let the user first DM the new second-app bot once, then reuse that app-scoped open_id; or
  2. Resolve a tenant-stable user_id and send to user:<tenant_user_id>; or
  3. Grant the second app proper contact directory authority, then resolve user_id/open_id again.
EOF
  exit 2
fi

printf '[send-feishu-identify] ERROR: cron run status=%s error=%s\n' "${RUN_STATUS:-unknown}" "${RUN_ERROR:-unknown}" >&2
if [[ -n "${JOURNAL}" ]]; then
  printf '%s\n' "${JOURNAL}" | tail -n 20 >&2
fi
exit 1
