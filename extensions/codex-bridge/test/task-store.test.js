import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRunResultToPersistence,
  createAwaitingApprovalTaskRecord,
  createRunRecord,
  createTaskRecord,
  recoverStaleRunningTask,
} from "../lib/task-store.js";

function buildTask(overrides = {}) {
  return createTaskRecord({
    taskId: "task_123",
    locale: "en-US",
    senderId: "sender_123",
    accountId: "account_123",
    conversationId: "conversation_123",
    messageId: "message_123",
    cwd: "/repo",
    mode: "resume",
    sessionId: "session_123",
    status: "running",
    currentRunId: "run_123",
    lastRunId: "run_123",
    riskLevel: "normal",
    approvalToken: null,
    prompt: "continue the task",
    policyDecision: "allowed",
    reasonCodes: [],
    createdAt: "2026-03-24T00:00:00.000Z",
    startedAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    summary: null,
    changedFiles: [],
    nextSteps: [],
    error: null,
    ...overrides,
  });
}

function buildRun(overrides = {}) {
  return createRunRecord({
    runId: "run_123",
    taskId: "task_123",
    locale: "en-US",
    senderId: "sender_123",
    accountId: "account_123",
    conversationId: "conversation_123",
    messageId: "message_123",
    cwd: "/repo",
    mode: "resume",
    sessionId: "session_123",
    status: "running",
    riskLevel: "normal",
    approvalToken: null,
    prompt: "continue the task",
    policyDecision: "allowed",
    reasonCodes: [],
    createdAt: "2026-03-24T00:00:00.000Z",
    startedAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    beforeSessions: new Set(),
    stdoutLogPath: "/tmp/stdout.jsonl",
    stderrLogPath: "/tmp/stderr.log",
    lastMessagePath: "/tmp/last-message.txt",
    runDir: "/tmp/run_123",
    summary: null,
    changedFiles: [],
    nextSteps: [],
    error: null,
    ...overrides,
  });
}

test("protocol/persistence/task: task records exclude run-scoped execution fields", () => {
  const task = createTaskRecord({
    taskId: "task_123",
    locale: "en-US",
    senderId: "sender_123",
    accountId: "account_123",
    conversationId: "conversation_123",
    messageId: "message_123",
    cwd: "/repo",
    mode: "new",
    prompt: "start task",
    createdAt: "2026-03-24T00:00:00.000Z",
    beforeSessions: new Set(["before"]),
    stdoutLogPath: "/tmp/stdout.jsonl",
    stderrLogPath: "/tmp/stderr.log",
    lastMessagePath: "/tmp/last-message.txt",
    runDir: "/tmp/run_123",
    pid: 123,
    exitCode: 9,
    signal: "SIGTERM",
  });

  assert.equal("beforeSessions" in task, false);
  assert.equal("stdoutLogPath" in task, false);
  assert.equal("stderrLogPath" in task, false);
  assert.equal("lastMessagePath" in task, false);
  assert.equal("runDir" in task, false);
  assert.equal("pid" in task, false);
  assert.equal("exitCode" in task, false);
  assert.equal("signal" in task, false);
});

test("protocol/persistence/task: completed runs keep the task active and unfinished", () => {
  const timestamp = "2026-03-24T00:10:00.000Z";
  const { task, run } = applyRunResultToPersistence({
    task: buildTask(),
    run: buildRun(),
    result: { exitCode: 0, signal: null, error: null, stopping: false },
    summary: "done",
    changedFiles: ["src/index.js"],
    nextSteps: ["review output"],
    timestamp,
  });

  assert.equal(task.status, "awaiting_input");
  assert.equal(task.currentRunId, null);
  assert.equal(task.lastRunId, "run_123");
  assert.equal(task.finishedAt, null);
  assert.equal(task.summary, "done");
  assert.deepEqual(task.changedFiles, ["src/index.js"]);
  assert.deepEqual(task.nextSteps, ["review output"]);
  assert.equal(run.status, "completed");
  assert.equal(run.finishedAt, timestamp);
});

test("protocol/persistence/task: aborted runs still terminalize the task", () => {
  const timestamp = "2026-03-24T00:10:00.000Z";
  const { task, run } = applyRunResultToPersistence({
    task: buildTask(),
    run: buildRun(),
    result: { exitCode: null, signal: "SIGTERM", error: "aborted by user", stopping: true },
    summary: null,
    changedFiles: [],
    nextSteps: [],
    timestamp,
  });

  assert.equal(task.status, "aborted");
  assert.equal(task.finishedAt, timestamp);
  assert.equal(run.status, "aborted");
  assert.equal(run.finishedAt, timestamp);
});

test("protocol/persistence/approval: approval-blocked tasks keep only lastRunId and no currentRunId", () => {
  const task = createAwaitingApprovalTaskRecord({
    taskId: "task_approval",
    locale: "en-US",
    senderId: "sender_123",
    accountId: "account_123",
    conversationId: "conversation_123",
    messageId: "message_123",
    cwd: "/repo",
    mode: "new",
    prompt: "restart service",
    currentRunId: "run_approval",
    lastRunId: "run_approval",
    createdAt: "2026-03-24T00:00:00.000Z",
    timestamp: "2026-03-24T00:00:00.000Z",
  });

  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.currentRunId, null);
  assert.equal(task.lastRunId, "run_approval");
});

test("protocol/recovery/stale_task: stale running tasks recover to awaiting_input and require explicit continue", () => {
  const timestamp = "2026-03-24T00:15:00.000Z";
  const { task, run } = recoverStaleRunningTask({
    task: buildTask({
      status: "running",
      currentRunId: "run_123",
      lastRunId: "run_prev",
      lastStatusHint: "turn.started",
    }),
    run: buildRun({
      status: "running",
      finishedAt: null,
      error: null,
    }),
    timestamp,
  });

  assert.equal(task.status, "awaiting_input");
  assert.equal(task.currentRunId, null);
  assert.equal(task.lastRunId, "run_123");
  assert.equal(task.finishedAt, null);
  assert.equal(task.requiresExplicitContinue, true);
  assert.equal(task.lastStatusHint, "run.interrupted");
  assert.equal(run.status, "failed");
  assert.equal(run.finishedAt, timestamp);
  assert.match(run.error, /interrupted/i);
});
