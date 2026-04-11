#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

RANGE="${1:-}"
if [[ -z "${RANGE}" ]]; then
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    RANGE="origin/main...HEAD"
  elif git rev-parse --verify --quiet HEAD~1 >/dev/null; then
    RANGE="HEAD~1..HEAD"
  else
    echo "[contract-matrix-guard] skip: no comparable git range found."
    exit 0
  fi
fi

declare -A SEEN=()
declare -a CHANGED=()

collect_changed_files() {
  while IFS= read -r file; do
    [[ -n "${file}" ]] || continue
    if [[ -z "${SEEN["${file}"]+x}" ]]; then
      SEEN["${file}"]=1
      CHANGED+=("${file}")
    fi
  done
}

collect_changed_files < <(git diff --name-only "${RANGE}" || true)
collect_changed_files < <(git diff --cached --name-only || true)
collect_changed_files < <(git diff --name-only || true)
collect_changed_files < <(git ls-files --others --exclude-standard || true)

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "[contract-matrix-guard] ok: no changed files in range ${RANGE} or dirty worktree."
  exit 0
fi

needs_matrix=0
matrix_changed=0
declare -a semantic_files=()

for file in "${CHANGED[@]}"; do
  if [[ "${file}" == "docs/contract-matrix.md" ]]; then
    matrix_changed=1
  fi

  case "${file}" in
    extensions/codex-bridge/index.js|extensions/codex-bridge/lib/*|config/openclaw.codex-feishu.json5|docs/feishu-codex-bridge-v1.md|docs/deployment-p1-cross-platform.md|scripts/bootstrap-codex-feishu.sh|scripts/install.sh|scripts/install.ps1|scripts/send-feishu-identify.sh)
      needs_matrix=1
      semantic_files+=("${file}")
      ;;
  esac
done

if [[ "${needs_matrix}" -eq 0 ]]; then
  echo "[contract-matrix-guard] ok: no behavior-semantic files changed in range ${RANGE}."
  exit 0
fi

if [[ "${matrix_changed}" -eq 1 ]]; then
  echo "[contract-matrix-guard] ok: matrix updated with behavior-semantic changes."
  exit 0
fi

echo "[contract-matrix-guard] fail: behavior-semantic files changed but docs/contract-matrix.md was not updated."
echo "[contract-matrix-guard] range: ${RANGE}"
echo "[contract-matrix-guard] semantic files:"
for file in "${semantic_files[@]}"; do
  echo "  - ${file}"
done
echo "[contract-matrix-guard] action: update docs/contract-matrix.md in the same change, or split purely non-semantic edits."
exit 1
