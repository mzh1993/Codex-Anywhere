# Deployment P1 (Cross-Platform)

This document defines the current P1 deployment contract for sharing `codex_feishu` to external users.

## Scope

- Target platforms:
  - Ubuntu 20.04 / 22.04
  - Windows 10 / 11 (native, no WSL required)
- Out of scope in P1:
  - macOS one-command installer
  - automatic upgrade/rollback

## Runtime modes

- `secure_linux` (default for Linux)
  - keeps the safety-first approval behavior
- `native_windows_fast` (default for Windows installer)
  - minimizes approval prompts for explicit `/codex` start surface
  - keeps deny boundaries and audit records

## One-command install entrypoints

- Linux:
  - `scripts/install.sh`
  - wraps `bootstrap` + `persist-secrets` + `preflight` + optional `install-systemd --enable --start`
- Windows:
  - `scripts/install.ps1`
  - installs pinned local OpenClaw runtime
  - renders isolated config with `runtimeMode=native_windows_fast`
  - default hosting strategy: `NSSM` service first, fallback to logon scheduled task

## Preflight contract (P1)

- Linux (`scripts/install.sh`):
  - requires: `bash`, `node`, `npm`, `codex`
  - delegates hard runtime checks to `scripts/bootstrap-codex-feishu.sh preflight`
  - includes `codex sandbox linux -- /bin/true` probe from bootstrap
- Windows (`scripts/install.ps1`):
  - requires: `node`, `npm`, `codex`
  - validates `codex --version`
  - validates isolated runtime binary exists after install (`openclaw.cmd`)
  - renders isolated config deterministically from template
  - writes a dedicated launcher script (`openclaw-gateway-run.cmd`)
  - persists required env vars in current user scope for auto-start hosting

## Windows hosting contract (P1)

- Preferred: `NSSM` service (`Hosting=auto` or `Hosting=nssm`)
- Fallback: scheduled task at user logon (`Hosting=task` or auto when `NSSM` absent)
- Skip registration: `Hosting=none` (manual foreground mode only)
- Installer parameters:
  - `-Hosting auto|nssm|task|none`
  - `-NoStart` to register without immediate start

## Required environment

- `CODEX_FEISHU_APP_ID`
- `CODEX_FEISHU_APP_SECRET`

Optional:

- `CODEX_FEISHU_GATEWAY_TOKEN`
- `CODEXZH_API_KEY`

## Smoke test checklist

1. Run installer script successfully.
2. Start gateway (service on Linux, foreground command on Windows).
3. Send `/codex doctor` and ensure runtime summary is returned.
4. Send one explicit start command:
   - `/codex --cd <path> <prompt>`
5. Confirm task lifecycle reaches `awaiting_input`.
