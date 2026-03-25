import test from "node:test";
import assert from "node:assert/strict";
import * as taskModel from "../lib/task-model.js";
import {
  ACTIVE_TASK_STATUSES,
  RUN_STATUSES,
  TERMINAL_TASK_STATUSES,
  canContinueTask,
  finishRunWithApprovalRequired,
  finishRunWithDeniedAction,
  finishRunWithResult,
  finishRunFromExecution,
  isActiveTaskStatus,
  isTerminalTaskStatus,
} from "../lib/task-model.js";
import { getLocaleText, getUserVisibleStatusHint, localizeTaskStatus } from "../lib/locale.js";
import { createDeniedTaskPersistenceRecords } from "../lib/task-store.js";

test("protocol/status/schema: task statuses and run statuses match the revised protocol", () => {
  assert.deepEqual(ACTIVE_TASK_STATUSES, ["created", "running", "awaiting_input", "awaiting_approval"]);
  assert.deepEqual(TERMINAL_TASK_STATUSES, ["completed", "aborted"]);
  assert.deepEqual(RUN_STATUSES, ["running", "completed", "failed", "aborted", "blocked"]);
  assert.equal(isActiveTaskStatus("awaiting_input"), true);
  assert.equal(isActiveTaskStatus("awaiting_approval"), true);
  assert.equal(isTerminalTaskStatus("completed"), true);
  assert.equal(isTerminalTaskStatus("aborted"), true);
  assert.equal(canContinueTask("completed"), false);
  assert.equal(canContinueTask("awaiting_input"), true);
  assert.equal(canContinueTask("running"), false);
  assert.equal(canContinueTask("awaiting_approval"), false);
});

test("protocol/approval/classification: contract-based replies classify approve, deny, tail, and keep-gate-open", () => {
  const replyContract = {
    kind: "natural_language_approval",
    allowNumericChoice: false,
  };

  assert.deepEqual(taskModel.classifyApprovalReply?.({ text: "同意", replyContract }), {
    outcome: "approve",
    tail: null,
  });
  assert.deepEqual(taskModel.classifyApprovalReply?.({ text: "同意，并把结果总结成三句话", replyContract }), {
    outcome: "approve_with_tail",
    tail: "并把结果总结成三句话",
  });
  assert.deepEqual(taskModel.classifyApprovalReply?.({ text: "不要执行", replyContract }), {
    outcome: "deny",
    tail: null,
  });
  assert.deepEqual(taskModel.classifyApprovalReply?.({ text: "1", replyContract }), {
    outcome: "keep_gate_open",
    tail: null,
  });
});

test("protocol/status/locale: localized task status labels only cover protocol task statuses", () => {
  assert.equal(localizeTaskStatus("zh-CN", "completed"), "已完成");
  assert.equal(localizeTaskStatus("zh-CN", "failed"), "failed");
  assert.equal(localizeTaskStatus("zh-CN", "denied"), "denied");
  assert.equal(localizeTaskStatus("zh-CN", "aborting"), "aborting");
});

test("protocol/transition/approval: approval-required transition blocks the run and moves the task to awaiting_approval", () => {
  assert.deepEqual(finishRunWithApprovalRequired(), {
    taskStatus: "awaiting_approval",
    runStatus: "blocked",
  });
});

test("protocol/transition/deny: denied actions block the run and return the task to awaiting_input", () => {
  assert.deepEqual(finishRunWithDeniedAction(), {
    taskStatus: "awaiting_input",
    runStatus: "blocked",
  });
});

test("protocol/persistence/deny: denied persistence stores awaiting_input for the task and blocked for the run", () => {
  const timestamp = "2026-03-24T00:00:00.000Z";
  const { task, run } = createDeniedTaskPersistenceRecords({
    taskId: "task_123",
    runId: "run_123",
    locale: "en",
    senderId: "sender_123",
    accountId: "account_123",
    conversationId: "conversation_123",
    messageId: "message_123",
    cwd: "/repo",
    mode: "new",
    sessionId: null,
    prompt: "delete protected file",
    policyDecision: "denied",
    reasonCodes: ["protected_root"],
    timestamp,
  });

  assert.equal(task.status, "awaiting_input");
  assert.equal(run.status, "blocked");
  assert.equal(task.currentRunId, null);
  assert.equal(task.lastRunId, "run_123");
  assert.equal(task.finishedAt, null);
  assert.equal(run.finishedAt, timestamp);
});

test("protocol/transition/result: completed and failed runs default the task back to awaiting_input", () => {
  assert.deepEqual(finishRunWithResult("completed"), {
    taskStatus: "awaiting_input",
    runStatus: "completed",
  });
  assert.deepEqual(finishRunWithResult("failed"), {
    taskStatus: "awaiting_input",
    runStatus: "failed",
  });
});

test("protocol/transition/abort: aborted runs mark both task and run as aborted", () => {
  assert.deepEqual(finishRunWithResult("aborted"), {
    taskStatus: "aborted",
    runStatus: "aborted",
  });
});

test("protocol/execution/result: execution results keep successful and failed runs on awaiting_input", () => {
  assert.deepEqual(finishRunFromExecution({}), {
    taskStatus: "awaiting_input",
    runStatus: "completed",
  });
  assert.deepEqual(finishRunFromExecution({ exitCode: 9 }), {
    taskStatus: "awaiting_input",
    runStatus: "failed",
  });
  assert.deepEqual(finishRunFromExecution({ error: "boom" }), {
    taskStatus: "awaiting_input",
    runStatus: "failed",
  });
});

test("protocol/execution/abort: execution results mark aborted runs without persisting an aborting task state", () => {
  assert.deepEqual(finishRunFromExecution({ stopping: true }), {
    taskStatus: "aborted",
    runStatus: "aborted",
  });
  assert.deepEqual(finishRunFromExecution({ signal: "SIGTERM" }), {
    taskStatus: "aborted",
    runStatus: "aborted",
  });
  assert.deepEqual(finishRunFromExecution({ signal: "SIGKILL" }), {
    taskStatus: "aborted",
    runStatus: "aborted",
  });
});

test("protocol/locale/finish: finish messages describe run completion when the task returns to awaiting_input", () => {
  const text = getLocaleText("en-US");

  assert.match(
    text.taskFinished({
      taskId: "task_success",
      cwd: "/repo",
      status: "awaiting_input",
      runStatus: "completed",
      sessionId: null,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: null,
      exitCode: 0,
      signal: null,
    }),
    /Codex run completed: task_success/,
  );
  assert.match(
    text.taskFinished({
      taskId: "task_failed",
      cwd: "/repo",
      status: "awaiting_input",
      runStatus: "failed",
      sessionId: null,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: "boom",
      exitCode: 1,
      signal: null,
    }),
    /Codex run failed: task_failed/,
  );
  assert.match(
    text.taskFinished({
      taskId: "task_aborted",
      cwd: "/repo",
      status: "aborted",
      runStatus: "aborted",
      sessionId: null,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: "aborted by user",
      exitCode: null,
      signal: "SIGTERM",
    }),
    /Codex task aborted: task_aborted/,
  );
  assert.match(
    text.taskFinished({
      taskId: "task_failed_with_legacy_status",
      cwd: "/repo",
      status: "denied",
      runStatus: "failed",
      sessionId: null,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: "blocked by policy",
      exitCode: 1,
      signal: null,
    }),
    /Codex task failed: task_failed_with_legacy_status/,
  );
});

test("protocol/status/continue: canContinueTask returns false for every terminal status", () => {
  for (const status of TERMINAL_TASK_STATUSES) {
    assert.equal(canContinueTask(status), false);
  }
});

test("protocol/status/continue: canContinueTask returns false for invalid status inputs", () => {
  const invalidStatuses = ["", "queued", "aborting", null, undefined, 0, {}, []];
  for (const status of invalidStatuses) {
    assert.equal(canContinueTask(status), false);
  }
});

test("protocol/locale/recovery: interruption hint is localized for recovery guidance", () => {
  const zh = getLocaleText("zh-CN");
  const en = getLocaleText("en-US");

  assert.match(getUserVisibleStatusHint("zh-CN", "run.interrupted"), /直接说明要继续做什么/);
  assert.match(getUserVisibleStatusHint("en-US", "run.interrupted"), /Say what to continue with/i);
  assert.match(getUserVisibleStatusHint("zh-CN", "run.interrupted.bridge_self_restart"), /桥接服务.*重启|重启.*桥接服务/);
  assert.match(getUserVisibleStatusHint("en-US", "run.interrupted.bridge_self_restart"), /bridge.*restart|restart.*bridge/i);
  assert.equal(getUserVisibleStatusHint("zh-CN", "item.completed"), "");
  assert.equal(getUserVisibleStatusHint("en-US", "turn.started"), "");
  assert.match(zh.taskProgress("task_123", "run.interrupted"), /上一轮执行中断/);
  assert.match(en.taskProgress("task_123", "run.interrupted"), /Previous run was interrupted/i);
});
