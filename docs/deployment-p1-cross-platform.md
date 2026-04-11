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
  - defaults to a no-sandbox execution path for non-high-risk runs to avoid Windows helper/UAC launch failures
  - keeps deny boundaries and audit records

## One-command install entrypoints

- Linux:
  - `scripts/install.sh`
  - wraps `bootstrap` + `persist-secrets` + `preflight` + optional `install-systemd --enable --start`
  - runs a post-install local health check and writes `install-health.json`
- Windows:
  - `scripts/install.ps1`
  - installs pinned local OpenClaw runtime
  - renders isolated config with `runtimeMode=native_windows_fast`
  - default hosting strategy: `NSSM` service first, fallback to logon scheduled task
  - writes `install-health.json` as the single local status truth

## Preflight contract (P1)

- Linux (`scripts/install.sh`):
  - requires: `bash`, `node`, `npm`, `codex`
  - delegates hard runtime checks to `scripts/bootstrap-codex-feishu.sh preflight`
  - includes `codex sandbox linux -- /bin/true` probe from bootstrap
  - default host paths derive from the current user's home directory unless explicitly overridden (`defaultCwd`, `~/.codex/auth.json`, `~/.codex/config.toml`)
- Windows (`scripts/install.ps1`):
  - requires: `node`, `npm`, `codex`
  - validates `codex --version`
  - resolves codex executable via `CODEX_FEISHU_CODEX_BIN` override, local isolated runtime mirror, `Get-Command`, then WindowsApps fallback
  - validates isolated runtime binary exists after install (`openclaw.cmd`)
  - renders isolated config deterministically from template
  - writes a dedicated launcher script (`openclaw-gateway-run.cmd`)
  - persists required env vars in current user scope for auto-start hosting
  - default host paths derive from the current user's profile directory unless explicitly overridden

## Windows hosting contract (P1)

- Preferred: `NSSM` service (`Hosting=auto` or `Hosting=nssm`)
- Fallback: scheduled task at user logon (`Hosting=task` or auto when `NSSM` absent)
- Skip registration: `Hosting=none` (manual foreground mode only)
- Installer parameters:
  - `-Hosting auto|nssm|task|none`
  - `-BasePort <int>`
  - `-NoStart` to register without immediate start

## Windows acceptance checklist (operator runbook)

1. Open a new PowerShell terminal.
2. Set required env vars:
   - `$env:CODEX_FEISHU_APP_ID="cli_xxx"`
   - `$env:CODEX_FEISHU_APP_SECRET="xxx"`
3. Run installer:
   - `.\scripts\install.ps1` (default `Hosting=auto`)
4. Confirm hosting mode:
   - If `NSSM` is installed, confirm service exists:
     - `nssm status openclaw-codex-feishu`
   - Otherwise confirm scheduled task exists:
     - `Get-ScheduledTask -TaskName "OpenClaw Codex Feishu"`
5. Verify process is alive:
   - `Get-Process -Name node,openclaw -ErrorAction SilentlyContinue`
6. In Feishu DM, run:
   - `/codex doctor`
7. Run one smoke task:
   - `/codex --cd <path> 帮我执行 pwd 并总结目录结构`
8. Confirm lifecycle reaches `awaiting_input`.

## Windows troubleshooting (P1)

- `missing required env var`:
  - Ensure `CODEX_FEISHU_APP_ID` and `CODEX_FEISHU_APP_SECRET` are set before running installer.
- `hosting=nssm requested, but nssm is not installed`:
  - Use `-Hosting auto` (fallback to task) or install NSSM and retry.
- Feishu has no response after installation:
  - Re-run with `-NoStart:$false` and check service/task status.
  - Use `/codex doctor` to inspect runtime summary.
- `codex-bridge cwd fallback: requested cwd missing (...)` appears in log:
  - This is an expected self-healing warning on Windows when a stale task contains an invalid historical `cwd`.
  - Bridge will automatically fall back to profile/default cwd and continue processing instead of crashing the gateway.

## Install health file (single local truth)

- Path:
  - Linux: `.isolated/codex-feishu/state/install-health.json`
  - Windows: `.isolated/codex-feishu/state/install-health.json`
- Purpose:
  - records latest installer outcome, selected hosting mode, and basic liveness checks
  - operators should check this file first before deeper debugging
- Linux foreground truth:
  - when `scripts/install.sh --no-systemd` is used, `hostingMode` stays `foreground`
  - `serviceActive` is recorded as `skipped`, not `unknown`
  - `message=foreground_manual_start_required` means install finished and the next operator step is to run `gateway-run` manually

## Required environment

- `CODEX_FEISHU_APP_ID`
- `CODEX_FEISHU_APP_SECRET`

Optional:

- `CODEX_FEISHU_GATEWAY_TOKEN`
- `CODEXZH_API_KEY`
- `CODEX_FEISHU_CODEX_BIN` (explicit codex executable path override on Windows)

## Smoke test checklist

1. Run installer script successfully.
2. Start gateway (service on Linux, foreground command on Windows).
3. Send `/codex doctor` and ensure runtime summary is returned.
4. Send one explicit start command:
   - `/codex --cd <path> <prompt>`
5. Confirm task lifecycle reaches `awaiting_input`.
