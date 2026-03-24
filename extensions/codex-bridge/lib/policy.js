import os from "node:os";
import path from "node:path";
import { isPathInsideAny } from "./fs-utils.js";

export const POLICY_DECISIONS = {
  ALLOWED: "allowed",
  APPROVAL_REQUIRED: "approval_required",
  DENIED: "denied",
};

const ISOLATION_BOUNDARY_PATTERNS = [
  "/home/neousys/.openclaw",
  "~/.openclaw",
  "openclaw gateway install",
  "codex_feishu_gateway_token",
];

const SERVICE_CONTROL_PATTERN = /\b(systemctl|systemd)\b|(?:\b(?:start|stop|restart|reload)\b|重启|启动|停止|重载)[^\n]*\.service\b/i;
const GLOBAL_ENV_PATTERN = /\b(npm\s+install\s+-g|pnpm\s+add\s+-g|pip\s+install\s+--user|apt\s+install)\b/i;
const DESTRUCTIVE_PATTERN = /\brm\s+-rf\b|\bdelete\b|\btruncate\b/i;
const WRITE_INTENT_PATTERN =
  /\b(write|append|create|modify|edit|update|save|rewrite|replace|move|rename|copy|touch|mkdir)\b|写入|追加|创建|修改|编辑|更新|保存|覆盖|移动|重命名|复制/i;

export function assessPolicyDecision(input) {
  const prompt = normalizeText(input?.prompt);
  const lowerPrompt = prompt.toLowerCase();
  const cwd = normalizeText(input?.cwd);
  const protectedRoots = Array.isArray(input?.protectedRoots) ? input.protectedRoots.filter(Boolean) : [];
  const hostCodexRoot = normalizeText(input?.hostCodexRoot);
  const controlledRoots = cwd ? [cwd] : [];
  const referencedPaths = extractReferencedPaths(prompt, cwd);
  const writeIntent = hasWriteIntent(prompt);

  if (
    touchesIsolationBoundary(lowerPrompt) ||
    isPathInsideAny(cwd, protectedRoots) ||
    referencedPaths.some((candidatePath) => isPathInsideAny(candidatePath, protectedRoots))
  ) {
    return deny("isolation_boundary_denied");
  }

  const reasonCodes = [];
  if (SERVICE_CONTROL_PATTERN.test(prompt)) {
    reasonCodes.push("service_control_requires_approval");
  }
  if (
    hostCodexRoot &&
    (isPathInsideAny(cwd, [hostCodexRoot]) ||
      referencedPaths.some((candidatePath) => isPathInsideAny(candidatePath, [hostCodexRoot])) ||
      lowerPrompt.includes(hostCodexRoot.toLowerCase()) ||
      lowerPrompt.includes("~/.codex"))
  ) {
    reasonCodes.push("host_mutation_requires_approval");
  }
  if (writeIntent && referencedPaths.some((candidatePath) => !isPathInsideAny(candidatePath, controlledRoots))) {
    reasonCodes.push("host_mutation_requires_approval");
  }
  if (GLOBAL_ENV_PATTERN.test(prompt)) {
    reasonCodes.push("global_env_change_requires_approval");
  }
  if (DESTRUCTIVE_PATTERN.test(prompt)) {
    reasonCodes.push("destructive_change_requires_approval");
  }

  if (reasonCodes.length > 0) {
    return approve(reasonCodes);
  }
  return allow();
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function touchesIsolationBoundary(lowerPrompt) {
  return ISOLATION_BOUNDARY_PATTERNS.some((pattern) => lowerPrompt.includes(pattern));
}

function hasWriteIntent(prompt) {
  return WRITE_INTENT_PATTERN.test(prompt);
}

function extractReferencedPaths(prompt, cwd) {
  if (!prompt) return [];
  const matches = prompt
    .split(/\s+/)
    .map((token) => stripPathPunctuation(token))
    .filter(isPathLikeToken);
  return uniqueStrings(
    matches
      .map((candidate) => resolvePromptPath(candidate, cwd))
      .filter(Boolean),
  );
}

function resolvePromptPath(candidate, cwd) {
  const normalized = normalizeText(candidate);
  if (!normalized) return "";
  if (normalized.startsWith("~/")) {
    return path.resolve(os.homedir(), normalized.slice(2));
  }
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }
  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    if (!cwd) return "";
    return path.resolve(cwd, normalized);
  }
  if (normalized.includes("/") && !normalized.includes("://")) {
    if (!cwd) return "";
    return path.resolve(cwd, normalized);
  }
  return "";
}

function stripPathPunctuation(token) {
  return normalizeText(token).replace(/^[("'`[{<]+|[)"'`\]}>,，。；;:]+$/g, "");
}

function isPathLikeToken(token) {
  if (!token) return false;
  if (token.includes("://")) return false;
  return (
    token.startsWith("~/") ||
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.includes("/")
  );
}

function allow() {
  return { kind: POLICY_DECISIONS.ALLOWED, reasonCodes: [] };
}

function approve(reasonCodes) {
  return { kind: POLICY_DECISIONS.APPROVAL_REQUIRED, reasonCodes: uniqueStrings(reasonCodes) };
}

function deny(reasonCode) {
  return { kind: POLICY_DECISIONS.DENIED, reasonCodes: [reasonCode] };
}

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}
