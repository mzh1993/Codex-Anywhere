export const BRIDGE_ACTION_STATUSES = ["created", "awaiting_approval", "running", "finished"];
export const BRIDGE_ACTION_KINDS = ["service_control", "gateway_health", "install_lifecycle", "diagnostic"];
export const BRIDGE_ACTION_RESULT_STATUSES = ["completed", "failed", "denied"];

export function isBridgeActionStatus(status) {
  return BRIDGE_ACTION_STATUSES.includes(status);
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
