export const ACTIVE_TASK_STATUSES = ["created", "running", "awaiting_input", "awaiting_approval"];
export const TERMINAL_TASK_STATUSES = ["completed", "aborted"];
export const RUN_STATUSES = ["running", "completed", "failed", "aborted", "blocked"];
export const TASK_OWNERS = ["codex", "bridge_approval"];

const APPROVE_PREFIXES = ["同意", "继续执行", "批准执行", "批准", "approve", "approved", "yes", "ok", "okay"];
const DENY_PREFIXES = ["不要执行", "拒绝执行", "拒绝", "不同意", "deny", "denied", "no", "stop"];
const APPROVAL_TAIL_SEPARATOR = /^[，,\s:：;；.\-—]+/u;

export function isActiveTaskStatus(status) {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function canContinueTask(status) {
  return status === "awaiting_input";
}

export function defaultTaskOwner(status) {
  return status === "awaiting_approval" ? "bridge_approval" : "codex";
}

export function normalizeTaskOwner(owner, status) {
  if (status === "awaiting_approval") return "bridge_approval";
  if (owner === "bridge_approval") return "codex";
  if (owner === "codex") return "codex";
  return defaultTaskOwner(status);
}

export function createApprovalReplyContract(overrides = {}) {
  return {
    kind: "natural_language_approval",
    allowNumericChoice: false,
    ...overrides,
  };
}

function matchApprovalPrefix(text, prefixes) {
  for (const prefix of prefixes) {
    if (text === prefix) return { matched: true, tail: null };
    if (text.startsWith(prefix)) {
      const tail = text.slice(prefix.length).replace(APPROVAL_TAIL_SEPARATOR, "").trim();
      if (tail) return { matched: true, tail };
    }
  }
  return { matched: false, tail: null };
}

export function classifyApprovalReply({ text, replyContract = null }) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) return { outcome: "keep_gate_open", tail: null };

  const contract = createApprovalReplyContract(replyContract ?? {});
  if (contract.allowNumericChoice && /^(1|１)$/.test(normalizedText)) {
    return { outcome: "approve", tail: null };
  }

  const approveMatch = matchApprovalPrefix(normalizedText, APPROVE_PREFIXES);
  if (approveMatch.matched) {
    return approveMatch.tail
      ? { outcome: "approve_with_tail", tail: approveMatch.tail }
      : { outcome: "approve", tail: null };
  }

  const denyMatch = matchApprovalPrefix(normalizedText, DENY_PREFIXES);
  if (denyMatch.matched) {
    return { outcome: "deny", tail: null };
  }

  return { outcome: "keep_gate_open", tail: null };
}

export function finishRunWithApprovalRequired() {
  return {
    taskStatus: "awaiting_approval",
    runStatus: "blocked",
  };
}

export function finishRunWithDeniedAction() {
  return {
    taskStatus: "awaiting_input",
    runStatus: "blocked",
  };
}

export function finishRunWithResult(runStatus) {
  if (runStatus === "aborted") {
    return {
      taskStatus: "aborted",
      runStatus,
    };
  }
  return {
    taskStatus: "awaiting_input",
    runStatus,
  };
}

export function finishRunFromExecution(result = {}) {
  const { stopping = false, signal = null, exitCode = null, error = null } = result;
  if (stopping || signal === "SIGTERM" || signal === "SIGKILL") {
    return finishRunWithResult("aborted");
  }
  if (error || (typeof exitCode === "number" && exitCode !== 0)) {
    return finishRunWithResult("failed");
  }
  return finishRunWithResult("completed");
}

export function routeResumeCommand({ activeTaskStatus }) {
  if (!activeTaskStatus) {
    return {
      accepted: false,
      code: "no_active_task",
    };
  }
  if (!canContinueTask(activeTaskStatus)) {
    return {
      accepted: false,
      code: "task_not_waiting_input",
    };
  }
  return {
    accepted: true,
    action: "create_next_run",
  };
}

export function routeIncomingPlainText({ activeTaskStatus, activeTaskOwner = null, requiresExplicitContinue = false }) {
  if (!activeTaskStatus) {
    return {
      action: "create_task",
    };
  }
  const owner = normalizeTaskOwner(activeTaskOwner, activeTaskStatus);
  if (owner === "bridge_approval" && activeTaskStatus === "awaiting_approval") {
    return {
      action: "handle_approval_reply",
    };
  }
  if (canContinueTask(activeTaskStatus)) {
    return {
      action: "continue_task",
    };
  }
  return {
    action: "reject",
    code: "active_task_exists",
    ...(activeTaskStatus === "awaiting_input" ? { suggestedCommand: "/codex resume <prompt>" } : {}),
  };
}

export function routePlainTextWithActiveTask() {
  return {
    accepted: false,
    code: "active_task_exists",
  };
}

export function startNextRunFromApproval() {
  return {
    taskStatus: "running",
    action: "create_next_run",
  };
}

export function finishApprovalTransition({ currentStatus, decision }) {
  if (currentStatus === "running" && decision === "approval_required") {
    const next = finishRunWithApprovalRequired();
    return { status: next.taskStatus };
  }
  return { status: currentStatus };
}
