Param(
  [ValidateSet("secure_linux", "native_windows_fast")]
  [string]$RuntimeMode = "native_windows_fast",
  [ValidateSet("auto", "nssm", "task", "none")]
  [string]$Hosting = "auto",
  [int]$BasePort = 19789,
  [string]$OpenClawVersion = "2026.3.22",
  [string]$ProfileName = "codex-feishu",
  [string]$ServiceName = "openclaw-codex-feishu",
  [string]$TaskName = "OpenClaw Codex Feishu",
  [switch]$NoStart
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

function To-UnixPath([string]$PathValue) {
  return ($PathValue -replace "\\", "/")
}

function Set-UserEnvVar([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
}

function Ensure-EnvPersisted([hashtable]$EnvMap) {
  foreach ($entry in $EnvMap.GetEnumerator()) {
    Set-UserEnvVar -Name $entry.Key -Value $entry.Value
  }
}

function Ensure-Directory([string]$PathValue) {
  New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
}

function Write-InstallHealth(
  [string]$PathValue,
  [string]$Result,
  [string]$Message,
  [string]$RuntimeModeValue,
  [string]$HostingModeValue,
  [string]$ServiceActive,
  [string]$TaskActive,
  [int]$PortValue
) {
  Ensure-Directory (Split-Path -Parent $PathValue)
  $payload = @{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    platform = "windows"
    result = $Result
    message = $Message
    runtimeMode = $RuntimeModeValue
    hostingMode = $HostingModeValue
    serviceActive = $ServiceActive
    taskActive = $TaskActive
    basePort = $PortValue
  }
  ($payload | ConvertTo-Json -Depth 4) | Set-Content -Path $PathValue -Encoding UTF8
}

function Write-GatewayLauncherCmd(
  [string]$LauncherPath,
  [string]$RuntimeBin,
  [string]$ConfigOut,
  [string]$OpenClawHome,
  [string]$OpenClawState,
  [string]$XdgConfig,
  [string]$XdgCache,
  [string]$XdgData
) {
  $runtimeBinEscaped = $RuntimeBin.Replace('"', '""')
  $configOutEscaped = $ConfigOut.Replace('"', '""')
  $openClawHomeEscaped = $OpenClawHome.Replace('"', '""')
  $openClawStateEscaped = $OpenClawState.Replace('"', '""')
  $xdgConfigEscaped = $XdgConfig.Replace('"', '""')
  $xdgCacheEscaped = $XdgCache.Replace('"', '""')
  $xdgDataEscaped = $XdgData.Replace('"', '""')
  $runtimeBinDir = Split-Path -Parent $RuntimeBin
  $runtimeBinDirEscaped = $runtimeBinDir.Replace('"', '""')

  $content = @(
    "@echo off",
    "setlocal",
    "set OPENCLAW_HOME=$openClawHomeEscaped",
    "set OPENCLAW_STATE_DIR=$openClawStateEscaped",
    "set OPENCLAW_CONFIG_PATH=$configOutEscaped",
    "set XDG_CONFIG_HOME=$xdgConfigEscaped",
    "set XDG_CACHE_HOME=$xdgCacheEscaped",
    "set XDG_DATA_HOME=$xdgDataEscaped",
    "set PATH=$runtimeBinDirEscaped;%PATH%",
    "if ""%CODEX_FEISHU_APP_ID%""=="""" echo missing CODEX_FEISHU_APP_ID & exit /b 1",
    "if ""%CODEX_FEISHU_APP_SECRET%""=="""" echo missing CODEX_FEISHU_APP_SECRET & exit /b 1",
    """$runtimeBinEscaped"" gateway run --config ""$configOutEscaped""",
    "endlocal"
  ) -join "`r`n"

  Set-Content -Path $LauncherPath -Value $content -Encoding ASCII
}

function Register-WithNssm(
  [string]$LauncherPath,
  [string]$ServiceNameValue,
  [string]$WorkingDir,
  [bool]$StartNow
) {
  $nssm = Get-Command nssm -ErrorAction SilentlyContinue
  if (-not $nssm) {
    return $false
  }

  Write-Log "registering Windows service via NSSM: $ServiceNameValue"
  & $nssm.Source status $ServiceNameValue | Out-Null
  if ($LASTEXITCODE -ne 0) {
    & $nssm.Source install $ServiceNameValue $LauncherPath | Out-Host
  }
  & $nssm.Source set $ServiceNameValue AppDirectory $WorkingDir | Out-Host
  & $nssm.Source set $ServiceNameValue DisplayName "OpenClaw Codex Feishu" | Out-Host
  & $nssm.Source set $ServiceNameValue Description "Codex Feishu bridge gateway" | Out-Host
  & $nssm.Source set $ServiceNameValue Start SERVICE_AUTO_START | Out-Host

  if ($StartNow) {
    & $nssm.Source start $ServiceNameValue | Out-Host
  }
  return $true
}

function Register-WithScheduledTask(
  [string]$LauncherPath,
  [string]$TaskNameValue,
  [bool]$StartNow
) {
  Write-Log "registering logon task: $TaskNameValue"
  $action = New-ScheduledTaskAction -Execute $LauncherPath
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskNameValue -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskNameValue
  }
}

if (-not $IsWindows) {
  throw "scripts/install.ps1 must run on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configTemplate = Join-Path $repoRoot "config/openclaw.codex-feishu.json5"
$runtimeDir = Join-Path $repoRoot ".runtime/openclaw-$OpenClawVersion"
$isolatedRoot = Join-Path $repoRoot ".isolated/$ProfileName"
$openclawHome = Join-Path $isolatedRoot "home"
$stateDir = Join-Path $isolatedRoot "state"
$xdgRoot = Join-Path $isolatedRoot "xdg"
$xdgConfig = Join-Path $xdgRoot "config"
$xdgCache = Join-Path $xdgRoot "cache"
$xdgData = Join-Path $xdgRoot "data"
$workspaceDir = Join-Path $repoRoot "workspaces/$ProfileName"
$configOut = Join-Path $stateDir "openclaw.codex-feishu.windows.json5"
$launcherCmd = Join-Path $stateDir "openclaw-gateway-run.cmd"
$installHealthPath = Join-Path $stateDir "install-health.json"
$gatewayTokenEnv = "CODEX_FEISHU_GATEWAY_TOKEN"
$appIdEnv = "CODEX_FEISHU_APP_ID"
$appSecretEnv = "CODEX_FEISHU_APP_SECRET"
$modelApiEnv = "CODEXZH_API_KEY"
$modelProvider = "codexzh"
$modelId = "gpt-5.4"
$modelBaseUrl = "https://api.codexzh.com/v1"
$feishuDomain = "feishu"
$defaultCwd = To-UnixPath $HOME
$authJsonPath = "$defaultCwd/.codex/auth.json"
$configTomlPath = "$defaultCwd/.codex/config.toml"
$effectiveHostingMode = "none"
$serviceActive = "unknown"
$taskActive = "unknown"

Require-Command "node"
Require-Command "npm"
Require-Command "codex"

$appId = Require-Env $appIdEnv
$appSecret = Require-Env $appSecretEnv
$gatewayToken = [Environment]::GetEnvironmentVariable($gatewayTokenEnv)
$modelApiKey = [Environment]::GetEnvironmentVariable($modelApiEnv)

Write-Log "installing pinned openclaw runtime into $runtimeDir"
Ensure-Directory $runtimeDir
npm install --prefix $runtimeDir "openclaw@$OpenClawVersion" | Out-Host

$runtimeBin = Join-Path $runtimeDir "node_modules/.bin/openclaw.cmd"
if (-not (Test-Path $runtimeBin)) {
  throw "missing openclaw runtime binary: $runtimeBin"
}

Write-Log "preflight: verify codex cli is callable"
$codexVersion = (& codex --version) 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "codex --version failed: $codexVersion"
}

Write-Log "preflight: generate isolated config and launcher"
Ensure-Directory $openclawHome
Ensure-Directory $stateDir
Ensure-Directory $xdgConfig
Ensure-Directory $xdgCache
Ensure-Directory $xdgData
Ensure-Directory $workspaceDir

$template = Get-Content -Path $configTemplate -Raw
$replacement = @{
  "__BASE_PORT__" = "$BasePort"
  "__REPO_ROOT__" = (To-UnixPath $repoRoot)
  "__STATE_DIR__" = (To-UnixPath $stateDir)
  "__WORKSPACE_DIR__" = (To-UnixPath $workspaceDir)
  "__FEISHU_DOMAIN__" = $feishuDomain
  "__GATEWAY_TOKEN_ENV_VAR__" = $gatewayTokenEnv
  "__APP_ID_VALUE__" = $appId
  "__APP_SECRET_ENV_VAR__" = $appSecretEnv
  "__MODEL_PROVIDER_ID__" = $modelProvider
  "__MODEL_ID__" = $modelId
  "__MODEL_BASE_URL__" = $modelBaseUrl
  "__MODEL_API_ENV_VAR__" = $modelApiEnv
  "__RUNTIME_MODE__" = $RuntimeMode
  "__DEFAULT_CWD__" = $defaultCwd
  "__AUTH_JSON_PATH__" = $authJsonPath
  "__CONFIG_TOML_PATH__" = $configTomlPath
}

foreach ($key in $replacement.Keys) {
  $template = $template.Replace($key, $replacement[$key])
}
Set-Content -Path $configOut -Value $template -Encoding UTF8

Write-GatewayLauncherCmd -LauncherPath $launcherCmd -RuntimeBin $runtimeBin -ConfigOut $configOut -OpenClawHome $openclawHome -OpenClawState $stateDir -XdgConfig $xdgConfig -XdgCache $xdgCache -XdgData $xdgData

Write-Log "persisting required env vars in User scope"
Ensure-EnvPersisted @{
  $appIdEnv = $appId
  $appSecretEnv = $appSecret
  $gatewayTokenEnv = $gatewayToken
  $modelApiEnv = $modelApiKey
}

$startNow = -not $NoStart.IsPresent
switch ($Hosting) {
  "none" {
    $effectiveHostingMode = "none"
    Write-Log "hosting registration skipped (--Hosting none)"
  }
  "nssm" {
    if (-not (Register-WithNssm -LauncherPath $launcherCmd -ServiceNameValue $ServiceName -WorkingDir $repoRoot -StartNow:$startNow)) {
      throw "hosting=nssm requested, but nssm is not installed"
    }
    $effectiveHostingMode = "nssm"
  }
  "task" {
    Register-WithScheduledTask -LauncherPath $launcherCmd -TaskNameValue $TaskName -StartNow:$startNow
    $effectiveHostingMode = "task"
  }
  "auto" {
    $registered = Register-WithNssm -LauncherPath $launcherCmd -ServiceNameValue $ServiceName -WorkingDir $repoRoot -StartNow:$startNow
    if (-not $registered) {
      Write-Log "NSSM not found, fallback to scheduled task hosting."
      Register-WithScheduledTask -LauncherPath $launcherCmd -TaskNameValue $TaskName -StartNow:$startNow
      $effectiveHostingMode = "task"
    } else {
      $effectiveHostingMode = "nssm"
    }
  }
}

if ($effectiveHostingMode -eq "nssm") {
  $nssm = Get-Command nssm -ErrorAction SilentlyContinue
  if ($nssm) {
    $nssmStatus = (& $nssm.Source status $ServiceName) 2>&1
    if ($nssmStatus -match "SERVICE_RUNNING") {
      $serviceActive = "yes"
    } else {
      $serviceActive = "no"
    }
  }
}
if ($effectiveHostingMode -eq "task") {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State -in @("Running", "Ready")) {
      $taskActive = "yes"
    } else {
      $taskActive = "no"
    }
  } catch {
    $taskActive = "no"
  }
}

Write-InstallHealth -PathValue $installHealthPath -Result "ok" -Message "install_completed" -RuntimeModeValue $RuntimeMode -HostingModeValue $effectiveHostingMode -ServiceActive $serviceActive -TaskActive $taskActive -PortValue $BasePort

Write-Log "done"
Write-Host ""
Write-Host "Config generated: $configOut"
Write-Host "Runtime mode: $RuntimeMode"
Write-Host "Hosting mode: $effectiveHostingMode"
Write-Host "Launcher: $launcherCmd"
Write-Host "Install health: $installHealthPath"
Write-Host ""
Write-Host "Manual foreground fallback:"
Write-Host "`"$launcherCmd`""
Write-Host ""
Write-Host "Health check after startup:"
Write-Host "/codex doctor"
