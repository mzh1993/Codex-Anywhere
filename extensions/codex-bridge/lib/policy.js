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
const PROCESS_CONTROL_PATTERN =
  /\b(nohup|pm2|supervisorctl|forever|daemonize|uvicorn|gunicorn)\b|\b(?:python|python3)\b[^\n]*\s-m\s+http\.server\b|\bnpx\s+http-server\b|\bflask\b[^\n]*\brun\b|\b(?:python|python3)\b[^\n]*\bmanage\.py\b[^\n]*\brunserver\b/i;
const BACKGROUND_PROCESS_PATTERN = /(?:^|[;\n])[^&\n]*\s&\s*$/;
const GLOBAL_ENV_PATTERN = /\b(npm\s+install\s+-g|pnpm\s+add\s+-g|pip\s+install\s+--user|apt\s+install)\b/i;
const DESTRUCTIVE_PATTERN = /\brm\s+-rf\b|\bdelete\b|\btruncate\b/i;
const READ_ONLY_PHRASE_PATTERN = /\b(update me on|keep me updated on)\b/i;
const READ_DISCUSSION_PATTERN =
  /\b(review|summari[sz]e|inspect|check|explain|describe)\b.*\b(move|rename|copy)\b/i;
const READ_INTENT_PATTERN = /\b(read|show|list|summari[sz]e|inspect|check|review|view)\b|读取|查看|列出|总结|检查/i;
const WRITE_COMMAND_PATTERN =
  /(?:^|\s)(?:cp|mv|tee|install|touch|mkdir|ln|rsync)\b|\b(?:echo|printf|cat)\b[^\n]*>>?|\bsed\s+-i\b/i;
const WRITE_INTENT_PATTERN =
  /\b(write|append|create|modify|edit|update|save|rewrite|replace|move|rename|copy|touch|mkdir)\b|写入|追加|创建|修改|编辑|更新|保存|覆盖|移动|重命名|复制/i;

export function assessPolicyDecision(input) {
  const assessment = createPolicyAssessment(input);

  if (assessment.touchesIsolationBoundary || assessment.touchesProtectedRoots) {
    return deny("isolation_boundary_denied");
  }

  const reasonCodes = [];
  if (assessment.requiresServiceApproval) {
    reasonCodes.push("service_control_requires_approval");
  }
  if (assessment.requiresProcessControlApproval) {
    reasonCodes.push("process_control_requires_approval");
  }
  if (assessment.touchesHostCodexRoot) {
    reasonCodes.push("host_mutation_requires_approval");
  }
  if (assessment.writesOutsideControlledRoots) {
    reasonCodes.push("host_mutation_requires_approval");
  }
  if (assessment.requiresGlobalEnvApproval) {
    reasonCodes.push("global_env_change_requires_approval");
  }
  if (assessment.requiresDestructiveApproval) {
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

function createPolicyAssessment(input) {
  const prompt = normalizeText(input?.prompt);
  const lowerPrompt = prompt.toLowerCase();
  const cwd = normalizeText(input?.cwd);
  const protectedRoots = normalizeRoots(input?.protectedRoots);
  const hostCodexRoot = normalizeText(input?.hostCodexRoot);
  const controlledRoots = cwd ? [cwd] : [];
  const referencedPaths = extractReferencedPaths(prompt, cwd);
  const action = classifyAction(prompt);

  return {
    prompt,
    lowerPrompt,
    cwd,
    protectedRoots,
    hostCodexRoot,
    controlledRoots,
    referencedPaths,
    action,
    touchesIsolationBoundary: touchesIsolationBoundary(lowerPrompt),
    touchesProtectedRoots:
      isPathInsideAny(cwd, protectedRoots) || referencesPathInsideAny(referencedPaths, protectedRoots),
    touchesHostCodexRoot: hostCodexRoot
      ? isPathInsideAny(cwd, [hostCodexRoot]) ||
        referencesPathInsideAny(referencedPaths, [hostCodexRoot]) ||
        lowerPrompt.includes(hostCodexRoot.toLowerCase()) ||
        lowerPrompt.includes("~/.codex")
      : false,
    writesOutsideControlledRoots:
      action === "write" && referencedPaths.some((candidatePath) => !isPathInsideAny(candidatePath, controlledRoots)),
    requiresServiceApproval: SERVICE_CONTROL_PATTERN.test(prompt),
    requiresProcessControlApproval:
      PROCESS_CONTROL_PATTERN.test(prompt) || BACKGROUND_PROCESS_PATTERN.test(prompt),
    requiresGlobalEnvApproval: GLOBAL_ENV_PATTERN.test(prompt),
    requiresDestructiveApproval: DESTRUCTIVE_PATTERN.test(prompt),
  };
}

function classifyAction(prompt) {
  if (READ_ONLY_PHRASE_PATTERN.test(prompt)) return "read";
  if (READ_DISCUSSION_PATTERN.test(prompt)) return "read";
  if (WRITE_COMMAND_PATTERN.test(prompt)) return "write";
  if (WRITE_INTENT_PATTERN.test(prompt)) return "write";
  if (READ_INTENT_PATTERN.test(prompt)) return "read";
  return "none";
}

function normalizeRoots(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function referencesPathInsideAny(candidatePaths, roots) {
  return candidatePaths.some((candidatePath) => isPathInsideAny(candidatePath, roots));
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
