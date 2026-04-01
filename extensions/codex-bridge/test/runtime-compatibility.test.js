import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRunRecord, createTaskRecord } from "../lib/task-store.js";

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
    const replyEvents = [];
    const bridge = new CodexBridge(createFakeApi(tempRoot));
    bridge.safeReply = async (params) => {
      const prepared = bridge.prepareReply(params);
      replyEvents.push(prepared);
      replies.push(renderReplyText(prepared));
    };
    bridge.ensureCodexHome = async () => {};
    bridge.snapshotSessionFiles = async () => new Set();
    return { bridge, replies, replyEvents };
  });
}

function renderReplyText(params) {
  if (params?.text) return params.text;
  const elements = Array.isArray(params?.card?.elements) ? params.card.elements : [];
  return elements
    .map((element) => (element?.tag === "markdown" ? element.content : ""))
    .filter(Boolean)
    .join("\n");
}

test("runtime/compat/version: runtime compatibility version parsing accepts 0.9.0 and rejects older versions", async () => {
  const { parseVersionString, isVersionAtLeast } = await import("../lib/runtime-compatibility.js");

  assert.deepEqual(parseVersionString("bubblewrap 0.4.0"), { major: 0, minor: 4, patch: 0 });
  assert.deepEqual(parseVersionString("bubblewrap 0.9.0"), { major: 0, minor: 9, patch: 0 });
  assert.equal(isVersionAtLeast("0.4.0", "0.9.0"), false);
  assert.equal(isVersionAtLeast("0.9.0", "0.9.0"), true);
  assert.equal(isVersionAtLeast("0.10.1", "0.9.0"), true);
});

test("runtime/compat/detect: runtime compatibility detection reports missing commands and unsupported bubblewrap", async () => {
  const { detectExecutionRuntimeCompatibility } = await import("../lib/runtime-compatibility.js");

  const missingCodex = await detectExecutionRuntimeCompatibility({
    codexBin: "codex",
    runCommand: async (command) => {
      if (command === "codex") throw Object.assign(new Error("not found"), { code: "ENOENT" });
      return { stdout: "bubblewrap 0.9.0\n", stderr: "" };
    },
  });
  assert.equal(missingCodex.ok, false);
  assert.equal(missingCodex.reasonCode, "missing_codex");

  const missingBwrap = await detectExecutionRuntimeCompatibility({
    codexBin: "codex",
    runCommand: async (command) => {
      if (command === "/usr/bin/bwrap") throw Object.assign(new Error("not found"), { code: "ENOENT" });
      return { stdout: "codex-cli 0.116.0\n", stderr: "" };
    },
  });
  assert.equal(missingBwrap.ok, false);
  assert.equal(missingBwrap.reasonCode, "missing_bwrap");

  const unsupportedBwrap = await detectExecutionRuntimeCompatibility({
    codexBin: "codex",
    runCommand: async (command) => {
      if (command === "/usr/bin/bwrap") return { stdout: "bubblewrap 0.4.0\n", stderr: "" };
      return { stdout: "codex-cli 0.116.0\n", stderr: "" };
    },
  });
  assert.equal(unsupportedBwrap.ok, false);
  assert.equal(unsupportedBwrap.reasonCode, "unsupported_bwrap");
  assert.match(unsupportedBwrap.message, />= 0.9.0/);
});

test("runtime/compat/probe: runtime compatibility detection fails when codex sandbox probe fails", async () => {
  const { detectExecutionRuntimeCompatibility } = await import("../lib/runtime-compatibility.js");

  const sandboxProbeFailure = await detectExecutionRuntimeCompatibility({
    codexBin: "codex",
    runCommand: async (command, args) => {
      if (command === "/usr/bin/bwrap") return { stdout: "bubblewrap 0.9.0\n", stderr: "" };
      if (command === "codex" && args[0] === "sandbox") {
        throw Object.assign(new Error("sandbox failed"), {
          code: 1,
          stderr: "bwrap: Unknown option --argv0\n",
        });
      }
      return { stdout: "codex-cli 0.116.0\n", stderr: "" };
    },
  });

  assert.equal(sandboxProbeFailure.ok, false);
  assert.equal(sandboxProbeFailure.reasonCode, "sandbox_probe_failed");
  assert.match(sandboxProbeFailure.message, /Unknown option --argv0/);
});

test("runtime/compat/fail_closed: new task start fails closed before creating task state when runtime is incompatible", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-runtime-check-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: false,
    reasonCode: "unsupported_bwrap",
    message: "bubblewrap >= 0.9.0 required; current 0.4.0",
  });

  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.startTask({
    profile,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    mode: "new",
    prompt: "读一下 README.md",
    cwd: tempRoot,
    senderName: "tester",
    policyDecision: "allowed",
    reasonCodes: [],
    riskLevel: "normal",
  });

  assert.equal(bridge.getActiveTask("user-1"), null);
  assert.equal(await bridge.loadProfile("user-1", null), null);
  assert.equal((await fs.readdir(bridge.settings.tasksRoot).catch(() => [])).length, 0);
  assert.equal((await fs.readdir(bridge.settings.runsRoot).catch(() => [])).length, 0);
  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /任务已启动/);
  assert.match(replies[0], /bubblewrap|基础设施|执行环境/);
});

test("runtime/compat/fail_closed: explicit resume start fails closed without mutating the awaiting_input task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-runtime-continue-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: false,
    reasonCode: "unsupported_bwrap",
    message: "bubblewrap >= 0.9.0 required; current 0.4.0",
  });

  const task = createTaskRecord({
    taskId: "task-existing",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.queueOrStartTask({
    profile,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    mode: "resume",
    prompt: "继续读取 README.md",
    cwd: tempRoot,
    senderName: "tester",
    existingTask: task,
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  assert.equal(persistedTask.status, "awaiting_input");
  assert.equal(persistedTask.currentRunId, null);
  assert.equal(persistedProfile.activeTaskId, task.taskId);
  assert.equal((await fs.readdir(bridge.settings.runsRoot).catch(() => [])).length, 0);
  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /任务已启动/);
});

test("runtime/compat/fail_closed: approved start fails closed without consuming approval state when runtime is incompatible", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-runtime-approval-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: false,
    reasonCode: "unsupported_bwrap",
    message: "bubblewrap >= 0.9.0 required; current 0.4.0",
  });

  const task = createTaskRecord({
    taskId: "task-approved",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const request = {
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.approvePendingRequest(profile, request, "TOKEN1");

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.approvalToken, "TOKEN1");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.equal(persistedApproval?.token, "TOKEN1");
  assert.equal((await fs.readdir(bridge.settings.runsRoot).catch(() => [])).length, 0);
  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /任务已启动/);
});

test("runtime/protocol/approval: explicit native starts still persist a run-scoped approval grant summary", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-grant-queue-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const { __activeTasks } = await import("../index.js");

  try {
    __activeTasks.clear();

    await bridge.routeInbound({
      senderId: "user-1",
      senderName: "tester",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-risky",
      text: `/codex --cd ${tempRoot} systemctl restart nginx`,
    });

    const persistedProfile = await bridge.loadProfile("user-1", null);
    const persistedTask = await bridge.readTask(persistedProfile.activeTaskId);
    const persistedApproval = await bridge.readApproval(persistedTask.approvalToken);

    assert.equal(persistedTask.status, "awaiting_approval");
    assert.equal(persistedApproval?.token, persistedTask.approvalToken);
    assert.ok(persistedApproval?.approvalGrant);
    assert.equal(persistedApproval.approvalGrant.grantType, "codex_task_run");
    assert.equal(persistedApproval.approvalGrant.taskId, persistedTask.taskId);
    assert.equal(persistedApproval.approvalGrant.approvalToken, persistedApproval.token);
    assert.equal(persistedApproval.approvalGrant.decisionKind, "approval_required");
    assert.equal(persistedApproval.approvalGrant.action, "none");
    assert.equal(persistedApproval.approvalGrant.intent, "unknown");
    assert.deepEqual(persistedApproval.approvalGrant.reasonCodes, ["service_control_requires_approval"]);
    assert.equal(persistedApproval.approvalGrant.effects?.serviceControl, true);
    assert.equal(persistedApproval.approvalGrant.expiresAtMs, persistedApproval.expiresAtMs);
    assert.match(persistedApproval.approvalGrant.promptDigest ?? "", /^[a-f0-9]{64}$/);
    assert.equal(persistedApproval.approvalGrant.consumedAtMs, null);
    assert.equal(replies.length, 1);
  } finally {
    __activeTasks.clear();
  }
});

test("runtime/protocol/full_access: approving a codex task persists DM-scoped full access", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-full-access-approval-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });

  const task = createTaskRecord({
    taskId: "task-needs-approval",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "awaiting_approval",
    approvalToken: "TOKEN1",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "重启服务",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-31T00:00:00.000Z",
  };
  const request = {
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  const started = [];
  bridge.startTask = async (params) => {
    started.push(params);
  };

  await bridge.approvePendingRequest(profile, request, "TOKEN1");

  const persistedProfile = await bridge.loadProfile("user-1", null);
  assert.equal(started.length, 1);
  assert.equal(started[0].riskLevel, "high");
  assert.equal(persistedProfile.accessMode, "full_access");
});

test("runtime/protocol/full_access: explicit new task inherits DM-scoped full access", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-full-access-explicit-new-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });

  await bridge.saveProfile({
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    accessMode: "full_access",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });

  const started = [];
  bridge.startTask = async (params) => {
    started.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-explicit-new",
    text: `/codex --cd ${tempRoot} 帮我看看空间占用`,
  });

  assert.equal(started.length, 1);
  assert.equal(started[0].riskLevel, "high");
});

test("runtime/protocol/full_access: before_reset clears DM-scoped full access", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-full-access-reset-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-running",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    sessionId: "session-old",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    accessMode: "full_access",
    updatedAt: "2026-03-31T00:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  bridge.rememberOpenClawSessionBinding({
    sessionKey: "feishu-main-user-1",
    channelId: "feishu",
    accountId: "default",
    conversationId: "conv-1",
    senderId: "user-1",
  });

  await bridge.handleBeforeReset(
    { reason: "/new" },
    { sessionKey: "feishu-main-user-1", sessionId: "shell-session-1" },
  );

  const clearedProfile = await bridge.loadProfile("user-1", null);
  assert.notEqual(clearedProfile?.accessMode, "full_access");
});

test("runtime/protocol/command_surface/approve: legacy approve with trailing text is closed and leaves approval state untouched", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approve-token-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: false,
    reasonCode: "unsupported_bwrap",
    message: "bubblewrap >= 0.9.0 required; current 0.4.0",
  });

  const task = createTaskRecord({
    taskId: "task-approved",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve",
    text: "/codex approve TOKEN1 批准执行",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(replies.length, 1);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.notEqual(persistedApproval, null);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.doesNotMatch(replies[0], /未找到审批令牌|执行环境|bubblewrap|基础设施/);
});

test("runtime/protocol/command_surface/approve: legacy approve is closed even when the active task is not awaiting approval", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approve-state-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-awaiting-input",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve",
    text: "/codex approve TOKEN1",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex resume <prompt>`/);
  assert.doesNotMatch(replies[0], /`\/codex continue <prompt>`/);
  assert.doesNotMatch(replies[0], /未找到审批令牌|task_not_waiting_approval|等待输入/);
});

test("runtime/protocol/approval_input: natural-language approve is handled by bridge approval ownership", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-input-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: false,
    reasonCode: "unsupported_bwrap",
    message: "bubblewrap >= 0.9.0 required; current 0.4.0",
  });

  const task = createTaskRecord({
    taskId: "task-awaiting-approval-input",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve-text",
    text: "同意",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /执行环境|bubblewrap|基础设施/);
  assert.doesNotMatch(replies[0], /active_task_exists|请先使用 `\/codex approve/);
});

test("runtime/protocol/approval_input: approve with tail strips authorization words and preserves task semantics", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-tail-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const started = [];

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    reasonCode: null,
    message: null,
  });
  bridge.startTask = async (params) => {
    started.push(params);
  };

  const task = createTaskRecord({
    taskId: "task-approval-tail",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
    replyContract: {
      kind: "natural_language_approval",
      allowNumericChoice: false,
    },
    onDeny: "await_user_replan",
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve-tail",
    text: "同意，并把结果总结成三句话",
  });

  assert.equal(replies.length, 0);
  assert.equal(started.length, 1);
  assert.match(started[0].prompt, /重启服务/);
  assert.match(started[0].prompt, /总结成三句话/);
  assert.doesNotMatch(started[0].prompt, /同意/);
});

test("runtime/protocol/approval: stored grant mismatches keep the approval pending instead of starting the task", async () => {
  const executionBoundaries = {
    insideCwd: false,
    outsideCwdWrite: false,
    hostCodex: false,
    hostSecret: false,
    protectedRoot: false,
    isolationBoundary: false,
  };
  const serviceEffects = {
    serviceControl: true,
    schedulerControl: false,
    processControl: false,
    remoteBoundary: false,
    containerControl: false,
    publicationBoundary: false,
    adminEscalation: false,
    policyBypass: false,
    globalEnvChange: false,
    destructiveChange: false,
  };
  const publicationEffects = {
    ...serviceEffects,
    serviceControl: false,
    publicationBoundary: true,
  };

  const cases = [
    {
      label: "reason code mismatch",
      tempPrefix: "codex-bridge-approval-grant-mismatch-",
      mutateGrant(taskId) {
        return {
          taskId,
          approvalToken: "TOKEN1",
          decisionKind: "approval_required",
          reasonCodes: ["publication_boundary_requires_approval"],
          intent: "unknown",
          executionBoundaries,
          effects: publicationEffects,
          createdAtMs: Date.now(),
          consumedAtMs: null,
        };
      },
      assertPersistedGrant(approval) {
        assert.deepEqual(approval?.approvalGrant?.reasonCodes, ["publication_boundary_requires_approval"]);
      },
    },
    {
      label: "action or intent mismatch",
      tempPrefix: "codex-bridge-approval-assessment-mismatch-",
      mutateGrant(taskId) {
        return {
          grantType: "codex_task_run",
          taskId,
          approvalToken: "TOKEN1",
          decisionKind: "approval_required",
          action: "read",
          reasonCodes: ["service_control_requires_approval"],
          intent: "discussion",
          promptDigest: "deadbeef",
          executionBoundaries,
          effects: serviceEffects,
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
          consumedAtMs: null,
        };
      },
      assertPersistedGrant(approval) {
        assert.equal(approval?.approvalGrant?.grantType, "codex_task_run");
        assert.equal(approval?.approvalGrant?.action, "read");
        assert.equal(approval?.approvalGrant?.intent, "discussion");
        assert.equal(approval?.approvalGrant?.promptDigest, "deadbeef");
        assert.ok(Number.isFinite(approval?.approvalGrant?.expiresAtMs));
      },
    },
    {
      label: "task id mismatch",
      tempPrefix: "codex-bridge-approval-taskid-mismatch-",
      mutateGrant() {
        return {
          grantType: "codex_task_run",
          taskId: "task-other",
          approvalToken: "TOKEN1",
          decisionKind: "approval_required",
          action: "none",
          reasonCodes: ["service_control_requires_approval"],
          intent: "unknown",
          promptDigest: "f95bf5b7c005d63d6f0e9f2e295f57bf707b1b2915887f0495f8fca00a2f899e",
          executionBoundaries,
          effects: serviceEffects,
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
          consumedAtMs: null,
        };
      },
      assertPersistedGrant(approval) {
        assert.equal(approval?.approvalGrant?.taskId, "task-other");
      },
    },
    {
      label: "prompt digest mismatch",
      tempPrefix: "codex-bridge-approval-digest-mismatch-",
      mutateGrant(taskId) {
        return {
          grantType: "codex_task_run",
          taskId,
          approvalToken: "TOKEN1",
          decisionKind: "approval_required",
          action: "none",
          reasonCodes: ["service_control_requires_approval"],
          intent: "unknown",
          promptDigest: "deadbeef",
          executionBoundaries,
          effects: serviceEffects,
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
          consumedAtMs: null,
        };
      },
      assertPersistedGrant(approval) {
        assert.equal(approval?.approvalGrant?.promptDigest, "deadbeef");
      },
    },
  ];

  for (const testCase of cases) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), testCase.tempPrefix));
    const { bridge, replies } = await createBridgeHarness(tempRoot);
    const started = [];

    bridge.ensureExecutionRuntimeReady = async () => ({
      ok: true,
      reasonCode: null,
      message: null,
    });
    bridge.startTask = async (params) => {
      started.push(params);
    };

    const task = createTaskRecord({
      taskId: `task-${testCase.label.replace(/\s+/g, "-")}`,
      locale: "zh-CN",
      senderId: "user-1",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-old",
      cwd: tempRoot,
      mode: "new",
      status: "awaiting_approval",
      currentRunId: null,
      lastRunId: "run-blocked",
      approvalToken: "TOKEN1",
      prompt: "systemctl restart nginx",
      createdAt: "2026-03-24T08:00:00.000Z",
      updatedAt: "2026-03-24T08:00:00.000Z",
    });
    const profile = {
      senderId: "user-1",
      accountId: "default",
      conversationId: "conv-1",
      defaultCwd: tempRoot,
      activeTaskId: task.taskId,
      lastTaskId: task.taskId,
      pendingApprovalToken: "TOKEN1",
      updatedAt: "2026-03-24T08:00:00.000Z",
    };
    const approval = {
      token: "TOKEN1",
      taskId: task.taskId,
      senderId: "user-1",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-old",
      mode: "new",
      prompt: "systemctl restart nginx",
      cwd: tempRoot,
      sessionId: null,
      policyDecision: "approval_required",
      reasonCodes: ["service_control_requires_approval"],
      replyContract: {
        kind: "natural_language_approval",
        allowNumericChoice: false,
      },
      onDeny: "await_user_replan",
      approvalGrant: testCase.mutateGrant(task.taskId),
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    };

    await bridge.saveTask(task);
    await bridge.saveProfile(profile);
    await fs.mkdir(path.dirname(bridge.approvalPath("TOKEN1")), { recursive: true });
    await fs.writeFile(bridge.approvalPath("TOKEN1"), JSON.stringify(approval), "utf8");

    await bridge.routeInbound({
      senderId: "user-1",
      senderName: "tester",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-approve-grant",
      text: "同意",
    });

    const persistedTask = await bridge.readTask(task.taskId);
    const persistedProfile = await bridge.loadProfile("user-1", null);
    const persistedApproval = await bridge.readApproval("TOKEN1");

    assert.equal(started.length, 0, testCase.label);
    assert.equal(persistedTask.status, "awaiting_approval", testCase.label);
    assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1", testCase.label);
    assert.equal(persistedApproval?.token, "TOKEN1", testCase.label);
    testCase.assertPersistedGrant(persistedApproval);
    assert.match(replies[0], /审批|边界|未消费/, testCase.label);
  }
});

test("runtime/protocol/approval: a consumed approval token cannot start a second run even if deletion lags", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-consumed-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const started = [];

  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    reasonCode: null,
    message: null,
  });
  bridge.startTask = async (params) => {
    started.push(params);
  };
  bridge.deleteApproval = async () => {};

  const task = createTaskRecord({
    taskId: "task-approval-consumed",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "systemctl restart nginx",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const request = {
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve-consumed",
    text: "同意",
  };
  const approval = {
    token: "TOKEN1",
    taskId: task.taskId,
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    mode: "new",
    prompt: "systemctl restart nginx",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.approvePendingRequest(profile, request, "TOKEN1");

  const afterFirstApproval = await bridge.readApproval("TOKEN1");
  assert.equal(started.length, 1);
  assert.ok(afterFirstApproval?.approvalGrant?.consumedAtMs);

  await bridge.approvePendingRequest(profile, request, "TOKEN1");

  const afterSecondApproval = await bridge.readApproval("TOKEN1");
  assert.equal(started.length, 1);
  assert.ok(afterSecondApproval?.approvalGrant?.consumedAtMs);
  assert.match(replies.at(-1) ?? "", /已消费|重复|不能再次/);
});

test("runtime/protocol/approval_input: natural-language deny returns the task to safe replanning state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-deny-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-approval-deny",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
    replyContract: {
      kind: "natural_language_approval",
      allowNumericChoice: false,
    },
    onDeny: "await_user_replan",
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-deny-text",
    text: "不要执行",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(persistedTask.status, "awaiting_input");
  assert.equal(persistedTask.owner, "codex");
  assert.equal(persistedTask.approvalToken, null);
  assert.equal(persistedProfile.pendingApprovalToken, undefined);
  assert.equal(persistedApproval, null);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /已拒绝|重新规划|更安全/);
});

test("runtime/protocol/approval_input: ambiguous replies keep the approval gate open", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-keep-open-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-approval-keep-open",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_approval",
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
    replyContract: {
      kind: "natural_language_approval",
      allowNumericChoice: false,
    },
    onDeny: "await_user_replan",
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-keep-open",
    text: "为什么要审批？",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.owner, "bridge_approval");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.equal(persistedApproval?.token, "TOKEN1");
  assert.equal(replies.length, 1);
  assert.match(replies[0], /等待你的明确审批|直接回复“同意”|不要执行/);
  assert.doesNotMatch(replies[0], /active_task_exists|请先使用 `\/codex approve/);
});

test("runtime/protocol/input: interrupted awaiting_input tasks accept plain text as the default resume path", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-natural-continue-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push({ cwd: params.cwd, mode: params.mode, prompt: params.prompt, taskId: params.existingTask?.taskId ?? null });
  };

  const task = createTaskRecord({
    taskId: "task-recovery",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    requiresExplicitContinue: true,
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-continue",
    text: "继续帮我总结 README",
  });

  assert.equal(replies.length, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].cwd, tempRoot);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].taskId, "task-recovery");
  assert.equal(queued[0].prompt, "继续帮我总结 README");
});

test("runtime/protocol/status: status output hides internal bridge event hints", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-status-hints-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-status",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    lastStatusHint: "item.completed",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  const text = await bridge.formatStatus("user-1");
  assert.doesNotMatch(text, /item\.completed/);
  assert.doesNotMatch(text, /最近状态/);
  assert.match(text, /活动任务：task-status/);
});

test("runtime/protocol/status: bridge self-restart recovery uses a specific interruption message", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-self-restart-status-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-self-restart",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    status: "running",
    currentRunId: "run-self-restart",
    lastRunId: "run-prev",
    prompt: "请帮我重启 openclaw-codex-feishu.service",
    policyDecision: "approval_required",
    reasonCodes: ["service_control_requires_approval"],
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  const text = await bridge.formatStatus("user-1");
  const persistedTask = await bridge.readTask(task.taskId);

  assert.equal(persistedTask.status, "awaiting_input");
  assert.equal(persistedTask.lastStatusHint, "run.interrupted.bridge_self_restart");
  assert.match(text, /桥接服务.*重启|重启.*桥接服务/);
  assert.doesNotMatch(text, /上一轮执行中断，请直接说明要继续做什么/);
});

test("runtime/protocol/command_surface/cwd: legacy cwd no longer mutates bridge state and falls back to the native-first unknown-command hint", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-cwd-default-"));
  const activeCwd = path.join(tempRoot, "active");
  const nextDefaultCwd = path.join(tempRoot, "next-default");
  await fs.mkdir(activeCwd, { recursive: true });
  await fs.mkdir(nextDefaultCwd, { recursive: true });

  const { bridge, replies } = await createBridgeHarness(tempRoot);

  const task = createTaskRecord({
    taskId: "task-awaiting-input",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: activeCwd,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: activeCwd,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-cwd",
    text: `/codex cwd ${nextDefaultCwd}`,
  });

  const persistedProfile = await bridge.loadProfile("user-1", null);
  assert.equal(persistedProfile.defaultCwd, activeCwd);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex doctor`/);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-continue",
    text: "/codex continue 继续",
  });

  assert.equal(replies.length, 2);
  assert.match(replies[1], /默认直接发送自然语言给 Codex/);
  assert.match(replies[1], /`\/codex resume <prompt>`/);
  assert.match(replies[1], /`\/codex doctor`/);
});

test("runtime/protocol/command_surface/abort: legacy abort is closed and falls back to the native-first unknown-command hint", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-abort-approval-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

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
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-abort",
    text: "/codex abort",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedProfile.activeTaskId, task.taskId);
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.notEqual(persistedApproval, null);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
});

test("runtime/protocol/command_surface/status: legacy status is closed and falls back to the native-first unknown-command hint while awaiting approval", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-status-approval-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

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
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    riskLevel: "high",
    createdAt: "2026-03-24T08:00:00.000Z",
    startedAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-status",
    text: "/codex status",
  });

  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.doesNotMatch(replies[0], /活动任务：task-awaiting-approval/);
  assert.doesNotMatch(replies[0], /待审批令牌：TOKEN1/);
});

test("runtime/protocol/command_surface/status: legacy status is closed and falls back to the native-first unknown-command hint without an active task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-status-idle-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-status",
    text: "/codex status",
  });

  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.doesNotMatch(replies[0], /当前没有活动任务|这个私聊还没有记录/);
  assert.match(replies[0], /默认工作目录：/);
});

test("runtime/protocol/command_surface/pwd: legacy pwd no longer exposes bridge-managed cwd state and falls back to the native-first unknown-command hint", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-pwd-default-"));
  const activeCwd = path.join(tempRoot, "active");
  const defaultCwd = path.join(tempRoot, "default");
  await fs.mkdir(activeCwd, { recursive: true });
  await fs.mkdir(defaultCwd, { recursive: true });

  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const task = createTaskRecord({
    taskId: "task-running",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: activeCwd,
    mode: "new",
    status: "running",
    currentRunId: "run-1",
    lastRunId: "run-1",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    startedAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: defaultCwd,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-pwd",
    text: "/codex pwd",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex doctor`/);
  assert.match(replies[0], new RegExp(defaultCwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(replies[0], new RegExp(activeCwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("runtime/protocol/command_parse: malformed codex command prefix is rejected without starting a task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-malformed-command-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    text: "：/codex status",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /\/codex status/);
  assert.match(replies[0], /命令前不要加|多余前缀/);
  assert.equal(bridge.getActiveTask("user-1"), null);
  assert.equal((await fs.readdir(bridge.settings.tasksRoot).catch(() => [])).length, 0);
  assert.equal((await fs.readdir(bridge.settings.runsRoot).catch(() => [])).length, 0);
});

test("runtime/protocol/command_surface/help: /codex help falls back to the same short help as bare /codex", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-help-surface-"));
  const { bridge, replies, replyEvents } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-help",
    text: "/codex help",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex --cd <path> --sandbox danger-full-access <prompt>`/);
  assert.match(replies[0], /`\/codex resume <prompt>`/);
  assert.match(replies[0], /`\/codex doctor`/);
  assert.doesNotMatch(replies[0], /已关闭|不再执行|兼容/);
  assert.ok(replyEvents[0].card);
  assert.equal(replyEvents[0].text, undefined);
});

test("runtime/protocol/command_surface/approve: legacy approve is closed and does not consume pending approvals", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approve-closed-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

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
    currentRunId: null,
    lastRunId: "run-blocked",
    approvalToken: "TOKEN1",
    prompt: "重启服务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-approve",
    text: "/codex approve TOKEN1",
  });

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.notEqual(persistedApproval, null);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex resume <prompt>`/);
  assert.ok(!/已关闭|不再执行/.test(replies[0]));
});

test("runtime/protocol/command_surface/unknown: unknown /codex subcommands return a short native-first hint instead of the full legacy help page", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-unknown-command-"));
  const { bridge, replies, replyEvents } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-new",
    text: "/codex new",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex --cd <path> --sandbox danger-full-access <prompt>`/);
  assert.match(replies[0], /`\/codex doctor`/);
  assert.doesNotMatch(replies[0], /已关闭|不再执行/);
  assert.doesNotMatch(replies[0], /bridge/i);
  assert.doesNotMatch(replies[0], /Codex Runner 命令/);
  assert.ok(replyEvents[0].card);
});

test("runtime/protocol/command_surface/doctor: doctor returns a concrete runtime health summary", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-"));
  const { bridge, replies, replyEvents } = await createBridgeHarness(tempRoot);
  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    codexVersion: "codex-cli 0.116.0",
    bwrapVersion: "0.11.0",
  });
  bridge.probeGatewayHealthForDoctor = async () => "正常";
  bridge.probeFeishuRuntimeForDoctor = async () => ({
    ok: true,
    label: "已就绪",
  });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-doctor",
    text: "/codex doctor",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /健康摘要/);
  assert.match(replies[0], /Codex：/);
  assert.match(replies[0], /Bridge：/);
  assert.match(replies[0], /Gateway：正常/);
  assert.match(replies[0], /下一步：/);
  assert.doesNotMatch(replies[0], /未探测/);
  assert.ok(replyEvents[0].card);
});

test("runtime/protocol/plain_text: ordinary codex-owned text still does not emit bridge presentation replies", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-no-card-plain-text-"));
  const { bridge, replyEvents } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-plain",
    text: "帮我继续整理 README.md",
  });

  assert.equal(queued.length, 1);
  assert.equal(replyEvents.length, 0);
});

test("runtime/protocol/presentation: task lifecycle bridge notices render as lightweight cards", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-task-lifecycle-card-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  const started = bridge.prepareReply({
    accountId: "default",
    conversationId: "conv-1",
    renderHint: "task_started",
    text: "Codex 任务已启动。",
  });
  const finished = bridge.prepareReply({
    accountId: "default",
    conversationId: "conv-1",
    renderHint: "task_finished",
    text: "本轮执行已完成。",
  });

  assert.equal(started.text, undefined);
  assert.equal(started.card?.header?.title?.content, "任务已启动");
  assert.equal(finished.text, undefined);
  assert.equal(finished.card?.header?.title?.content, "本轮结果");
});

test("runtime/protocol/presentation: approval cards include click-to-approve actions", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-card-actions-"));
  const { bridge } = await createBridgeHarness(tempRoot);

  const approval = bridge.prepareReply({
    accountId: "default",
    conversationId: "conv-1",
    renderHint: "approval",
    text: "高风险请求已进入审批队列。",
  });

  const elements = Array.isArray(approval.card?.elements) ? approval.card.elements : [];
  const actionElement = elements.find((element) => element?.tag === "action");
  const actions = Array.isArray(actionElement?.actions) ? actionElement.actions : [];
  const approveButton = actions.find((action) => action?.value?.command === "同意");
  const denyButton = actions.find((action) => action?.value?.command === "不要执行");

  assert.equal(approval.text, undefined);
  assert.equal(approval.card?.header?.title?.content, "等待确认");
  assert.equal(actions.length, 2);
  assert.equal(approveButton?.type, "primary");
  assert.equal(denyButton?.type, "danger");
});

test("runtime/protocol/command_surface/doctor: running-task doctor advice stays short and does not expose status fallback by default", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-running-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    codexVersion: "codex-cli 0.116.0",
    bwrapVersion: "0.11.0",
  });
  bridge.probeGatewayHealthForDoctor = async () => "正常";
  bridge.probeFeishuRuntimeForDoctor = async () => ({
    ok: true,
    label: "已就绪",
  });
  const task = createTaskRecord({
    taskId: "task-running",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-running",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "running",
    currentRunId: "run-1",
    lastRunId: "run-1",
    prompt: "运行中",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  bridge.loadActiveTask = async () => task;

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-doctor-running",
    text: "/codex doctor",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /下一步：等待当前任务完成/);
  assert.doesNotMatch(replies[0], /\/codex status/);
});

test("runtime/protocol/native_entry/protected_root: explicit native cwd into ~/.openclaw requires approval instead of direct denial", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-protected-cwd-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  bridge.startTask = async () => {
    throw new Error("protected-root native entry must not start directly");
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-openclaw",
    text: "/codex --cd ~/.openclaw summarize README.md",
  });

  const profile = await bridge.loadProfile("user-1", null);
  const task = await bridge.readTask(profile.activeTaskId);

  assert.equal(replies.length, 1);
  assert.match(replies[0], /审批|同意|不要执行/);
  assert.match(replies[0], /protected_root_requires_approval/);
  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.cwd, path.join(os.homedir(), ".openclaw"));
});

test("runtime/protocol/plain_text/protected_root_mentions: ordinary text mentioning protected roots or model knobs still stays on the Codex lane", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-plain-text-lane-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-plain-sensitive",
    text: "继续处理 ~/.openclaw 里的配置，再用 gpt-5.4 和 high reasoning 给我总结一下差异",
  });

  assert.equal(replies.length, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].entrySurface, "plain_text");
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].prompt, "继续处理 ~/.openclaw 里的配置，再用 gpt-5.4 和 high reasoning 给我总结一下差异");
  assert.equal(queued[0].executionOptions, undefined);
  assert.equal(queued[0].policyDecision, undefined);
});

test("runtime/protocol/native_entry/new: native start flags carry cwd model and reasoning only", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-new-"));
  const worktree = path.join(tempRoot, "worktree");
  await fs.mkdir(worktree, { recursive: true });
  const { bridge } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-new",
    text: `/codex --cd ${worktree} --model gpt-5.3-codex --reasoning high summarize README.md`,
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].cwd, worktree);
  assert.equal(queued[0].prompt, "summarize README.md");
  assert.deepEqual(queued[0].executionOptions, {
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
  });
});

test("runtime/protocol/native_entry/new: minimal prompt like entering directory still starts a normal codex task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-new-enter-dir-"));
  const worktree = path.join(tempRoot, "worktree");
  await fs.mkdir(worktree, { recursive: true });
  const { bridge } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-new-enter-dir",
    text: `/codex --cd ${worktree} 进入目录`,
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].cwd, worktree);
  assert.equal(queued[0].prompt, "进入目录");
  assert.equal(queued[0].entrySurface, "explicit_codex_command");
  assert.deepEqual(queued[0].executionOptions, {});
});

test("runtime/protocol/native_entry/new: explicit native new supersedes an awaiting-input task instead of resuming it", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-new-supersede-"));
  const worktree = path.join(tempRoot, "worktree");
  await fs.mkdir(worktree, { recursive: true });
  const { bridge } = await createBridgeHarness(tempRoot);
  const oldTask = createTaskRecord({
    taskId: "task-old-awaiting-input",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    sessionId: "session-old",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: oldTask.taskId,
    lastTaskId: oldTask.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };
  await bridge.saveTask(oldTask);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-new-supersede",
    text: `/codex --cd ${worktree} --model gpt-5.2 --reasoning high 帮我看看本目录空间利用率`,
  });

  const persistedOldTask = await bridge.readTask(oldTask.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].cwd, worktree);
  assert.equal(queued[0].existingTask, undefined);
  assert.equal(persistedOldTask.status, "aborted");
  assert.match(persistedOldTask.error ?? "", /explicit new task|superseded/i);
  assert.equal(persistedProfile.activeTaskId, undefined);
});

test("runtime/protocol/native_entry/resume: explicit resume uses native command naming for the current task", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-resume-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const task = createTaskRecord({
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
    prompt: "旧任务",
    createdAt: "2026-03-24T08:00:00.000Z",
    updatedAt: "2026-03-24T08:00:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-24T08:00:00.000Z",
  };
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };
  await bridge.saveTask(task);
  await bridge.saveProfile(profile);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-resume",
    text: "/codex resume --model gpt-5.3-codex --reasoning medium continue README.md",
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "resume");
  assert.equal(queued[0].cwd, tempRoot);
  assert.equal(queued[0].prompt, "continue README.md");
  assert.equal(queued[0].existingTask.taskId, "task-existing");
  assert.deepEqual(queued[0].executionOptions, {
    model: "gpt-5.3-codex",
    reasoningEffort: "medium",
  });
});

test("runtime/protocol/native_entry/usage: explicit resume without a prompt returns native resume usage", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-resume-usage-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-resume-usage",
    text: "/codex resume",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /用法：`\/codex resume/);
  assert.doesNotMatch(replies[0], /`\/codex continue <prompt>`/);
});

test("runtime/protocol/native_entry/usage: missing flag values fail closed with native usage", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-missing-value-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-missing-value",
    text: "/codex --model",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /缺少 `--model` 的参数值/);
  assert.match(replies[0], /用法：`\/codex \[--cd <path>\]/);
  assert.equal(await bridge.loadProfile("user-1", null), null);
});

test("runtime/protocol/native_entry/validation: invalid native enum values fail closed before task creation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-invalid-value-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-invalid-value",
    text: "/codex --reasoning minimal summarize README.md",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /`--reasoning` 的值无效：`minimal`/);
  assert.match(replies[0], /`none`.*`low`.*`medium`.*`high`.*`xhigh`/);
  assert.equal(await bridge.loadProfile("user-1", null), null);
});

test("runtime/protocol/native_entry/validation: unsupported native execution flags fail closed instead of becoming prompt text", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-unknown-option-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-unknown-option",
    text: "/codex --profile default summarize README.md",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /暂不支持这个原生命令参数：`--profile`/);
  assert.equal(await bridge.loadProfile("user-1", null), null);
});

test("runtime/protocol/native_entry/permissions: explicit danger-full-access flag queues approval instead of being rejected as unknown", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-full-access-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-full-access",
    text: `/codex --cd ${tempRoot} --sandbox danger-full-access 帮我检查 GPU 占用`,
  });

  const profile = await bridge.loadProfile("user-1", null);
  const task = await bridge.readTask(profile.activeTaskId);
  const approval = await bridge.readApproval(task.approvalToken);

  assert.equal(task.status, "awaiting_approval");
  assert.deepEqual(task.reasonCodes, ["native_dangerous_sandbox_requires_approval"]);
  assert.equal(approval.executionOptions?.sandbox, "danger-full-access");
  assert.match(replies[0], /高风险请求已进入审批队列/);
});

test("runtime/protocol/native_entry/permissions: explicit native approval policy flag queues approval instead of being rejected as unknown", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-never-approval-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-native-never-approval",
    text: `/codex --cd ${tempRoot} --ask-for-approval never 帮我停掉旧服务`,
  });

  const profile = await bridge.loadProfile("user-1", null);
  const task = await bridge.readTask(profile.activeTaskId);
  const approval = await bridge.readApproval(task.approvalToken);

  assert.equal(task.status, "awaiting_approval");
  assert.deepEqual(task.reasonCodes, ["native_never_approval_requires_approval"]);
  assert.equal(approval.executionOptions?.askForApproval, "never");
  assert.match(replies[0], /高风险请求已进入审批队列/);
});

test("runtime/protocol/native_entry/plain_text: model and reasoning wording in plain text still stays on the codex lane", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-plain-text-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-plain-text",
    text: "请用 gpt-5.4 高思考等级继续整理 README.md",
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].executionOptions, undefined);
});

test("runtime/protocol/native_entry/plain_text: protected-root and host-codex wording in plain text still stays on the codex lane", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-native-plain-text-boundary-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const started = [];
  bridge.startTask = async (params) => {
    started.push(params);
  };

  const prompt = "请比较 ~/.openclaw/config.json 和 ~/.codex/config.toml，并用 gpt-5.4 高思考等级整理结论";
  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-plain-text-boundary",
    text: prompt,
  });

  assert.equal(replies.length, 0);
  assert.equal(started.length, 1);
  assert.equal(started[0].mode, "new");
  assert.equal(started[0].prompt, prompt);
  assert.equal(started[0].policyDecision, "allowed");
  assert.deepEqual(started[0].reasonCodes, []);
});

test("runtime/protocol/reset: upstream before_reset clears an awaiting-input bridge lane so the next plain text starts fresh", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reset-awaiting-input-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };

  const task = createTaskRecord({
    taskId: "task-reset-old",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-old",
    sessionId: "session-old",
    prompt: "旧任务",
    createdAt: "2026-03-29T23:40:00.000Z",
    updatedAt: "2026-03-29T23:40:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-29T23:40:00.000Z",
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  bridge.rememberOpenClawSessionBinding({
    sessionKey: "feishu-main-user-1",
    channelId: "feishu",
    accountId: "default",
    conversationId: "conv-1",
    senderId: "user-1",
  });

  await bridge.handleBeforeReset(
    { reason: "/new" },
    { sessionKey: "feishu-main-user-1", sessionId: "shell-session-1" },
  );

  const clearedProfile = await bridge.loadProfile("user-1", null);
  assert.equal(clearedProfile.activeTaskId, undefined);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-after-reset",
    text: "继续处理 README.md",
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].mode, "new");
  assert.equal(queued[0].existingTask, undefined);
});

test("runtime/protocol/legacy_top_level/new: top-level /new is claimed and closed instead of bypassing upstream session logic", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-legacy-top-level-new-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  const handled = await bridge.handleInboundClaim(
    {
      channel: "feishu",
      isGroup: false,
      senderId: "user-1",
      accountId: "default",
      body: "/new --cd ~/home/mzh --model gpt-5.2 --reasoning high 帮我看看本目录空间利用率",
    },
    {
      channelId: "feishu",
      senderId: "user-1",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-top-level-new",
    },
  );

  assert.deepEqual(handled, { handled: true });
  assert.equal(replies.length, 1);
  assert.match(replies[0], /默认直接发送自然语言给 Codex/);
  assert.match(replies[0], /`\/codex --cd <path> <prompt>`/);
  assert.match(replies[0], /`\/codex doctor`/);
});

test("runtime/protocol/reset: upstream before_reset stops continuing a running bridge lane on the next plain text", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reset-running-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const { __activeTasks } = await import("../index.js");
  const queued = [];
  const stopped = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push(params);
  };
  bridge.stopTask = async (task, reason) => {
    stopped.push({ taskId: task.taskId, reason });
  };

  const task = createTaskRecord({
    taskId: "task-reset-running",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    status: "running",
    currentRunId: "run-live",
    lastRunId: "run-live",
    sessionId: "session-old",
    prompt: "旧运行中任务",
    createdAt: "2026-03-29T23:55:00.000Z",
    updatedAt: "2026-03-29T23:55:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    updatedAt: "2026-03-29T23:55:00.000Z",
  };

  try {
    await bridge.saveTask(task);
    await bridge.saveProfile(profile);
    __activeTasks.set("user-1", {
      task,
      run: { runId: "run-live" },
      child: { kill() {} },
      stopping: false,
      finishing: false,
      heartbeatTimer: null,
      sessionPollTimer: null,
    });
    bridge.rememberOpenClawSessionBinding({
      sessionKey: "feishu-main-user-1",
      channelId: "feishu",
      accountId: "default",
      conversationId: "conv-1",
      senderId: "user-1",
    });

    await bridge.handleBeforeReset(
      { reason: "/reset" },
      { sessionKey: "feishu-main-user-1", sessionId: "shell-session-1" },
    );

    await bridge.routeInbound({
      senderId: "user-1",
      senderName: "tester",
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-after-reset-running",
      text: "新开一条任务，重新总结 README.md",
    });

    assert.deepEqual(stopped, [{
      taskId: "task-reset-running",
      reason: "upstream session reset: /reset",
    }]);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].mode, "new");
    assert.equal(queued[0].existingTask, undefined);
  } finally {
    __activeTasks.clear();
  }
});

test("runtime/protocol/reset: an abandoned old lane does not send a finish tail reply or overwrite the new lane profile continuity", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reset-tail-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const { __activeTasks } = await import("../index.js");
  const runDir = path.join(tempRoot, "run-old");
  await fs.mkdir(runDir, { recursive: true });
  const lastMessagePath = path.join(runDir, "last-message.txt");
  const stdoutLogPath = path.join(runDir, "stdout.log");
  const stderrLogPath = path.join(runDir, "stderr.log");
  await fs.writeFile(lastMessagePath, "旧 lane 的收尾总结");
  await fs.writeFile(stdoutLogPath, "");
  await fs.writeFile(stderrLogPath, "");

  const oldTask = createTaskRecord({
    taskId: "task-old",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    status: "running",
    currentRunId: "run-old",
    lastRunId: "run-old",
    sessionId: "session-old",
    prompt: "旧运行中任务",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });
  const oldRun = createRunRecord({
    runId: "run-old",
    taskId: oldTask.taskId,
    locale: "zh-CN",
    senderId: oldTask.senderId,
    accountId: oldTask.accountId,
    conversationId: oldTask.conversationId,
    messageId: oldTask.messageId,
    cwd: oldTask.cwd,
    mode: oldTask.mode,
    sessionId: oldTask.sessionId,
    prompt: oldTask.prompt,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    stdoutLogPath,
    stderrLogPath,
    lastMessagePath,
    runDir,
    beforeSessions: new Set(),
  });
  const newTask = createTaskRecord({
    taskId: "task-new",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-new",
    cwd: tempRoot,
    mode: "new",
    status: "awaiting_input",
    currentRunId: null,
    lastRunId: "run-new",
    sessionId: "session-new",
    prompt: "新 lane 任务",
    createdAt: "2026-03-30T00:01:00.000Z",
    updatedAt: "2026-03-30T00:01:00.000Z",
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: newTask.taskId,
    lastTaskId: newTask.taskId,
    lastSessionId: newTask.sessionId,
    updatedAt: "2026-03-30T00:01:00.000Z",
  };

  try {
    await bridge.saveTask(oldTask);
    await bridge.saveRun(oldRun);
    await bridge.saveTask(newTask);
    await bridge.saveProfile(profile);
    bridge.resetAbandonedTaskIds.set("user-1", oldTask.taskId);
    __activeTasks.set("user-1", {
      task: oldTask,
      run: oldRun,
      child: { kill() {} },
      stdoutBuffer: "",
      stderrBuffer: "",
      stopping: true,
      finishing: false,
      heartbeatTimer: null,
      sessionPollTimer: null,
    });

    await bridge.finishTask("user-1", {
      exitCode: 0,
      signal: "SIGTERM",
      error: null,
    });

    const persistedProfile = await bridge.loadProfile("user-1", null);
    const persistedOldTask = await bridge.readTask(oldTask.taskId);
    const persistedOldRun = await bridge.readRun(oldRun.runId);

    assert.equal(replies.length, 0);
    assert.equal(persistedProfile.activeTaskId, newTask.taskId);
    assert.equal(persistedProfile.lastTaskId, newTask.taskId);
    assert.equal(persistedProfile.lastSessionId, newTask.sessionId);
    assert.equal(persistedOldTask.status, "aborted");
    assert.equal(persistedOldRun.status, "aborted");
  } finally {
    __activeTasks.clear();
  }
});

test("runtime/protocol/finish_summary: changed files are extracted only from the explicit Changed Files section", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-finish-summary-"));
  const { bridge, replyEvents } = await createBridgeHarness(tempRoot);
  const { __activeTasks } = await import("../index.js");
  const runDir = path.join(tempRoot, "run-summary");
  await fs.mkdir(runDir, { recursive: true });
  const lastMessagePath = path.join(runDir, "last-message.txt");
  const stdoutLogPath = path.join(runDir, "stdout.jsonl");
  const stderrLogPath = path.join(runDir, "stderr.log");
  await fs.writeFile(lastMessagePath, `**Summary**
- 模型：\`GPT-5.2\`
- 思考等级（reasoning effort）：\`high\`
- 工作目录（cwd）：\`/home/mzh\`

**Changed Files**
- 无

**Next Steps**
- 如需我切到其他目录或检查某个路径占用，告诉我目标路径即可。`);
  await fs.writeFile(stdoutLogPath, "");
  await fs.writeFile(stderrLogPath, "");

  const task = createTaskRecord({
    taskId: "task-summary",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-summary",
    cwd: "/home/mzh",
    mode: "resume",
    status: "running",
    currentRunId: "run-summary",
    lastRunId: "run-summary",
    sessionId: "session-summary",
    prompt: "你现在使用的是什么模型？思考等级是多少？工作目录在哪里？",
    createdAt: "2026-03-30T02:28:36.005Z",
    updatedAt: "2026-03-30T02:28:36.005Z",
  });
  const run = createRunRecord({
    runId: "run-summary",
    taskId: task.taskId,
    locale: task.locale,
    senderId: task.senderId,
    accountId: task.accountId,
    conversationId: task.conversationId,
    messageId: task.messageId,
    cwd: task.cwd,
    mode: task.mode,
    sessionId: task.sessionId,
    prompt: task.prompt,
    createdAt: "2026-03-30T02:28:36.005Z",
    updatedAt: "2026-03-30T02:28:36.005Z",
    stdoutLogPath,
    stderrLogPath,
    lastMessagePath,
    runDir,
    beforeSessions: new Set(),
  });
  const profile = {
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: "/home/mzh",
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
    lastSessionId: task.sessionId,
    updatedAt: "2026-03-30T02:28:36.005Z",
  };

  try {
    await bridge.saveTask(task);
    await bridge.saveRun(run);
    await bridge.saveProfile(profile);
    __activeTasks.set("user-1", {
      task,
      run,
      child: { kill() {} },
      stdoutBuffer: "",
      stderrBuffer: "",
      stopping: false,
      finishing: false,
      heartbeatTimer: null,
      sessionPollTimer: null,
    });

    await bridge.finishTask("user-1", {
      exitCode: 0,
      signal: null,
      error: null,
    });

    const persistedTask = await bridge.readTask(task.taskId);
    assert.deepEqual(persistedTask.changedFiles, []);
    assert.deepEqual(persistedTask.nextSteps, [
      "如需我切到其他目录或检查某个路径占用，告诉我目标路径即可。",
    ]);
    assert.equal(replyEvents.length, 1);
    assert.ok(replyEvents[0].card);
    assert.equal(replyEvents[0].card?.header?.title?.content, "本轮结果");
  } finally {
    __activeTasks.clear();
  }
});

test("runtime/protocol/command_surface/doctor: doctor reports concrete runtime readiness instead of only generic status", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-runtime-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);
  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    codexVersion: "codex-cli 0.116.0",
    bwrapVersion: "0.11.0",
  });
  bridge.probeGatewayHealthForDoctor = async () => "正常";
  bridge.probeFeishuRuntimeForDoctor = async () => ({
    ok: true,
    label: "已就绪",
  });

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-doctor-runtime",
    text: "/codex doctor",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /运行时：正常/);
  assert.match(replies[0], /Codex CLI：codex-cli 0\.116\.0/);
  assert.match(replies[0], /bwrap：0\.11\.0/);
  assert.match(replies[0], /Feishu 凭据：已就绪/);
  assert.match(replies[0], /Gateway：正常/);
});
