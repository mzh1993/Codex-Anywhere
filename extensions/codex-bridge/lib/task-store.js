import {
  finishApprovalTransition,
  finishRunFromExecution,
  finishRunWithDeniedAction,
  isTerminalTaskStatus,
  normalizeTaskOwner,
} from "./task-model.js";

export function createTaskRecord(input) {
  return {
    taskId: input.taskId,
    locale: input.locale,
    senderId: input.senderId,
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    cwd: input.cwd,
    mode: input.mode,
    sessionId: input.sessionId ?? null,
    status: input.status ?? "created",
    owner: normalizeTaskOwner(input.owner ?? null, input.status ?? "created"),
    currentRunId: input.currentRunId ?? null,
    lastRunId: input.lastRunId ?? null,
    riskLevel: input.riskLevel ?? "normal",
    executionOptions: input.executionOptions ?? null,
    approvalToken: input.approvalToken ?? null,
    prompt: input.prompt,
    policyDecision: input.policyDecision ?? null,
    reasonCodes: input.reasonCodes ?? [],
    createdAt: input.createdAt,
    startedAt: input.startedAt ?? null,
    updatedAt: input.updatedAt ?? input.createdAt,
    finishedAt: input.finishedAt ?? null,
    lastStatusHint: input.lastStatusHint ?? null,
    lastStatusSentAtMs: input.lastStatusSentAtMs ?? 0,
    lastHeartbeatAtMs: input.lastHeartbeatAtMs ?? 0,
    progressMessageId: input.progressMessageId ?? null,
    lastHeartbeatBucket: input.lastHeartbeatBucket ?? null,
    lastHeartbeatVisibleHint: input.lastHeartbeatVisibleHint ?? null,
    requiresExplicitContinue: input.requiresExplicitContinue ?? false,
    summary: input.summary ?? null,
    changedFiles: input.changedFiles ?? [],
    nextSteps: input.nextSteps ?? [],
    error: input.error ?? null,
  };
}

export function createRunRecord(input) {
  return {
    runId: input.runId,
    taskId: input.taskId,
    locale: input.locale,
    senderId: input.senderId,
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    cwd: input.cwd,
    mode: input.mode,
    sessionId: input.sessionId ?? null,
    status: input.status ?? "running",
    riskLevel: input.riskLevel ?? "normal",
    executionOptions: input.executionOptions ?? null,
    approvalToken: input.approvalToken ?? null,
    prompt: input.prompt,
    policyDecision: input.policyDecision ?? null,
    reasonCodes: input.reasonCodes ?? [],
    createdAt: input.createdAt,
    startedAt: input.startedAt ?? input.createdAt ?? null,
    updatedAt: input.updatedAt ?? input.createdAt,
    finishedAt: input.finishedAt ?? null,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    pid: input.pid ?? null,
    lastStatusHint: input.lastStatusHint ?? null,
    lastStatusSentAtMs: input.lastStatusSentAtMs ?? 0,
    lastHeartbeatAtMs: input.lastHeartbeatAtMs ?? 0,
    beforeSessions: input.beforeSessions ?? 0,
    stdoutLogPath: input.stdoutLogPath ?? null,
    stderrLogPath: input.stderrLogPath ?? null,
    lastMessagePath: input.lastMessagePath ?? null,
    runDir: input.runDir ?? null,
    summary: input.summary ?? null,
    changedFiles: input.changedFiles ?? [],
    nextSteps: input.nextSteps ?? [],
    error: input.error ?? null,
  };
}

export function createAwaitingApprovalTaskRecord(input) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const transition = finishApprovalTransition({
    currentStatus: input.currentStatus ?? "running",
    decision: input.policyDecision ?? "approval_required",
  });
  return createTaskRecord({
    ...input,
    status: transition.status,
    owner: "bridge_approval",
    currentRunId: null,
    riskLevel: input.riskLevel ?? "high",
    policyDecision: input.policyDecision ?? "approval_required",
    createdAt: input.createdAt ?? timestamp,
    startedAt: input.startedAt ?? timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  });
}

export function createDeniedTaskPersistenceRecords(input) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const denied = finishRunWithDeniedAction();
  const shared = {
    locale: input.locale,
    senderId: input.senderId,
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    cwd: input.cwd,
    mode: input.mode,
    sessionId: input.sessionId ?? null,
    approvalToken: null,
    prompt: input.prompt,
    policyDecision: input.policyDecision,
    reasonCodes: input.reasonCodes ?? [],
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: timestamp,
    exitCode: null,
    signal: null,
    pid: null,
    lastStatusHint: null,
    lastStatusSentAtMs: 0,
    lastHeartbeatAtMs: 0,
    beforeSessions: 0,
    stdoutLogPath: null,
    stderrLogPath: null,
    lastMessagePath: null,
    runDir: null,
    summary: null,
    changedFiles: [],
    nextSteps: [],
    error: null,
  };
  return {
    task: createTaskRecord({
      ...shared,
      taskId: input.taskId,
      status: denied.taskStatus,
      currentRunId: null,
      lastRunId: input.runId,
      riskLevel: "normal",
      finishedAt: null,
    }),
    run: createRunRecord({
      ...shared,
      runId: input.runId,
      taskId: input.taskId,
      status: denied.runStatus,
      riskLevel: "normal",
    }),
  };
}

export function serializeTaskForStorage(task) {
  const serialized = { ...task };
  if ("beforeSessions" in serialized) {
    serialized.beforeSessions =
      serialized.beforeSessions instanceof Set ? serialized.beforeSessions.size : serialized.beforeSessions;
  }
  return serialized;
}

export function serializeRunForStorage(run) {
  const serialized = { ...run };
  if ("beforeSessions" in serialized) {
    serialized.beforeSessions =
      serialized.beforeSessions instanceof Set ? serialized.beforeSessions.size : serialized.beforeSessions;
  }
  return serialized;
}

export function applyRunResultToPersistence({
  task,
  run,
  result = {},
  summary = null,
  changedFiles = [],
  nextSteps = [],
  timestamp,
  sessionId = null,
  preserveTaskContinuity = false,
  interruptionHint = null,
}) {
  const finishedAt = timestamp ?? new Date().toISOString();
  const transition = finishRunFromExecution(result);
  const nextRun = createRunRecord({
    ...run,
    status: transition.runStatus,
    sessionId: sessionId ?? run.sessionId ?? task.sessionId ?? null,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    error: result.error ?? run.error ?? null,
    summary: summary || null,
    changedFiles,
    nextSteps,
    finishedAt,
    updatedAt: finishedAt,
  });
  if (preserveTaskContinuity && transition.runStatus === "aborted") {
    const recovered = recoverStaleRunningTask({
      task,
      run: nextRun,
      timestamp: finishedAt,
      interruptionHint,
    });
    return {
      task: recovered.task,
      run: recovered.run,
      transition: {
        taskStatus: recovered.task.status,
        runStatus: recovered.run?.status ?? nextRun.status,
      },
    };
  }
  const nextTask = createTaskRecord({
    ...task,
    status: transition.taskStatus,
    currentRunId: null,
    lastRunId: run.runId,
    sessionId: nextRun.sessionId,
    requiresExplicitContinue: false,
    summary: summary || null,
    changedFiles,
    nextSteps,
    error: result.error ?? task.error ?? null,
    finishedAt: isTerminalTaskStatus(transition.taskStatus) ? finishedAt : null,
    updatedAt: finishedAt,
  });
  return {
    task: nextTask,
    run: nextRun,
    transition,
  };
}

export function recoverStaleRunningTask({ task, run = null, timestamp, interruptionHint = null }) {
  const recoveredAt = timestamp ?? new Date().toISOString();
  const nextRun = run
    ? createRunRecord({
        ...run,
        status: "failed",
        error: run.error ?? "previous run interrupted after bridge restart",
        finishedAt: recoveredAt,
        updatedAt: recoveredAt,
      })
    : null;
  const nextTask = createTaskRecord({
    ...task,
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: run?.runId ?? task.currentRunId ?? task.lastRunId ?? null,
    requiresExplicitContinue: true,
    lastStatusHint: interruptionHint ?? "run.interrupted",
    finishedAt: null,
    updatedAt: recoveredAt,
    error: null,
  });
  return {
    task: nextTask,
    run: nextRun,
  };
}

export function createTaskPersistence({ tasksRoot, runsRoot, readJson, writeJson, safeFileName }) {
  function taskPath(taskId) {
    return `${tasksRoot}/${safeFileName(taskId)}.json`;
  }

  function runPath(runId) {
    return `${runsRoot}/${safeFileName(runId)}.json`;
  }

  return {
    tasks: {
      async create(task) {
        await writeJson(taskPath(task.taskId), serializeTaskForStorage(task));
        return task;
      },
      async read(taskId) {
        return readJson(taskPath(taskId), null);
      },
      async update(taskId, updates) {
        const current = await this.read(taskId);
        if (!current) return null;
        const next = { ...current, ...updates };
        await writeJson(taskPath(taskId), serializeTaskForStorage(next));
        return next;
      },
      async write(task) {
        await writeJson(taskPath(task.taskId), serializeTaskForStorage(task));
        return task;
      },
    },
    runs: {
      async create(run) {
        await writeJson(runPath(run.runId), serializeRunForStorage(run));
        return run;
      },
      async read(runId) {
        return readJson(runPath(runId), null);
      },
      async update(runId, updates) {
        const current = await this.read(runId);
        if (!current) return null;
        const next = { ...current, ...updates };
        await writeJson(runPath(runId), serializeRunForStorage(next));
        return next;
      },
      async write(run) {
        await writeJson(runPath(run.runId), serializeRunForStorage(run));
        return run;
      },
    },
  };
}
