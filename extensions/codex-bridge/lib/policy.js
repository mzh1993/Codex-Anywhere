import os from "node:os";
import path from "node:path";
import { isPathInsideAny } from "./fs-utils.js";

export const POLICY_DECISIONS = {
  ALLOWED: "allowed",
  APPROVAL_REQUIRED: "approval_required",
  DENIED: "denied",
};

export const POLICY_ACTIONS = Object.freeze(["read", "write", "none"]);
export const POLICY_INTENTS = Object.freeze(["read", "write", "discussion", "unknown"]);
export const POLICY_EXECUTION_BOUNDARY_KEYS = Object.freeze([
  "insideCwd",
  "outsideCwdWrite",
  "hostCodex",
  "hostSecret",
  "protectedRoot",
  "isolationBoundary",
]);
export const POLICY_EFFECT_KEYS = Object.freeze([
  "serviceControl",
  "schedulerControl",
  "processControl",
  "remoteBoundary",
  "containerControl",
  "publicationBoundary",
  "adminEscalation",
  "policyBypass",
  "globalEnvChange",
  "destructiveChange",
]);
export const POLICY_DENY_REASON_CODES = Object.freeze([
  "isolation_boundary_denied",
  "host_secret_boundary_denied",
  "out_of_scope_admin_denied",
  "policy_bypass_denied",
]);
export const POLICY_APPROVAL_REASON_CODES = Object.freeze([
  "scheduler_control_requires_approval",
  "service_control_requires_approval",
  "process_control_requires_approval",
  "remote_boundary_requires_approval",
  "container_control_requires_approval",
  "publication_boundary_requires_approval",
  "global_env_change_requires_approval",
  "destructive_change_requires_approval",
  "host_codex_boundary_requires_approval",
  "outside_cwd_write_requires_approval",
  "install_lifecycle_requires_approval",
]);
export const POLICY_REASON_CODES = Object.freeze([
  ...POLICY_DENY_REASON_CODES,
  ...POLICY_APPROVAL_REASON_CODES,
]);

const ISOLATION_BOUNDARY_PATTERNS = [
  "/home/neousys/.openclaw",
  "~/.openclaw",
  "openclaw gateway install",
  "codex_feishu_gateway_token",
];
const HOST_SECRET_RELATIVE_ROOTS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".npmrc",
  ".pypirc",
  ".netrc",
];

const SERVICE_CONTROL_PATTERN =
  /(?:^|[;&\n]\s*)(?:systemctl|service|rc-service|invoke-rc\.d|initctl)\b|(?:\b(?:start|stop|restart|reload)\b|重启|启动|停止|重载)[^\n]*\b(?:systemctl|systemd|service|rc-service|invoke-rc\.d|initctl)\b|(?:\b(?:start|stop|restart|reload)\b|重启|启动|停止|重载)[^\n]*\.service(?:[\w.-]+)?\b/i;
const SCHEDULER_CONTROL_PATTERN =
  /(?:^|[;&|\n]\s*)crontab\b|(?:^|[;&|\n]\s*)(?:at|atq|atrm|batch)\b|(?:^|[;&|\n]\s*)systemd-run\b[^\n]*--on-(?:calendar|active|boot|startup|unit-active|unit-inactive)\b|(?:\b(?:start|stop|restart|reload|enable|disable)\b|启动|停止|重启|重载)[^\n]*\.timer\b|\bsystemctl\b[^\n]*\.timer\b/i;
const PROCESS_CONTROL_PATTERN =
  /\b(nohup|pm2|supervisorctl|forever|daemonize|uvicorn|gunicorn)\b|\b(?:python|python3)\b[^\n]*\s-m\s+http\.server\b|\bnpx\s+http-server\b|\bflask\b[^\n]*\brun\b|\b(?:python|python3)\b[^\n]*\bmanage\.py\b[^\n]*\brunserver\b/i;
const BACKGROUND_PROCESS_PATTERN = /(?:^|[;\n])[^&\n]*\s&\s*$/;
const REMOTE_BOUNDARY_PATTERN =
  /(?:^|[;&\n]\s*)(?:ssh|scp|sftp)\s+\S+|(?:^|[;&\n]\s*)rsync\b[^\n]*\b(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+:[^\s]+|(?:^|[;&\n]\s*)curl\b[^\n]*(?:\s-T\s+\S+|\s-F\s+\S*=@\S+)/i;
const ADMIN_ESCALATION_PATTERN = /(?:^|[;&\n]\s*)(?:sudo|su|doas)\b/i;
const POLICY_BYPASS_PATTERN =
  /\b(?:ignore|bypass|disable|turn\s+off)\b[^\n]*\b(?:policy|approval|approvals|sandbox|guardrail|guardrails)\b|(?:绕过|关闭|禁用)(?:审批|策略|沙箱)/i;
const CONTAINER_CONTROL_PATTERN =
  /(?:^|[;&\n]\s*)(?:docker|podman)\b|(?:^|[;&\n]\s*)(?:kubectl|helm)\b/i;
const PUBLICATION_BOUNDARY_PATTERN =
  /(?:^|[;&\n]\s*)git\s+push\b|(?:^|[;&\n]\s*)(?:npm|pnpm)\s+publish\b|(?:^|[;&\n]\s*)twine\s+upload\b|(?:^|[;&\n]\s*)gh\s+release\s+create\b|(?:^|[;&\n]\s*)cargo\s+publish\b/i;
const GLOBAL_ENV_PATTERN = /\b(npm\s+install\s+-g|pnpm\s+add\s+-g|pip\s+install\s+--user|apt\s+install)\b/i;
const DESTRUCTIVE_PATTERN = /\brm\s+-rf\b|\bdelete\b|\btruncate\b/i;
const READ_ONLY_PHRASE_PATTERN = /\b(update me on|keep me updated on)\b/i;
const READ_DISCUSSION_PATTERN =
  /\b(review|summari[sz]e|inspect|check|explain|describe)\b.*\b(move|rename|copy)\b/i;
const READ_INTENT_PATTERN =
  /\b(read|show|list|summari[sz]e|inspect|check|review|view|explain|describe)\b|\bwhat\s+does\b[^\n]*\bsay\s+about\b|读取|查看|列出|总结|检查|解释|说明|(?:里|中)\s*怎么说/i;
const DISCUSSION_HOW_PATTERN =
  /\b(?:explain|describe|summari[sz]e|review|inspect|check)\b[^\n]*\b(?:how|why)\b|(?:解释|说明|总结|检查)[^\n]*(?:如何|为什么)/iu;
const DISCUSSION_TOPIC_PATTERN =
  /\b(?:usage|guide|notes?|docs?|documentation|section|workflow|flow)\b|(?:用法|指南|文档|章节|流程|说明|笔记)/iu;
const DISCUSSION_SOURCE_DOC_PATTERN =
  /\b(?:in|from)\s+\S+\.(?:md|mdx|txt|rst|adoc)\b|在\s*\S+\.(?:md|mdx|txt|rst|adoc)\s*(?:里|中)?|\S+\.(?:md|mdx|txt|rst|adoc)\s*(?:里|中)(?:的)?/iu;
const WRITE_COMMAND_PATTERN =
  /(?:^|\s)(?:cp|mv|tee|install|touch|mkdir|ln|rsync|chmod|chown)\b|\b(?:echo|printf|cat)\b[^\n]*>>?|\bsed\s+-i\b/i;
const WRITE_INTENT_PATTERN =
  /\b(write|append|create|modify|edit|update|save|rewrite|replace|move|rename|copy|touch|mkdir)\b|写入|追加|创建|修改|编辑|更新|保存|覆盖|移动|重命名|复制/i;
const BRIDGE_GATEWAY_HEALTH_PATTERN =
  /(?:(?:检查|查看|确认|帮我检查|帮我看)\s*(?:一下)?\s*)?(?:gateway|runner|bridge)(?:[^\n]{0,18})?(?:health|status|健康|状态)|(?:gateway|runner|bridge)(?:[^\n]{0,18})?(?:health|status|健康|状态)(?:[^\n]{0,12})?(?:检查|查看|确认)?|(?:health|status)(?:[^\n]{0,18})?(?:gateway|runner|bridge)/i;
const BRIDGE_INSTALL_SYSTEMD_PATTERN =
  /\binstall-systemd\b|安装(?:本仓库)?(?:的)?\s*systemd|安装\s*systemd\s*服务|\binstall\b(?:[^\n]{0,18})?\b(?:repo|repository)?(?:[^\n]{0,12})?\bsystemd\b(?:[^\n]{0,12})?\bservice\b/i;
const BRIDGE_DIAGNOSTIC_PATTERN =
  /(?:gateway-status|runner-status)|(?:(?:桥接|bridge|runner|gateway)(?:[^\n]{0,18})?(?:诊断|诊断信息|排障|状态详情|状态信息|diagnostic|diagnostics|diagnostic info|diagnostic details|status info|status details))|(?:(?:diagnostic|diagnostics|diagnostic info|diagnostic details|status info|status details)(?:[^\n]{0,18})?(?:bridge|runner|gateway))/i;

export function assessPolicyDecision(input) {
  const assessment = createPolicyAssessment(input);
  return assessment.decision;
}

export function assessPolicyRequest(input) {
  return createPolicyAssessment(input);
}

export function classifyOwnedBridgeActionRequest(input) {
  const assessment = createBridgeControlAssessment(input);
  return assessment?.decision ?? null;
}

function createBridgeControlAssessment(input) {
  const prompt = normalizeText(input?.prompt);
  if (!prompt) return null;
  const bridgeServiceUnitNames = Array.isArray(input?.bridgeServiceUnitNames)
    ? Array.from(
        new Set(
          input.bridgeServiceUnitNames
            .map((entry) => normalizeText(typeof entry === "string" ? entry : ""))
            .filter(Boolean),
        ),
      )
    : [];

  const intent = createBridgeControlIntentAssessment({ prompt, bridgeServiceUnitNames });
  const effects = createBridgeControlEffectAssessment({ prompt, bridgeServiceUnitNames });
  const routingBoundaries = createBridgeControlRoutingBoundaryAssessment({ intent, effects });
  const decision = createBridgeControlDecisionAssessment({ intent, routingBoundaries, effects });

  return {
    prompt,
    bridgeServiceUnitNames,
    intent,
    routingBoundaries,
    effects,
    decision,
  };
}

function createBridgeControlIntentAssessment({ prompt, bridgeServiceUnitNames }) {
  if (findOwnedServiceTarget(prompt, bridgeServiceUnitNames)) return "bridge_control";
  if (BRIDGE_GATEWAY_HEALTH_PATTERN.test(prompt)) return "bridge_control";
  if (BRIDGE_INSTALL_SYSTEMD_PATTERN.test(prompt)) return "bridge_control";
  if (BRIDGE_DIAGNOSTIC_PATTERN.test(prompt)) return "bridge_control";
  return "unknown";
}

function createBridgeControlEffectAssessment({ prompt, bridgeServiceUnitNames }) {
  return {
    serviceControl: createBridgeServiceControlAssessment(prompt, bridgeServiceUnitNames),
    gatewayHealth: createBridgeGatewayHealthAssessment(prompt),
    installLifecycle: createBridgeInstallLifecycleAssessment(prompt),
    diagnostic: createBridgeDiagnosticAssessment(prompt),
  };
}

function createBridgeControlRoutingBoundaryAssessment({ intent, effects }) {
  const matchedEffects = Object.values(effects).filter(Boolean);
  return {
    dedicatedRequest: matchedEffects.length === 1,
    ambiguousIntent: matchedEffects.length > 1,
    mixedIntent: intent === "bridge_control" && matchedEffects.length === 0,
  };
}

function createBridgeControlDecisionAssessment({ intent, routingBoundaries, effects }) {
  if (intent !== "bridge_control") return null;
  if (
    !routingBoundaries.dedicatedRequest ||
    routingBoundaries.ambiguousIntent ||
    routingBoundaries.mixedIntent
  ) {
    return null;
  }

  return effects.serviceControl ?? effects.gatewayHealth ?? effects.installLifecycle ?? effects.diagnostic ?? null;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function matchOwnedServiceOperation(prompt) {
  if (!prompt) return null;
  if (/(?:重启|restart)/i.test(prompt)) return "restart";
  if (/(?:启动|start)/i.test(prompt)) return "start";
  if (/(?:停止|stop)/i.test(prompt)) return "stop";
  if (/(?:重载|reload)/i.test(prompt)) return "reload";
  if (/(?:状态|status|健康|health|检查|查看)/i.test(prompt)) return "status";
  return null;
}

function findOwnedServiceTarget(prompt, units) {
  for (const unit of units) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_.@-])${escapeRegex(unit)}($|[^A-Za-z0-9_.@-])`, "i");
    if (pattern.test(prompt)) return unit;
  }
  return null;
}

function createBridgeServiceControlAssessment(prompt, bridgeServiceUnitNames) {
  const serviceTarget = findOwnedServiceTarget(prompt, bridgeServiceUnitNames);
  if (!serviceTarget) return null;
  const operation = matchOwnedServiceOperation(prompt);
  if (!operation || !isDedicatedOwnedServiceRequest(prompt, { operation, target: serviceTarget })) {
    return null;
  }
  return createBridgeControlDecision({
    kind: "service_control",
    operation,
    target: serviceTarget,
    requiresApproval: operation !== "status",
    reasonCodes: operation !== "status" ? ["service_control_requires_approval"] : [],
  });
}

function createBridgeGatewayHealthAssessment(prompt) {
  if (!BRIDGE_GATEWAY_HEALTH_PATTERN.test(prompt) || !isDedicatedGatewayHealthRequest(prompt)) {
    return null;
  }
  return createBridgeControlDecision({
    kind: "gateway_health",
    operation: "check",
    target: "gateway",
    requiresApproval: false,
    reasonCodes: [],
  });
}

function createBridgeInstallLifecycleAssessment(prompt) {
  if (!BRIDGE_INSTALL_SYSTEMD_PATTERN.test(prompt) || !isDedicatedInstallLifecycleRequest(prompt)) {
    return null;
  }
  return createBridgeControlDecision({
    kind: "install_lifecycle",
    operation: "install-systemd",
    target: "systemd",
    requiresApproval: true,
    reasonCodes: ["install_lifecycle_requires_approval"],
  });
}

function createBridgeDiagnosticAssessment(prompt) {
  if (!BRIDGE_DIAGNOSTIC_PATTERN.test(prompt) || !isDedicatedDiagnosticRequest(prompt)) {
    return null;
  }
  return createBridgeControlDecision({
    kind: "diagnostic",
    operation: "gateway-status",
    target: "bridge",
    requiresApproval: false,
    reasonCodes: [],
  });
}

function createBridgeControlDecision({ kind, operation, target, requiresApproval, reasonCodes }) {
  return {
    kind,
    operation,
    target,
    requiresApproval,
    reasonCodes,
  };
}

function isDedicatedOwnedServiceRequest(prompt, { operation, target }) {
  const residue = reduceBridgeActionPrompt(prompt, [
    new RegExp(escapeRegex(target), "ig"),
    serviceOperationPattern(operation),
    /\b(?:systemctl|service|rc-service|invoke-rc\.d|initctl|--user)\b/gi,
    /(?:服务|service|unit)/giu,
  ]);
  return residue === "";
}

function isDedicatedGatewayHealthRequest(prompt) {
  const residue = reduceBridgeActionPrompt(prompt, [
    /\b(?:gateway|runner|bridge)\b/gi,
    /(?:gateway|runner|bridge)/giu,
    /\bhealth\s+details\b/gi,
    /\b(?:health|status|check)\b/gi,
    /(?:健康详情)/giu,
    /(?:健康|状态|检查|查看|确认)/giu,
  ]);
  return residue === "";
}

function isDedicatedInstallLifecycleRequest(prompt) {
  const residue = reduceBridgeActionPrompt(prompt, [
    /\binstall-systemd\b/gi,
    /\b(?:install|systemd|service)\b/gi,
    /(?:安装|本仓库|的|systemd|服务)/giu,
  ]);
  return residue === "";
}

function isDedicatedDiagnosticRequest(prompt) {
  const residue = reduceBridgeActionPrompt(prompt, [
    /\b(?:gateway-status|runner-status)\b/gi,
    /\b(?:gateway|runner|bridge)\b/gi,
    /(?:gateway|runner|bridge|桥接)/giu,
    /\bdiagnostic\s+info\b/gi,
    /\b(?:status|diagnostic|diagnostics|details)\b/gi,
    /(?:状态详情|状态信息|状态|诊断信息|诊断|排障|详情)/giu,
  ]);
  return residue === "";
}

function reduceBridgeActionPrompt(prompt, replacements = []) {
  let rest = normalizeText(prompt);
  for (const pattern of replacements) {
    rest = rest.replace(pattern, " ");
  }
  rest = rest.replace(
    /(?:请帮我|帮我|请你|麻烦你|麻烦|请|帮忙|可以帮我|能不能帮我|能否帮我|劳驾|拜托|直接|现在|一下|一下子|看一下|看下|帮我看|帮我检查|帮我确认)/giu,
    " ",
  );
  rest = rest.replace(/\b(?:please|kindly|can\s+you|could\s+you|would\s+you|for\s+me|me|just|now)\b/gi, " ");
  rest = rest.replace(/\bwhat\s+is(?:\s+the)?\b/gi, " ");
  rest = rest.replace(/^\s*(?:show|view|check|info)\b/gi, " ");
  rest = rest.replace(/\b(?:the|of)\b/gi, " ");
  rest = rest.replace(/[，,。！？!?;；:：、()[\]{}<>"'`=\s]+/gu, " ");
  return rest.trim();
}

function serviceOperationPattern(operation) {
  switch (operation) {
    case "restart":
      return /(?:重启|restart)/giu;
    case "start":
      return /(?:启动|start)/giu;
    case "stop":
      return /(?:停止|stop)/giu;
    case "reload":
      return /(?:重载|reload)/giu;
    case "status":
      return /(?:状态|status|健康|health|检查|查看|确认)/giu;
    default:
      return /^$/u;
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const hostSecretRoots = getHostSecretRoots();
  const controlledRoots = cwd ? [cwd] : [];
  const referencedPaths = extractReferencedPaths(prompt, cwd);
  const action = classifyAction(prompt);
  const intent = createIntentAssessment({ action, prompt, referencedPaths });
  const boundaryReferencedPaths = selectBoundaryReferencedPaths({
    prompt,
    cwd,
    referencedPaths,
    discussionOnly: intent === "discussion",
    hostCodexRoot,
    hostSecretRoots,
  });
  const executionBoundaries = createExecutionBoundaryAssessment({
    action,
    controlledRoots,
    cwd,
    discussionOnly: intent === "discussion",
    hostCodexRoot,
    hostSecretRoots,
    lowerPrompt,
    protectedRoots,
    referencedPaths: boundaryReferencedPaths,
  });
  const effects = createEffectAssessment(prompt);
  const decision = createDecisionAssessment({ intent, executionBoundaries, effects });

  return {
    prompt,
    lowerPrompt,
    cwd,
    protectedRoots,
    hostCodexRoot,
    hostSecretRoots,
    controlledRoots,
    referencedPaths,
    action,
    intent,
    executionBoundaries,
    effects,
    decision,
  };
}

function createExecutionBoundaryAssessment({
  action,
  controlledRoots,
  cwd,
  discussionOnly,
  hostCodexRoot,
  hostSecretRoots,
  lowerPrompt,
  protectedRoots,
  referencedPaths,
}) {
  const insideControlledRoots =
    referencedPaths.length > 0 && referencedPaths.every((candidatePath) => isPathInsideAny(candidatePath, controlledRoots));
  return createBooleanFlagRecord(POLICY_EXECUTION_BOUNDARY_KEYS, {
    insideCwd: action === "write" && insideControlledRoots,
    outsideCwdWrite:
      action === "write" && referencedPaths.some((candidatePath) => !isPathInsideAny(candidatePath, controlledRoots)),
    hostCodex: hostCodexRoot
      ? isPathInsideAny(cwd, [hostCodexRoot]) ||
        referencesPathInsideAny(referencedPaths, [hostCodexRoot]) ||
        ((!discussionOnly && lowerPrompt.includes(hostCodexRoot.toLowerCase())) ||
          (!discussionOnly && lowerPrompt.includes("~/.codex")))
      : false,
    hostSecret:
      isPathInsideAny(cwd, hostSecretRoots) || referencesPathInsideAny(referencedPaths, hostSecretRoots),
    protectedRoot:
      isPathInsideAny(cwd, protectedRoots) || referencesPathInsideAny(referencedPaths, protectedRoots),
    isolationBoundary: touchesIsolationBoundary(lowerPrompt),
  });
}

function createIntentAssessment({ action, prompt, referencedPaths }) {
  if (action === "write") return "write";
  if (action === "read" && isDiscussionOnlyPrompt(prompt, referencedPaths)) return "discussion";
  if (action === "read") return "read";
  return "unknown";
}

function createEffectAssessment(prompt) {
  const schedulerControl = SCHEDULER_CONTROL_PATTERN.test(prompt);
  return createBooleanFlagRecord(POLICY_EFFECT_KEYS, {
    serviceControl: !schedulerControl && SERVICE_CONTROL_PATTERN.test(prompt),
    schedulerControl,
    processControl: PROCESS_CONTROL_PATTERN.test(prompt) || BACKGROUND_PROCESS_PATTERN.test(prompt),
    remoteBoundary: REMOTE_BOUNDARY_PATTERN.test(prompt),
    containerControl: CONTAINER_CONTROL_PATTERN.test(prompt),
    publicationBoundary: PUBLICATION_BOUNDARY_PATTERN.test(prompt),
    adminEscalation: ADMIN_ESCALATION_PATTERN.test(prompt),
    policyBypass: POLICY_BYPASS_PATTERN.test(prompt),
    globalEnvChange: GLOBAL_ENV_PATTERN.test(prompt),
    destructiveChange: DESTRUCTIVE_PATTERN.test(prompt),
  });
}

function createDecisionAssessment({ intent, executionBoundaries, effects }) {
  if (executionBoundaries.isolationBoundary || executionBoundaries.protectedRoot) {
    return deny("isolation_boundary_denied");
  }
  if (executionBoundaries.hostSecret) {
    return deny("host_secret_boundary_denied");
  }
  if (intent !== "discussion" && effects.adminEscalation) {
    return deny("out_of_scope_admin_denied");
  }
  if (intent !== "discussion" && effects.policyBypass) {
    return deny("policy_bypass_denied");
  }

  const reasonCodes = [];
  if (intent !== "discussion") {
    if (effects.schedulerControl) {
      reasonCodes.push("scheduler_control_requires_approval");
    }
    if (effects.serviceControl) {
      reasonCodes.push("service_control_requires_approval");
    }
    if (effects.processControl) {
      reasonCodes.push("process_control_requires_approval");
    }
    if (effects.remoteBoundary) {
      reasonCodes.push("remote_boundary_requires_approval");
    }
    if (effects.containerControl) {
      reasonCodes.push("container_control_requires_approval");
    }
    if (effects.publicationBoundary) {
      reasonCodes.push("publication_boundary_requires_approval");
    }
    if (effects.globalEnvChange) {
      reasonCodes.push("global_env_change_requires_approval");
    }
    if (effects.destructiveChange) {
      reasonCodes.push("destructive_change_requires_approval");
    }
  }
  if (executionBoundaries.hostCodex) {
    reasonCodes.push("host_codex_boundary_requires_approval");
  }
  if (executionBoundaries.outsideCwdWrite) {
    reasonCodes.push("outside_cwd_write_requires_approval");
  }

  if (reasonCodes.length > 0) {
    return approve(reasonCodes);
  }
  return allow();
}

function isDiscussionOnlyPrompt(prompt, referencedPaths) {
  if (!prompt) return false;
  if (DISCUSSION_HOW_PATTERN.test(prompt)) return true;
  if (DISCUSSION_TOPIC_PATTERN.test(prompt)) return true;
  if (DISCUSSION_SOURCE_DOC_PATTERN.test(prompt)) return true;
  return referencedPaths.length > 0 && /\bworks?\b|(?:如何|原理)/iu.test(prompt);
}

function selectBoundaryReferencedPaths({
  prompt,
  cwd,
  referencedPaths,
  discussionOnly,
  hostCodexRoot,
  hostSecretRoots,
}) {
  if (!discussionOnly || !cwd || referencedPaths.length === 0) return referencedPaths;
  const hasControlledDocSource = referencedPaths.some(
    (candidatePath) => isPathInsideAny(candidatePath, [cwd]) && /\.(md|mdx|txt|rst|adoc)$/i.test(candidatePath),
  );
  if (!hasControlledDocSource) return referencedPaths;

  return referencedPaths.filter((candidatePath) => {
    const touchesHostSecret = isPathInsideAny(candidatePath, hostSecretRoots);
    const touchesHostCodex = hostCodexRoot ? isPathInsideAny(candidatePath, [hostCodexRoot]) : false;
    if (!touchesHostSecret && !touchesHostCodex) return true;
    return !isDocSubjectPathMention(prompt, candidatePath);
  });
}

function isDocSubjectPathMention(prompt, candidatePath) {
  return getPromptPathVariants(candidatePath).some((variant) => {
    if (!variant) return false;
    const escaped = escapeRegex(variant);
    return (
      new RegExp(`(?:^|\\s)(?:about|on|regarding|for)\\s+${escaped}(?:\\b|$)`, "iu").test(prompt) ||
      new RegExp(`(?:note|notes|section|sections|explanation|explanations)\\s+(?:about|on|regarding|for)\\s+${escaped}(?:\\b|$)`, "iu").test(prompt) ||
      new RegExp(`\\S+\\.(?:md|mdx|txt|rst|adoc)\\s+(?:note|notes|section|sections|explanation|explanations)\\s+(?:about|on|regarding|for)\\s+${escaped}(?:\\b|$)`, "iu").test(prompt) ||
      new RegExp(`关于\\s*${escaped}(?:\\s*的)?`, "iu").test(prompt) ||
      new RegExp(`${escaped}\\s*(?:的说明|说明)`, "iu").test(prompt) ||
      new RegExp(`${escaped}\\s+(?:note|notes|section|sections|explanation|explanations)\\s+in\\s+\\S+\\.(?:md|mdx|txt|rst|adoc)`, "iu").test(prompt) ||
      new RegExp(`\\S+\\.(?:md|mdx|txt|rst|adoc)\\s*(?:里|中)\\s*怎么说\\s*${escaped}(?:\\b|$)`, "iu").test(prompt) ||
      new RegExp(`${escaped}\\s*在\\s*\\S+\\.(?:md|mdx|txt|rst|adoc)\\s*(?:里|中)(?:的)?(?:说明)?`, "iu").test(prompt)
    );
  });
}

function getPromptPathVariants(candidatePath) {
  const normalized = normalizeText(candidatePath).replace(/\\/g, "/");
  if (!normalized) return [];
  const variants = [normalized];
  const homeDir = os.homedir().replace(/\\/g, "/");
  if (normalized.startsWith(`${homeDir}/`)) {
    variants.push(`~/${normalized.slice(homeDir.length + 1)}`);
  }
  return uniqueStrings(variants);
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

function getHostSecretRoots() {
  const homeDir = os.homedir();
  return HOST_SECRET_RELATIVE_ROOTS.map((candidate) => path.resolve(homeDir, candidate));
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
  return normalizeDecisionResult({ kind: POLICY_DECISIONS.ALLOWED, reasonCodes: [] });
}

function approve(reasonCodes) {
  return normalizeDecisionResult({
    kind: POLICY_DECISIONS.APPROVAL_REQUIRED,
    reasonCodes,
  });
}

function deny(reasonCode) {
  return normalizeDecisionResult({
    kind: POLICY_DECISIONS.DENIED,
    reasonCodes: [reasonCode],
  });
}

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function createBooleanFlagRecord(keys, values) {
  return Object.fromEntries(keys.map((key) => [key, Boolean(values?.[key])]));
}

function normalizeDecisionResult(input) {
  const kind = Object.values(POLICY_DECISIONS).includes(input?.kind) ? input.kind : POLICY_DECISIONS.ALLOWED;
  const allowedReasonCodes =
    kind === POLICY_DECISIONS.DENIED ? POLICY_DENY_REASON_CODES : POLICY_APPROVAL_REASON_CODES;
  return {
    kind,
    reasonCodes: uniqueStrings(input?.reasonCodes ?? []).filter((code) => allowedReasonCodes.includes(code)),
  };
}
