export const ACTIVE_TASK_STATUSES = ["created", "running", "awaiting_input", "awaiting_approval"];
export const TERMINAL_TASK_STATUSES = ["completed", "aborted"];
export const RUN_STATUSES = ["running", "completed", "failed", "aborted", "blocked"];

export function isActiveTaskStatus(status) {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function canContinueTask(status) {
  return status === "awaiting_input";
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

export function routeContinueCommand({ activeTaskStatus }) {
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
      suggestedCommand: activeTaskStatus === "awaiting_approval" ? "/codex approve <token>" : "/codex status",
    };
  }
  return {
    accepted: true,
    action: "create_next_run",
  };
}

export function routeApproveCommand({ activeTaskStatus }) {
  if (!activeTaskStatus) {
    return {
      accepted: false,
      code: "no_pending_approval",
    };
  }
  if (activeTaskStatus !== "awaiting_approval") {
    return {
      accepted: false,
      code: "task_not_waiting_approval",
      suggestedCommand: activeTaskStatus === "awaiting_input" ? "/codex continue <prompt>" : "/codex status",
    };
  }
  return {
    accepted: true,
    action: "approve_pending_request",
  };
}

export function routeIncomingPlainText({ activeTaskStatus, requiresExplicitContinue = false }) {
  if (!activeTaskStatus) {
    return {
      action: "create_task",
    };
  }
  if (activeTaskStatus === "awaiting_input" && requiresExplicitContinue) {
    return {
      action: "reject",
      code: "task_interrupted_requires_continue",
      suggestedCommand: "/codex continue <prompt>",
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
    suggestedCommand:
      activeTaskStatus === "awaiting_approval"
        ? "/codex approve <token>"
        : activeTaskStatus === "awaiting_input"
          ? "/codex continue <prompt>"
          : "/codex status",
  };
}

export function routePlainTextWithActiveTask() {
  return {
    accepted: false,
    code: "active_task_exists",
    suggestedCommand: "/codex continue <prompt>",
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
