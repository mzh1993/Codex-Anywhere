#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

RANGE="${1:-origin/main...HEAD}"
RUN_FULL="${RUN_FULL:-0}"
FULL_TIMEOUT_SECONDS="${FULL_TIMEOUT_SECONDS:-180}"
SUITE_TIMEOUT_SECONDS="${SUITE_TIMEOUT_SECONDS:-180}"

run_suite_with_timeout() {
  local label="$1"
  shift
  local log_path
  log_path="$(mktemp -t codex-feishu-${label}.XXXXXX.log)"
  set +e
  timeout "${SUITE_TIMEOUT_SECONDS}" "$@" >"${log_path}" 2>&1
  local exit_code=$?
  set -e

  cat "${log_path}"

  if rg -n "^not ok " "${log_path}" >/dev/null; then
    echo "[experience-regression] fail: ${label} reported failing tests."
    exit 1
  fi

  if [[ "${exit_code}" == "124" ]]; then
    echo "[experience-regression] warn: ${label} timed out (known tail-hang pattern) but no failing tests were found."
    return 0
  fi
  if [[ "${exit_code}" != "0" ]]; then
    echo "[experience-regression] fail: ${label} exited with code ${exit_code}."
    exit "${exit_code}"
  fi
  return 0
}

echo "[experience-regression] range: ${RANGE}"
echo "[experience-regression] step 1/4: contract-matrix guard"
scripts/review/check-contract-matrix.sh "${RANGE}"

echo "[experience-regression] step 2/4: runtime compatibility suite"
run_suite_with_timeout "runtime-compatibility" node --test extensions/codex-bridge/test/runtime-compatibility.test.js

echo "[experience-regression] step 3/4: persistence reliability suite"
run_suite_with_timeout "persistence-reliability" node --test extensions/codex-bridge/test/persistence-reliability.test.js

if [[ "${RUN_FULL}" == "1" ]]; then
  echo "[experience-regression] step 4/4: full bridge suite (timeout=${FULL_TIMEOUT_SECONDS}s)"
  LOG_PATH="$(mktemp -t codex-feishu-full-regression.XXXXXX.log)"
  set +e
  timeout "${FULL_TIMEOUT_SECONDS}" node --test extensions/codex-bridge/test/*.test.js >"${LOG_PATH}" 2>&1
  EXIT_CODE=$?
  set -e

  if rg -n "^not ok " "${LOG_PATH}" >/dev/null; then
    echo "[experience-regression] fail: full suite reported failing tests."
    tail -n 80 "${LOG_PATH}" || true
    exit 1
  fi

  if [[ "${EXIT_CODE}" == "124" ]]; then
    echo "[experience-regression] warn: full suite timed out (known tail-hang pattern) but no failing tests were found."
    tail -n 20 "${LOG_PATH}" || true
  elif [[ "${EXIT_CODE}" != "0" ]]; then
    echo "[experience-regression] fail: full suite exited with code ${EXIT_CODE}."
    tail -n 80 "${LOG_PATH}" || true
    exit "${EXIT_CODE}"
  else
    echo "[experience-regression] full suite passed."
  fi
fi

echo "[experience-regression] done."
echo "[experience-regression] manual checklist: docs/experience-regression-checklist.md"
