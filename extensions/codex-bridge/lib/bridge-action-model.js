export const BRIDGE_ACTION_STATUSES = ["created", "awaiting_approval", "running", "finished"];
export const BRIDGE_ACTION_KINDS = ["service_control", "gateway_health", "install_lifecycle", "diagnostic"];
export const BRIDGE_ACTION_RESULT_STATUSES = ["completed", "failed", "denied"];
export const BRIDGE_ACTION_CONTRACT_KEYS = ["kind", "operation", "target", "executor"];
export const BRIDGE_ACTION_EXECUTORS = ["systemd_user", "isolated_openclaw", "bootstrap_script"];
export const BRIDGE_ACTION_TRACE_KEYS = ["execution", "recovery"];
export const BRIDGE_ACTION_EXECUTION_TRACE_KEYS = ["executor", "command", "args", "exitCode"];
export const BRIDGE_ACTION_RECOVERY_TRACE_KEYS = ["reason"];

export function isBridgeActionStatus(status) {
  return BRIDGE_ACTION_STATUSES.includes(status);
}

export function bridgeActionExecutorForKind(kind) {
  if (kind === "service_control") return "systemd_user";
  if (kind === "gateway_health") return "isolated_openclaw";
  if (kind === "install_lifecycle" || kind === "diagnostic") return "bootstrap_script";
  return null;
}

export function normalizeBridgeActionContract(input = {}) {
  const kind = input.kind ?? null;
  return {
    kind,
    operation: input.operation ?? null,
    target: input.target ?? null,
    executor: input.executor ?? bridgeActionExecutorForKind(kind),
  };
}

export function normalizeBridgeActionTrace(input) {
  return {
    execution: normalizeBridgeActionExecutionTrace(input?.execution),
    recovery: normalizeBridgeActionRecoveryTrace(input?.recovery),
  };
}

export function normalizeBridgeActionExecutionTrace(input) {
  if (!input || typeof input !== "object") return null;
  return {
    executor: input.executor ?? null,
    command: input.command ?? null,
    args: Array.isArray(input.args) ? [...input.args] : null,
    exitCode: typeof input.exitCode === "number" ? input.exitCode : null,
  };
}

export function normalizeBridgeActionRecoveryTrace(input) {
  if (!input || typeof input !== "object") return null;
  return {
    reason: input.reason ?? null,
  };
}

export function defaultBridgeActionOwner(status) {
  return status === "awaiting_approval" ? "bridge_approval" : "bridge_action";
}

export function normalizeBridgeActionOwner(owner, status) {
  if (status === "awaiting_approval") return "bridge_approval";
  if (owner === "bridge_action") return "bridge_action";
  return defaultBridgeActionOwner(status);
}

export function canBridgeActionAffectTaskContinuity() {
  return false;
}

export function finishBridgeActionWithApprovalRequired() {
  return {
    status: "awaiting_approval",
    owner: "bridge_approval",
    resultStatus: null,
  };
}

export function startBridgeActionExecution() {
  return {
    status: "running",
    owner: "bridge_action",
    resultStatus: null,
  };
}

export function finishBridgeActionDenied() {
  return {
    status: "finished",
    owner: "bridge_action",
    resultStatus: "denied",
  };
}

export function finishBridgeActionFromExecution(result = {}) {
  const { exitCode = null, error = null } = result;
  return {
    status: "finished",
    owner: "bridge_action",
    resultStatus: error || (typeof exitCode === "number" && exitCode !== 0) ? "failed" : "completed",
  };
}
