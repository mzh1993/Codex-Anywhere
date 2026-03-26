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

test("runtime/persistence/atomicity: atomic JSON temp paths stay unique for same target", async () => {
  const { makeAtomicJsonTempPath } = await import("../index.js");
  const filePath = "/tmp/codex-bridge-task.json";
  const seen = new Set();

  for (let index = 0; index < 32; index += 1) {
    seen.add(makeAtomicJsonTempPath(filePath));
  }

  assert.equal(seen.size, 32);
  for (const tempPath of seen) {
    assert.match(tempPath, /^\/tmp\/codex-bridge-task\.json\./);
    assert.match(tempPath, /\.tmp$/);
  }
});

test("runtime/persistence/recovery: runtime persistence failure becomes recoverable interruption instead of silent rejection", async () => {
  const { CodexBridge, __activeTasks } = await import("../index.js");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-persistence-"));
  const replies = [];
  const killSignals = [];
  const bridge = new CodexBridge(createFakeApi(tempRoot));
  bridge.safeReply = async (params) => {
    replies.push(params.text);
  };

  const senderId = "user-1";
  const timestamp = "2026-03-24T07:00:00.000Z";
  const taskId = "task-persistence";
  const runId = "run-persistence";
  const runDir = path.join(bridge.settings.runsRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  const profile = {
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: tempRoot,
    activeTaskId: taskId,
    lastTaskId: taskId,
    updatedAt: timestamp,
  };
  const task = createTaskRecord({
    taskId,
    locale: "zh-CN",
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "running",
    currentRunId: runId,
    lastRunId: runId,
    prompt: "帮我总结 README",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
  });
  const run = createRunRecord({
    runId,
    taskId,
    locale: "zh-CN",
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "running",
    prompt: "帮我总结 README",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    stdoutLogPath: path.join(runDir, "stdout.jsonl"),
    stderrLogPath: path.join(runDir, "stderr.log"),
    lastMessagePath: path.join(runDir, "last-message.txt"),
    runDir,
    beforeSessions: new Set(),
  });

  await bridge.saveProfile(profile);
  await bridge.saveTask(task);
  await bridge.saveRun(run);

  let failOnce = true;
  const originalTaskWrite = bridge.taskStore.write.bind(bridge.taskStore);
  bridge.taskStore.write = async (nextTask) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("simulated task persistence failure");
    }
    return originalTaskWrite(nextTask);
  };

  __activeTasks.set(senderId, {
    task,
    run,
    child: {
      kill(signal) {
        killSignals.push(signal);
      },
    },
    heartbeatTimer: null,
    sessionPollTimer: null,
    stdoutBuffer: "",
    stderrBuffer: "",
    stopping: false,
  });

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    callback();
    return {
      unref() {},
    };
  };

  try {
    await assert.doesNotReject(async () => {
      await bridge.handleStdout(senderId, Buffer.from('{"status":"analyzing task"}\n'));
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(__activeTasks.has(senderId), false);
  assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /上一轮执行已中断/);
  assert.match(replies[0], /请直接说明要继续做什么/);

  const persistedTask = await bridge.readTask(taskId);
  const persistedRun = await bridge.readRun(runId);

  assert.equal(persistedTask.status, "awaiting_input");
  assert.equal(persistedTask.requiresExplicitContinue, true);
  assert.equal(persistedTask.lastStatusHint, "run.interrupted");
  assert.equal(persistedTask.currentRunId, null);
  assert.equal(persistedRun.status, "failed");
  assert.match(persistedRun.error, /interrupted|persistence failure/i);
});

test("runtime/persistence/approval: start failures do not consume the pending approval token", async () => {
  const { CodexBridge } = await import("../index.js");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-approval-start-failure-"));
  const replies = [];
  const bridge = new CodexBridge(createFakeApi(tempRoot));
  bridge.safeReply = async (params) => {
    replies.push(params.text);
  };
  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });
  bridge.startTask = async () => {
    throw new Error("simulated start failure");
  };

  const task = createTaskRecord({
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
    approvalToken: "TOKEN1",
    currentRunId: null,
    lastRunId: "run-blocked",
    prompt: "请重启 nginx",
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
    pendingApprovalToken: "TOKEN1",
    updatedAt: "2026-03-25T00:00:00.000Z",
  };
  const approval = {
    token: "TOKEN1",
    taskId: task.taskId,
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
  };

  await bridge.saveTask(task);
  await bridge.saveProfile(profile);
  await bridge.writeApproval(approval);

  await assert.rejects(
    async () =>
      bridge.routeInbound({
        senderId: "user-1",
        senderName: "tester",
        accountId: "default",
        conversationId: "conv-1",
        messageId: "msg-approve",
        text: "同意",
      }),
    /simulated start failure/,
  );

  const persistedTask = await bridge.readTask(task.taskId);
  const persistedProfile = await bridge.loadProfile("user-1", null);
  const persistedApproval = await bridge.readApproval("TOKEN1");

  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.approvalToken, "TOKEN1");
  assert.equal(persistedProfile.pendingApprovalToken, "TOKEN1");
  assert.equal(persistedApproval?.token, "TOKEN1");
  assert.ok(persistedApproval?.approvalGrant);
  assert.equal(persistedApproval.approvalGrant.approvalToken, "TOKEN1");
  assert.equal(persistedApproval.approvalGrant.consumedAtMs, null);
  assert.deepEqual(persistedApproval.approvalGrant.reasonCodes, ["service_control_requires_approval"]);
  assert.equal(replies.length, 0);
});

test("runtime/persistence/progress: internal item events stay silent and do not overwrite user-visible status", async () => {
  const { CodexBridge, __activeTasks } = await import("../index.js");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-progress-filter-"));
  const replies = [];
  const bridge = new CodexBridge(createFakeApi(tempRoot));
  bridge.safeReply = async (params) => {
    replies.push(params.text);
  };

  const senderId = "user-progress";
  const timestamp = "2026-03-24T07:00:00.000Z";
  const taskId = "task-progress";
  const runId = "run-progress";
  const runDir = path.join(bridge.settings.runsRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  const task = createTaskRecord({
    taskId,
    locale: "zh-CN",
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "running",
    currentRunId: runId,
    lastRunId: runId,
    prompt: "帮我总结 README",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
  });
  const run = createRunRecord({
    runId,
    taskId,
    locale: "zh-CN",
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    cwd: tempRoot,
    mode: "new",
    sessionId: null,
    status: "running",
    prompt: "帮我总结 README",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    stdoutLogPath: path.join(runDir, "stdout.jsonl"),
    stderrLogPath: path.join(runDir, "stderr.log"),
    lastMessagePath: path.join(runDir, "last-message.txt"),
    runDir,
    beforeSessions: new Set(),
  });

  __activeTasks.set(senderId, {
    task,
    run,
    child: {
      kill() {},
    },
    heartbeatTimer: null,
    sessionPollTimer: null,
    stdoutBuffer: "",
    stderrBuffer: "",
    stopping: false,
  });

  try {
    await bridge.handleStdout(senderId, Buffer.from('{"status":"item.completed"}\n'));
    assert.equal(replies.length, 0);
    assert.equal(__activeTasks.get(senderId)?.task.lastStatusHint ?? null, null);
  } finally {
    __activeTasks.delete(senderId);
  }
});
