import test from "node:test";
import assert from "node:assert/strict";
import { getLocaleText } from "../lib/locale.js";
import {
  finishApprovalTransition,
  routeContinueCommand,
  routeIncomingPlainText,
  routePlainTextWithActiveTask,
  startNextRunFromApproval,
} from "../lib/task-model.js";

test("plain text starts a new task when there is no active task", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: null }), {
    action: "create_task",
  });
});

test("plain text auto-continues only when task is awaiting_input", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "awaiting_input" }), {
    action: "continue_task",
  });
  assert.deepEqual(
    routeIncomingPlainText({ activeTaskStatus: "awaiting_input", requiresExplicitContinue: true }),
    {
      action: "reject",
      code: "task_interrupted_requires_continue",
      suggestedCommand: "/codex continue <prompt>",
    },
  );
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "running" }), {
    action: "reject",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });
});

test("continue is rejected when no active task exists", () => {
  const result = routeContinueCommand({ activeTaskStatus: null });
  assert.deepEqual(result, {
    accepted: false,
    code: "no_active_task",
  });
});

test("continue requires the task to be waiting for input", () => {
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: true,
    action: "create_next_run",
  });
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "running" }), {
    accepted: false,
    code: "task_not_waiting_input",
    suggestedCommand: "/codex status",
  });
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "awaiting_approval" }), {
    accepted: false,
    code: "task_not_waiting_input",
    suggestedCommand: "/codex approve <token>",
  });
});

test("plain text with an active task does not implicitly continue", () => {
  const result = routePlainTextWithActiveTask({ activeTaskStatus: "running" });
  assert.deepEqual(result, {
    accepted: false,
    code: "active_task_exists",
    suggestedCommand: "/codex continue <prompt>",
  });
});

test("continue guidance text targets the current active task", () => {
  const en = getLocaleText("en-US");
  const zh = getLocaleText("zh-CN");

  assert.match(en.help("/tmp"), /`\/codex continue <prompt>` add explicit input to the current active task/);
  assert.match(zh.help("/tmp"), /`\/codex continue <prompt>` 向当前活动任务补充明确输入/);
  assert.equal(en.noActiveTaskToContinue, "No active task to continue.");
  assert.equal(zh.noActiveTaskToContinue, "当前没有可继续的活动任务。");
});

test("approval-required decision transitions task to awaiting_approval", () => {
  const next = finishApprovalTransition({ currentStatus: "running", decision: "approval_required" });
  assert.equal(next.status, "awaiting_approval");
});

test("approval starts the next run instead of resuming the blocked run", () => {
  assert.deepEqual(startNextRunFromApproval(), {
    taskStatus: "running",
    action: "create_next_run",
  });
});
