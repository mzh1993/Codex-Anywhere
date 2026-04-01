Param(
  [ValidateSet("secure_linux", "native_windows_fast")]
  [string]$RuntimeMode = "native_windows_fast",
  [int]$BasePort = 19789,
  [string]$OpenClawVersion = "2026.3.22",
  [string]$ProfileName = "codex-feishu"
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host "[install.ps1] $Message"
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "missing required command: $Name"
  }
}

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "missing required env var: $Name"
  }
  return $value
}

if (-not $IsWindows) {
  throw "scripts/install.ps1 must run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configTemplate = Join-Path $repoRoot "config/openclaw.codex-feishu.json5"
$runtimeDir = Join-Path $repoRoot ".runtime/openclaw-$OpenClawVersion"
$isolatedRoot = Join-Path $repoRoot ".isolated/$ProfileName"
$stateDir = Join-Path $isolatedRoot "state"
$workspaceDir = Join-Path $repoRoot "workspaces/$ProfileName"
$configOut = Join-Path $stateDir "openclaw.codex-feishu.windows.json5"
$gatewayTokenEnv = "CODEX_FEISHU_GATEWAY_TOKEN"
$appIdEnv = "CODEX_FEISHU_APP_ID"
$appSecretEnv = "CODEX_FEISHU_APP_SECRET"
$modelApiEnv = "CODEXZH_API_KEY"
$modelProvider = "codexzh"
$modelId = "gpt-5.4"
$modelBaseUrl = "https://api.codexzh.com/v1"
$feishuDomain = "feishu"

Require-Command "node"
Require-Command "npm"
Require-Command "codex"

$appId = Require-Env $appIdEnv
$null = Require-Env $appSecretEnv

Write-Log "installing pinned openclaw runtime into $runtimeDir"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
npm install --prefix $runtimeDir "openclaw@$OpenClawVersion" | Out-Host

Write-Log "preflight: verify codex cli is callable"
$codexVersion = (& codex --version) 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "codex --version failed: $codexVersion"
}

Write-Log "preflight: generate isolated config"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
New-Item -ItemType Directory -Path $workspaceDir -Force | Out-Null

$template = Get-Content -Path $configTemplate -Raw

$replacement = @{
  "__BASE_PORT__" = "$BasePort"
  "__REPO_ROOT__" = ($repoRoot -replace "\\", "/")
  "__STATE_DIR__" = ($stateDir -replace "\\", "/")
  "__WORKSPACE_DIR__" = ($workspaceDir -replace "\\", "/")
  "__FEISHU_DOMAIN__" = $feishuDomain
  "__GATEWAY_TOKEN_ENV_VAR__" = $gatewayTokenEnv
  "__APP_ID_VALUE__" = $appId
  "__APP_SECRET_ENV_VAR__" = $appSecretEnv
  "__MODEL_PROVIDER_ID__" = $modelProvider
  "__MODEL_ID__" = $modelId
  "__MODEL_BASE_URL__" = $modelBaseUrl
  "__MODEL_API_ENV_VAR__" = $modelApiEnv
  "__RUNTIME_MODE__" = $RuntimeMode
}

foreach ($key in $replacement.Keys) {
  $template = $template.Replace($key, $replacement[$key])
}

Set-Content -Path $configOut -Value $template -Encoding UTF8

$runtimeBin = Join-Path $runtimeDir "node_modules/.bin/openclaw.cmd"
if (-not (Test-Path $runtimeBin)) {
  throw "missing openclaw runtime binary: $runtimeBin"
}

Write-Log "done"
Write-Host ""
Write-Host "Config generated: $configOut"
Write-Host "Runtime mode: $RuntimeMode"
Write-Host ""
Write-Host "Next step (foreground run):"
Write-Host "`"$runtimeBin`" gateway run --config `"$configOut`""
Write-Host ""
Write-Host "Health check after startup:"
Write-Host "/codex doctor"
