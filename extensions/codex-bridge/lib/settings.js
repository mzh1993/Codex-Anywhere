import os from "node:os";
import path from "node:path";

const DEFAULT_STATUS_THROTTLE_MS = 15000;
const DEFAULT_HEARTBEAT_MS = 30000;
const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CODEX_HOME_DIRNAME = "codex-home";
const DEFAULT_DEFAULT_CWD = "/home/neousys";
const DEFAULT_LOCALE = "en-US";

export const DEFAULT_ENV_ALLOWLIST = ["HOME", "PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME"];

export function resolveSettings(api) {
  const pluginConfig = api.pluginConfig ?? {};
  const isolatedStateDir =
    normalizePathSetting(process.env.OPENCLAW_STATE_DIR) ||
    normalizePathSetting(api.runtime.config.loadConfig()?.gateway?.stateDir);
  const resolvedStateDir = isolatedStateDir || api.runtime.state.resolveStateDir(api.runtime.config.loadConfig?.() ?? api.config);
  const stateRoot = path.join(resolvedStateDir, "codex-bridge");
  const defaultCwd = normalizePathSetting(pluginConfig.defaultCwd) || DEFAULT_DEFAULT_CWD;
  const hostCodexRoot = path.join(os.homedir(), ".codex");
  const openclawRoot = path.join(os.homedir(), ".openclaw");
  const codexHome = normalizePathSetting(pluginConfig.codexHome) || path.join(stateRoot, DEFAULT_CODEX_HOME_DIRNAME);
  const authJsonPath = normalizePathSetting(pluginConfig.authJsonPath) || path.join(hostCodexRoot, "auth.json");
  const configTomlPath = normalizePathSetting(pluginConfig.configTomlPath) || path.join(hostCodexRoot, "config.toml");

  return {
    locale: normalizeLocale(pluginConfig.locale),
    defaultCwd,
    codexHome,
    hostCodexRoot,
    policyProtectedRoots: [openclawRoot, stateRoot],
    codexBin: normalizeText(pluginConfig.codexBin) || DEFAULT_CODEX_BIN,
    authJsonPath,
    configTomlPath,
    envAllowlist: resolveEnvAllowlist(pluginConfig.envAllowlist),
    stateRoot,
    profilesRoot: path.join(stateRoot, "profiles"),
    tasksRoot: path.join(stateRoot, "tasks"),
    approvalsRoot: path.join(stateRoot, "approvals"),
    runsRoot: path.join(stateRoot, "runs"),
    statusThrottleMs: normalizeInteger(pluginConfig.statusThrottleMs) || DEFAULT_STATUS_THROTTLE_MS,
    heartbeatMs: normalizeInteger(pluginConfig.heartbeatMs) || DEFAULT_HEARTBEAT_MS,
    approvalTtlMs: normalizeInteger(pluginConfig.approvalTtlMs) || DEFAULT_APPROVAL_TTL_MS,
  };
}

export function resolveEnvAllowlist(value) {
  if (!Array.isArray(value)) return [...DEFAULT_ENV_ALLOWLIST];
  const allowlist = Array.from(
    new Set(
      value
        .map((entry) => normalizeText(typeof entry === "string" ? entry : ""))
        .filter(Boolean),
    ),
  );
  if (allowlist.length === 0) return [...DEFAULT_ENV_ALLOWLIST];
  return allowlist;
}

function normalizeLocale(value) {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (!normalized) return DEFAULT_LOCALE;
  if (/^zh(?:[-_].*)?$/i.test(normalized)) return "zh-CN";
  return "en-US";
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

function normalizePathSetting(value) {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (!normalized) return "";
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  return normalized;
}
