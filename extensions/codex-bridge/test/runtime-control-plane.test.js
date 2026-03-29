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
  return import("../index.js").then(({ CodexBridge, __activeBridgeActions }) => {
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
    return { bridge, replies, startedTasks, activeBridgeActions: __activeBridgeActions };
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

function buildAwaitingApprovalTask(tempRoot, overrides = {}) {
  return createTaskRecord({
    taskId: "task-awaiting-approval",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "awaiting_approval",
    approvalToken: "TOKEN_TASK",
    currentRunId: null,
    lastRunId: "run-blocked",
    prompt: "请重启 nginx",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    ...overrides,
  });
}

function buildTaskApproval(tempRoot, overrides = {}) {
  return {
    token: "TOKEN_TASK",
    taskId: "task-awaiting-approval",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    mode: "new",
    prompt: "请重启 nginx",
    cwd: tempRoot,
    sessionId: null,
    policyDecision: "approval_required",
    reasonCodes: ["service_control_requires_approval"],
    replyContract: {
      kind: "natural_language_approval",
      allowNumericChoice: false,
    },
    onDeny: "await_user_replan",
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
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

async function routeOwnedPrompt({ tempPrefix, prompt, executeResult = null }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => {
    throw new Error("bridge action must not depend on codex runtime checks");
  };

  if (executeResult) {
    bridge.executeBridgeAction = async () => executeResult;
  }

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    text: prompt,
  });

  const profile = await bridge.loadProfile("user-1", null);
  const actionId = profile.activeBridgeActionId ?? profile.lastBridgeActionId;
  const action = await bridge.readBridgeAction(actionId);
  return { bridge, replies, startedTasks, profile, action };
}

async function routeCodexOwnedPrompt({ tempPrefix, prompt }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const queued = [];

  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    text: prompt,
  });

  const bridgeActionFiles = await fs.readdir(bridge.settings.bridgeActionsRoot).catch(() => []);
  return { bridgeActionFiles, queued, replies, startedTasks };
}

function assertBridgeOwnedLane({ startedTasks, profile, action, replies, expectedKind }) {
  assert.equal(startedTasks.length, 0);
  assert.equal(profile.activeTaskId, undefined);
  assert.equal(action.kind, expectedKind);
  assert.match(replies[0], /等待审批|同意|不要执行/);
}

function assertCodexFallbackLane({ startedTasks, queued, bridgeActionFiles, replies, prompt, label }) {
  assert.equal(startedTasks.length, 0, label);
  assert.equal(queued.length, 1, label);
  assert.equal(queued[0].prompt, prompt, label);
  assert.equal(bridgeActionFiles.length, 0, label);
  assert.equal(replies.length, 0, label);
}

test("runtime/control-plane/routing: repository-owned service control creates an approval-gated bridge action instead of a codex task", async () => {
  const { replies, startedTasks, profile, action } = await routeOwnedPrompt({
    tempPrefix: "codex-bridge-control-plane-route-",
    prompt: "请重启 openclaw-codex-feishu.service",
  });

  assertBridgeOwnedLane({
    startedTasks,
    profile,
    action,
    replies,
    expectedKind: "service_control",
  });
  assert.equal(action.status, "awaiting_approval");
});

test("runtime/control-plane/routing: dedicated read-only control-plane prompts execute inside bridge", async () => {
  const cases = [
    {
      label: "owned service status",
      tempPrefix: "codex-bridge-control-plane-service-status-",
      prompt: "please report status of openclaw-codex-feishu.service",
      expectedKind: "service_control",
      expectedReply: '{"service":"reported"}',
      executeResult: {
        exitCode: 0,
        summary: '{"service":"reported"}',
        executionTrace: {
          executor: "systemd_user",
          command: "systemctl",
          args: ["--user", "status", "openclaw-codex-feishu.service"],
          exitCode: 0,
        },
      },
    },
    {
      label: "gateway health",
      tempPrefix: "codex-bridge-control-plane-health-",
      prompt: "show gateway health details info",
      expectedKind: "gateway_health",
      expectedReply: '{"gateway":"details-info"}',
      executeResult: {
        exitCode: 0,
        summary: '{"gateway":"details-info"}',
        executionTrace: {
          executor: "isolated_openclaw",
          command: "bash",
          args: ["scripts/openclaw-isolated.sh", "health", "--json"],
          exitCode: 0,
        },
      },
    },
  ];

  for (const testCase of cases) {
    const { replies, startedTasks, profile, action } = await routeOwnedPrompt({
      tempPrefix: testCase.tempPrefix,
      prompt: testCase.prompt,
      executeResult: testCase.executeResult,
    });

    assert.equal(startedTasks.length, 0, testCase.label);
    assert.equal(profile.activeTaskId, undefined, testCase.label);
    assert.equal(profile.activeBridgeActionId, undefined, testCase.label);
    assert.equal(action.status, "finished", testCase.label);
    assert.equal(action.resultStatus, "completed", testCase.label);
    assert.equal(action.kind, testCase.expectedKind, testCase.label);
    assert.deepEqual(action.trace?.execution, testCase.executeResult.executionTrace, testCase.label);
    assert.equal(replies[0], testCase.expectedReply, testCase.label);
  }
});

test("runtime/control-plane/routing: representative mixed-intent prompts stay codex-owned", async () => {
  for (const testCase of [
    {
      label: "mixed repository work plus service control",
      tempPrefix: "codex-bridge-control-plane-mixed-",
      prompt: "先检查 docs/roadmap.md，再重启 openclaw-codex-feishu.service",
    },
    {
      label: "gateway health plus repository viewing",
      tempPrefix: "codex-bridge-control-plane-shorthand-mixed-",
      prompt: "show gateway health details view repository",
    },
  ]) {
    const { bridgeActionFiles, queued, replies, startedTasks } = await routeCodexOwnedPrompt(testCase);
    assertCodexFallbackLane({
      startedTasks,
      queued,
      bridgeActionFiles,
      replies,
      prompt: testCase.prompt,
      label: testCase.label,
    });
  }
});

test("runtime/control-plane/routing: ambiguous control-plane prompts also stay codex-owned", async () => {
  const testCase = {
    label: "ambiguous bridge status wording",
    tempPrefix: "codex-bridge-control-plane-ambiguous-",
    prompt: "show status info of bridge",
  };

  const { bridgeActionFiles, queued, replies, startedTasks } = await routeCodexOwnedPrompt(testCase);
  assertCodexFallbackLane({
    startedTasks,
    queued,
    bridgeActionFiles,
    replies,
    prompt: testCase.prompt,
    label: testCase.label,
  });
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

test("runtime/control-plane/routing: an awaiting-approval task keeps ownership and blocks a new bridge action", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-task-approval-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = createTaskRecord({
    taskId: "task-awaiting-approval",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    approvalToken: "TOKEN_TASK",
    currentRunId: null,
    lastRunId: "run-blocked",
    prompt: "重启服务",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN_TASK",
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval({
    token: "TOKEN_TASK",
    taskId: task.taskId,
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    mode: "new",
    prompt: "重启服务",
    cwd: tempRoot,
    sessionId: null,
    policyDecision: "approval_required",
    reasonCodes: ["service_control_requires_approval"],
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  });

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
  const bridgeActionFiles = await fs.readdir(bridge.settings.bridgeActionsRoot).catch(() => []);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedProfile.activeTaskId, task.taskId);
  assert.equal(persistedProfile.activeBridgeActionId, undefined);
  assert.equal(persistedTask.approvalToken, "TOKEN_TASK");
  assert.equal(bridgeActionFiles.length, 0);
  assert.match(replies[0], /审批|同意|不要执行|\/codex approve/);
});

test("runtime/control-plane/routing: a running bridge action blocks a second owned bridge action", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-active-action-"));
  const { bridge, replies, startedTasks, activeBridgeActions } = await createBridgeHarness(tempRoot);
  const action = buildBridgeAction(tempRoot, {
    status: "running",
    approvalToken: null,
    startedAt: "2026-03-25T00:01:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeBridgeActionId: action.actionId,
    lastBridgeActionId: action.actionId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveProfile(profile);
  await bridge.saveBridgeAction(action);
  activeBridgeActions.set("user-1", { actionId: action.actionId });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "请重启 openclaw-codex-feishu.service",
  });

  const persistedProfile = await bridge.loadProfile("user-1", null);
  const bridgeActionFiles = await fs.readdir(bridge.settings.bridgeActionsRoot).catch(() => []);
  const persistedAction = await bridge.readBridgeAction(action.actionId);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedProfile.activeBridgeActionId, action.actionId);
  assert.equal(bridgeActionFiles.length, 1);
  assert.equal(persistedAction.status, "running");
  assert.equal(replies.length, 1);
  activeBridgeActions.clear();
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
  assert.deepEqual(persistedAction.trace?.execution, {
    executor: "systemd_user",
    command: "systemctl",
    args: ["--user", "restart", "openclaw-codex-feishu.service"],
    exitCode: 0,
  });
  assert.match(replies[0], /已重启|执行完成|完成/);
});

test("runtime/control-plane/approval: a tail that adds a bridge-owned action does not reuse the original task approval", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-tail-owned-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingApprovalTask(tempRoot);
  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN_TASK",
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(buildTaskApproval(tempRoot));

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "同意，并重启 openclaw-codex-feishu.service",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN_TASK");
  const bridgeActionFiles = await fs.readdir(bridge.settings.bridgeActionsRoot).catch(() => []);

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN_TASK");
  assert.equal(persistedProfile.activeBridgeActionId, undefined);
  assert.equal(persistedApproval?.token, "TOKEN_TASK");
  assert.equal(bridgeActionFiles.length, 0);
  assert.match(replies[0], /审批|同意|不要执行|补充要求/);
});

test("runtime/control-plane/approval: a denied tail keeps the original approval pending instead of starting the task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-tail-denied-"));
  const { bridge, replies, startedTasks } = await createBridgeHarness(tempRoot);
  const task = buildAwaitingApprovalTask(tempRoot);
  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN_TASK",
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(buildTaskApproval(tempRoot));

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-2",
    text: "同意，并读取 ~/.ssh/config",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN_TASK");

  assert.equal(startedTasks.length, 0);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN_TASK");
  assert.equal(persistedApproval?.token, "TOKEN_TASK");
  assert.match(replies[0], /拒绝|审批|同意|不要执行/);
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

test("runtime/control-plane/recovery: stale running bridge actions fail closed and clear the active pointer", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-control-plane-stale-action-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const action = buildBridgeAction(tempRoot, {
    status: "running",
    approvalToken: null,
    startedAt: "2026-03-25T00:01:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeBridgeActionId: action.actionId,
    lastBridgeActionId: action.actionId,
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  await bridge.saveProfile(profile);
  await bridge.saveBridgeAction(action);

  const activeAction = await bridge.loadActiveBridgeAction("user-1", null);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedAction = await bridge.readBridgeAction(action.actionId);

  assert.equal(activeAction, null);
  assert.equal(persistedProfile.activeBridgeActionId, undefined);
  assert.equal(persistedAction.status, "finished");
  assert.equal(persistedAction.resultStatus, "failed");
  assert.match(persistedAction.error ?? "", /stale|interrupted|bridge/i);
  assert.deepEqual(persistedAction.trace?.recovery, {
    reason: "bridge_action_interrupted_before_completion",
  });
});
