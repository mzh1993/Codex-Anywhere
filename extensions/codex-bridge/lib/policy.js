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
  "openclaw-codex-feishu.service",
  "codex_feishu_gateway_token",
];

const SERVICE_CONTROL_PATTERN = /\b(systemctl|systemd)\b/i;
const GLOBAL_ENV_PATTERN = /\b(npm\s+install\s+-g|pnpm\s+add\s+-g|pip\s+install\s+--user|apt\s+install)\b/i;
const DESTRUCTIVE_PATTERN = /\brm\s+-rf\b|\bdelete\b|\btruncate\b/i;

export function assessPolicyDecision(input) {
  const prompt = normalizeText(input?.prompt);
  const lowerPrompt = prompt.toLowerCase();
  const cwd = normalizeText(input?.cwd);
  const protectedRoots = Array.isArray(input?.protectedRoots) ? input.protectedRoots.filter(Boolean) : [];
  const hostCodexRoot = normalizeText(input?.hostCodexRoot);

  if (touchesIsolationBoundary(lowerPrompt) || isPathInsideAny(cwd, protectedRoots)) {
    return deny("isolation_boundary_denied");
  }

  const reasonCodes = [];
  if (SERVICE_CONTROL_PATTERN.test(prompt)) {
    reasonCodes.push("service_control_requires_approval");
  }
  if (
    hostCodexRoot &&
    (isPathInsideAny(cwd, [hostCodexRoot]) ||
      lowerPrompt.includes(hostCodexRoot.toLowerCase()) ||
      lowerPrompt.includes("~/.codex"))
  ) {
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
