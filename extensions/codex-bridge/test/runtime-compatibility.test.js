import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
    const bridge = new CodexBridge(createFakeApi(tempRoot));
    bridge.safeReply = async (params) => {
      replies.push(params.text);
    };
    bridge.ensureCodexHome = async () => {};
    bridge.snapshotSessionFiles = async () => new Set();
    return { bridge, replies };
  });
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

test("runtime/compat/fail_closed: explicit continue start fails closed without mutating the awaiting_input task", async () => {
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

test("runtime/protocol/approve: approve command ignores trailing text after the token", async () => {
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

  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /未找到审批令牌/);
  assert.match(replies[0], /执行环境|bubblewrap|基础设施/);
});

test("runtime/protocol/approve: approve command is rejected when the active task is not awaiting approval", async () => {
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
  assert.match(replies[0], /task_not_waiting_approval|等待输入/);
  assert.match(replies[0], /`\/codex continue <prompt>`/);
  assert.doesNotMatch(replies[0], /未找到审批令牌/);
});

test("runtime/protocol/cwd: cwd changes future default only and does not hot-switch the active task cwd", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-cwd-default-"));
  const activeCwd = path.join(tempRoot, "active");
  const nextDefaultCwd = path.join(tempRoot, "next-default");
  await fs.mkdir(activeCwd, { recursive: true });
  await fs.mkdir(nextDefaultCwd, { recursive: true });

  const { bridge, replies } = await createBridgeHarness(tempRoot);
  const queued = [];
  bridge.queueOrStartTask = async (params) => {
    queued.push({ cwd: params.cwd, mode: params.mode, prompt: params.prompt });
  };

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
  assert.equal(persistedProfile.defaultCwd, nextDefaultCwd);
  assert.match(replies[0], /默认工作目录已更新为/);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-continue",
    text: "/codex continue 继续",
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].cwd, activeCwd);
  assert.equal(queued[0].prompt, "继续");
});

test("runtime/protocol/abort: abort terminates the whole task while awaiting approval", async () => {
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
  assert.equal(persistedTask.status, "aborted");
  assert.equal(persistedProfile.activeTaskId, undefined);
  assert.equal(persistedProfile.pendingApprovalToken, undefined);
  assert.equal(persistedApproval, null);
  assert.match(replies[0], /已请求终止任务/);
});

test("runtime/protocol/status: status remains available while awaiting approval", async () => {
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

  assert.match(replies[0], /活动任务：task-awaiting-approval/);
  assert.match(replies[0], /状态：等待审批/);
  assert.match(replies[0], /待审批令牌：TOKEN1/);
});

test("runtime/protocol/status: status without an active task reports default cwd", async () => {
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

  assert.match(replies[0], /当前没有活动任务|这个私聊还没有记录/);
  assert.match(replies[0], /工作目录：/);
});

test("runtime/protocol/pwd: pwd reports the future default cwd even when the active task uses a different cwd", async () => {
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
