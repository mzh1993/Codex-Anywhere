import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveSettings } from "../lib/settings.js";
import { createAwaitingApprovalTaskRecord, createTaskPersistence } from "../lib/task-store.js";
import { createBridgeActionPersistence, createBridgeActionRecord } from "../lib/bridge-action-store.js";

function createFakeApi(stateDir) {
  return {
    pluginConfig: {
      locale: "zh-CN",
      codexHome: path.join(stateDir, "codex-home"),
    },
    config: {},
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
    },
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeFileName(input) {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}

test("protocol/bridge-action/persistence: settings expose a dedicated bridge action root", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-action-settings-"));
  const settings = resolveSettings(createFakeApi(tempRoot));

  assert.equal(settings.bridgeActionsRoot, path.join(tempRoot, "codex-bridge", "bridge-actions"));
});

test("protocol/bridge-action/persistence: bridge action records exclude task continuity fields", () => {
  const action = createBridgeActionRecord({
    actionId: "action_123",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-1",
    cwd: "/repo",
    kind: "service_control",
    operation: "restart",
    target: "openclaw-codex-feishu.service",
    requestText: "请重启 openclaw-codex-feishu.service",
    approvalToken: "TOKEN_ACTION",
    createdAt: "2026-03-25T00:00:00.000Z",
  });

  assert.equal("summary" in action, false);
  assert.equal("changedFiles" in action, false);
  assert.equal("nextSteps" in action, false);
  assert.equal("sessionId" in action, false);
  assert.equal("currentRunId" in action, false);
  assert.equal("lastRunId" in action, false);
});

test("protocol/bridge-action/persistence: bridge action approval state persists separately from task approval state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-action-store-"));
  const settings = resolveSettings(createFakeApi(tempRoot));

  const taskPersistence = createTaskPersistence({
    tasksRoot: settings.tasksRoot,
    runsRoot: settings.runsRoot,
    readJson,
    writeJson,
    safeFileName,
  });
  const bridgeActionPersistence = createBridgeActionPersistence({
    bridgeActionsRoot: settings.bridgeActionsRoot,
    readJson,
    writeJson,
    safeFileName,
  });

  const task = createAwaitingApprovalTaskRecord({
    taskId: "task_approval_1",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-task",
    cwd: "/repo",
    mode: "resume",
    prompt: "继续做代码审查",
    approvalToken: "TOKEN_TASK",
    currentRunId: "run_approval_1",
    lastRunId: "run_approval_1",
    createdAt: "2026-03-25T00:00:00.000Z",
    timestamp: "2026-03-25T00:00:00.000Z",
  });
  const action = createBridgeActionRecord({
    actionId: "action_approval_1",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-action",
    cwd: "/repo",
    kind: "service_control",
    operation: "restart",
    target: "openclaw-codex-feishu.service",
    status: "awaiting_approval",
    approvalToken: "TOKEN_ACTION",
    requestText: "请重启 openclaw-codex-feishu.service",
    createdAt: "2026-03-25T00:00:00.000Z",
  });

  await taskPersistence.tasks.write(task);
  await bridgeActionPersistence.actions.write(action);

  const persistedTask = await taskPersistence.tasks.read(task.taskId);
  const persistedAction = await bridgeActionPersistence.actions.read(action.actionId);

  assert.equal(persistedTask.approvalToken, "TOKEN_TASK");
  assert.equal(persistedTask.currentRunId, null);
  assert.equal(persistedTask.lastRunId, "run_approval_1");
  assert.equal(persistedTask.status, "awaiting_approval");

  assert.equal(persistedAction.approvalToken, "TOKEN_ACTION");
  assert.equal(persistedAction.status, "awaiting_approval");
  assert.equal(persistedAction.kind, "service_control");
  assert.equal(persistedAction.target, "openclaw-codex-feishu.service");
});
