#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-repo}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

CONTENT_REGEX='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9-]{20,}|sk-proj-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----'
FILENAME_REGEX='(^|/)(\.env(\..*)?|secrets?(\.(env|json|txt))?|auth\.json|id_rsa|id_ed25519|[^/]+\.(pem|key|p12|pfx|jks|kdbx))$'
ALLOWLIST_FILENAME_REGEX='(^|/)(\.env\.example|\.env\.sample|\.env\.template|sample\.env|example\.env)$'

has_issues=0

is_sensitive_filename() {
  local path="$1"
  if printf '%s\n' "${path}" | grep -Eiq "${FILENAME_REGEX}"; then
    if printf '%s\n' "${path}" | grep -Eiq "${ALLOWLIST_FILENAME_REGEX}"; then
      return 1
    fi
    return 0
  fi
  return 1
}

check_filename() {
  local path="$1"
  local scope="$2"
  if is_sensitive_filename "${path}"; then
    printf '[secret-filename][%s] %s\n' "${scope}" "${path}"
    has_issues=1
  fi
}

scan_blob_from_index() {
  local path="$1"
  if git cat-file -e ":${path}" 2>/dev/null; then
    if git show ":${path}" | LC_ALL=C grep -qE "${CONTENT_REGEX}"; then
      printf '[secret-content][staged] %s\n' "${path}"
      has_issues=1
    fi
  fi
}

scan_repo_content() {
  local out
  out="$(git grep -I -E --name-only "${CONTENT_REGEX}" -- . || true)"
  if [[ -n "${out}" ]]; then
    printf '%s\n' "${out}" | while IFS= read -r path; do
      [[ -n "${path}" ]] && printf '[secret-content][repo] %s\n' "${path}"
    done
    has_issues=1
  fi
}

scan_history_content() {
  local commit
  while IFS= read -r commit; do
    [[ -z "${commit}" ]] && continue
    local out
    out="$(git grep -I -E --name-only "${CONTENT_REGEX}" "${commit}" 2>/dev/null || true)"
    if [[ -n "${out}" ]]; then
      printf '%s\n' "${out}" | while IFS= read -r path; do
        [[ -n "${path}" ]] && printf '[secret-content][history][%s] %s\n' "${commit}" "${path}"
      done
      has_issues=1
    fi
  done < <(git rev-list --all)
}

scan_staged() {
  local file
  while IFS= read -r -d '' file; do
    check_filename "${file}" "staged"
    scan_blob_from_index "${file}"
  done < <(git diff --cached --name-only --diff-filter=ACMR -z)
}

scan_repo() {
  local file
  while IFS= read -r file; do
    [[ -z "${file}" ]] && continue
    check_filename "${file}" "repo"
  done < <(git ls-files)
  scan_repo_content
}

scan_history() {
  local file
  while IFS= read -r file; do
    [[ -z "${file}" ]] && continue
    check_filename "${file}" "history"
  done < <(git log --all --name-only --pretty=format: | sed '/^$/d' | sort -u)
  scan_history_content
}

case "${MODE}" in
  staged)
    scan_staged
    ;;
  repo)
    scan_repo
    ;;
  history)
    scan_history
    ;;
  *)
    echo "usage: $0 [staged|repo|history]" >&2
    exit 2
    ;;
esac

if [[ "${has_issues}" -ne 0 ]]; then
  echo "secret leak guard failed (${MODE})"
  exit 1
fi

echo "secret leak guard passed (${MODE})"
