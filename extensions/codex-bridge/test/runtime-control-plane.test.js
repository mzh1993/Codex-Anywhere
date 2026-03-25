import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBridgeActionRecord } from "../lib/bridge-action-store.js";
import { createTaskRecord } from "../lib/task-store.js";

function createFakeApi(stateDir) {
  return {
    pluginConfig: {
      locale: "zh-CN",
      heartbeatMs: 1000,
      statusThrottleMs: 0,
      codexHome: path.join(stateDir, "codex-home"),
    },
    config: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    runtime: {
      config: {
        loadConfig() {
          return { gateway: { stateDir } };
        },
      },
      state: {
        resolveStateDir() {
          return stateDir;
        },
      },
      channel: {
        pairing: {
          async readAllowFromStore() {
            return ["*"];
          },
        },
      },
    },
  };
}

function createBridgeHarness(tempRoot) {
  return import("../index.js").then(({ CodexBridge }) => {
    const replies = [];
    const startedTasks = [];
    const bridge = new CodexBridge(createFakeApi(tempRoot));
    bridge.safeReply = async (params) => {
      replies.push(params.text);
    };
    bridge.ensureCodexHome = async () => {};
    bridge.snapshotSessionFiles = async () => new Set();
    bridge.startTask = async (params) => {
      startedTasks.push(params);
    };
    return { bridge, replies, startedTasks };
  });
}

function buildAwaitingInputTask(tempRoot, overrides = {}) {
  return createTaskRecord({
    taskId: "task-existing",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    sessionId: "session-existing",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "继续原任务",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    summary: "原任务总结",
    changedFiles: ["README.md"],
    nextSteps: ["继续处理 README"],
    ...overrides,
  });
}

function buildBridgeAction(tempRoot, overrides = {}) {
  return createBridgeActionRecord({
    actionId: "action-existing",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-action",
    cwd: tempRoot,
    kind: "service_control",
    operation: "restart",
    target: "openclaw-codex-feishu.service",
    requestText: "请重启 openclaw-codex-feishu.service",
    status: "awaiting_approval",
    approvalToken: "TOKEN_ACTION",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    ...overrides,
  });
}

test("runtime/control-plane/routing: repository-owned service control creates a bridge action instead of a codex task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-route-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => {
    throw new Error("bridge action must not depend on codex runtime checks");
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    text: "请重启 openclaw-codex-feishu.service",
  });

  const profile = await bridge.loadProfile("user-1", null);
  const action = await bridge.readBridgeAction(profile.activeBridgeActionId);

  assert.equal(startedTasks.length, 0);
  assert.equal(profile.activeTaskId, undefined);
  assert.equal(action.status, "awaiting_approval");
  assert.equal(action.kind, "service_control");
  assert.match(replies[0], /等待审批|同意|不要执行/);
});

test("runtime/control-plane/continuity: bridge action approval does not overwrite the active codex task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-continuity-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingInputTask(tempRoot);
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    text: "请重启 openclaw-codex-feishu.service",
  });

  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedTask = await bridge.readTask(task.taskId);
  const action = await bridge.readBridgeAction(persistedProfile.activeBridgeActionId);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedProfile.activeTaskId, task.taskId);
  assert.equal(persistedTask.sessionId, "session-existing");
  assert.equal(persistedTask.summary, "原任务总结");
  assert.deepEqual(persistedTask.changedFiles, ["README.md"]);
  assert.deepEqual(persistedTask.nextSteps, ["继续处理 README"]);
  assert.equal(action.status, "awaiting_approval");
  assert.match(replies[0], /等待审批|同意|不要执行/);
});

test("runtime/control-plane/approval: explanation keeps the bridge-action approval gate open", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-explain-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingInputTask(tempRoot);
  const action = buildBridgeAction(tempRoot);
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    activeBridgeActionId: action.actionId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.saveBridgeAction(action);
  await bridge.writeApproval({
    token: "TOKEN_ACTION",
    kind: "bridge_action",
    actionId: action.actionId,
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-action",
    reasonCodes: ["service_control_requires_approval"],
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "为什么要审批？",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedAction = await bridge.readBridgeAction(action.actionId);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedTask.taskId, task.taskId);
  assert.equal(persistedAction.status, "awaiting_approval");
  assert.match(replies[0], /审批|同意|不要执行/);
});

test("runtime/control-plane/approval: pure approval executes directly in bridge without starting a codex task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-approve-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingInputTask(tempRoot);
  const action = buildBridgeAction(tempRoot);
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    activeBridgeActionId: action.actionId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  bridge.executeBridgeAction = async () => ({
    exitCode: 0,
    summary: "已重启 openclaw-codex-feishu.service。",
  });

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.saveBridgeAction(action);
  await bridge.writeApproval({
    token: "TOKEN_ACTION",
    kind: "bridge_action",
    actionId: action.actionId,
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-action",
    reasonCodes: ["service_control_requires_approval"],
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "同意",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedAction = await bridge.readBridgeAction(action.actionId);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedTask.summary, "原任务总结");
  assert.equal(persistedAction.status, "finished");
  assert.equal(persistedAction.resultStatus, "completed");
  assert.match(replies[0], /已重启|执行完成|完成/);
});

test("runtime/control-plane/approval: approval tail is rejected and deny ends only the bridge action", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-tail-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingInputTask(tempRoot);
  const action = buildBridgeAction(tempRoot);
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    activeBridgeActionId: action.actionId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.saveBridgeAction(action);
  await bridge.writeApproval({
    token: "TOKEN_ACTION",
    kind: "bridge_action",
    actionId: action.actionId,
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-action",
    reasonCodes: ["service_control_requires_approval"],
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "同意，并用一句话总结结果",
  });

  let persistedAction = await bridge.readBridgeAction(action.actionId);
  let persistedTask = await bridge.readTask(task.taskId);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedAction.status, "awaiting_approval");
  assert.equal(persistedTask.taskId, task.taskId);
  assert.match(replies[0], /只接受纯批准|直接回复“同意”/);

  replies.length = 0;
  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-3",
    text: "不要执行",
  });

  persistedAction = await bridge.readBridgeAction(action.actionId);
  persistedTask = await bridge.readTask(task.taskId);

  assert.equal(persistedAction.status, "finished");
  assert.equal(persistedAction.resultStatus, "denied");
  assert.equal(persistedTask.summary, "原任务总结");
  assert.match(replies[0], /已取消|不要执行/);
});
