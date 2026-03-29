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
  assert.match(replies[0], /暂不支持 `\/codex approve`/);
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
  assert.match(replies[0], /暂不支持 `\/codex approve`/);
  assert.match(replies[0], /`\/codex resume \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
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
  assert.match(replies[0], /暂不支持 `\/codex cwd`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[0], /`\/codex doctor`/);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-continue",
    text: "/codex continue 继续",
  });

  assert.equal(replies.length, 2);
  assert.match(replies[1], /暂不支持 `\/codex continue`/);
  assert.match(replies[1], /`\/codex resume \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[1], /`\/codex doctor`/);
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
  assert.match(replies[0], /暂不支持 `\/codex abort`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
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

  assert.match(replies[0], /暂不支持 `\/codex status`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
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

  assert.match(replies[0], /暂不支持 `\/codex status`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[0], /当前没有活动任务|这个私聊还没有记录/);
  assert.doesNotMatch(replies[0], /工作目录：/);
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
  assert.match(replies[0], /暂不支持 `\/codex pwd`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[0], /`\/codex doctor`/);
  assert.doesNotMatch(replies[0], new RegExp(defaultCwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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

test("runtime/protocol/command_surface/help: legacy help is closed and falls back to the native-first unknown-command hint", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-help-surface-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-help",
    text: "/codex help",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /暂不支持 `\/codex help`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[0], /`\/codex doctor`/);
  assert.doesNotMatch(replies[0], /Codex Runner 命令|bridge|兼容/);
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
  assert.match(replies[0], /暂不支持 `\/codex approve`/);
  assert.match(replies[0], /`\/codex resume \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
});

test("runtime/protocol/command_surface/unknown: unknown /codex subcommands return a short native-first hint instead of the full legacy help page", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-unknown-command-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot);

  await bridge.routeInbound({
    senderId: "user-1",
    senderName: "tester",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-new",
    text: "/codex new",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /暂不支持 `\/codex new`/);
  assert.match(replies[0], /`\/codex --cd <path> \[--model <model>\] \[--reasoning <level>\] <prompt>`/);
  assert.doesNotMatch(replies[0], /`\/codex doctor`/);
  assert.doesNotMatch(replies[0], /bridge/i);
  assert.doesNotMatch(replies[0], /Codex Runner 命令/);
});

test("runtime/protocol/command_surface/doctor: doctor returns a minimal health summary", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-"));
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
    text: "/codex --sandbox workspace-write summarize README.md",
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /暂不支持这个原生命令参数：`--sandbox`/);
  assert.equal(await bridge.loadProfile("user-1", null), null);
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
