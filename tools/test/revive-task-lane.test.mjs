import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { reviveTaskLane } from "../lib/revive-task-lane-core.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function createPaths(root, senderId, taskId) {
  const bridgeStateRoot = path.join(root, ".isolated", "codex-feishu", "state", "codex-bridge");
  return {
    bridgeStateRoot,
    profilePath: path.join(bridgeStateRoot, "profiles", `${senderId}.json`),
    taskPath: path.join(bridgeStateRoot, "tasks", `${taskId}.json`),
  };
}

test("ops/revive/dry_run: reports intended repair without mutating files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-feishu-revive-tool-dry-run-"));
  const senderId = "ou_sender";
  const taskId = "task-old";
  const nowIso = "2026-04-02T02:00:00.000Z";
  const { bridgeStateRoot, profilePath, taskPath } = createPaths(tempRoot, senderId, taskId);

  const originalProfile = {
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: "/repo/default",
    updatedAt: "2026-04-02T01:00:00.000Z",
    lastTaskId: "task-new",
    lastSessionId: "session-new",
    activeTaskId: "task-new",
  };
  const originalTask = {
    taskId,
    senderId,
    conversationId: "conv-1",
    cwd: "/repo/old",
    sessionId: "session-old",
    status: "aborted",
    error: "gateway stop",
    updatedAt: "2026-04-02T01:00:00.000Z",
    finishedAt: "2026-04-02T01:00:00.000Z",
    requiresExplicitContinue: false,
    lastStatusHint: null,
  };

  await writeJson(profilePath, originalProfile);
  await writeJson(taskPath, originalTask);

  const result = await reviveTaskLane({
    bridgeStateRoot,
    senderId,
    taskId,
    dryRun: true,
    nowIso,
  });

  assert.equal(result.applied, false);
  assert.equal(result.task.taskId, taskId);
  assert.equal(result.task.status, "awaiting_input");
  assert.equal(result.profile.activeTaskId, taskId);

  assert.deepEqual(await readJson(profilePath), originalProfile);
  assert.deepEqual(await readJson(taskPath), originalTask);
});

test("ops/revive/apply: rewrites task and profile and creates backups", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-feishu-revive-tool-apply-"));
  const senderId = "ou_sender";
  const taskId = "task-old";
  const nowIso = "2026-04-02T02:05:00.000Z";
  const { bridgeStateRoot, profilePath, taskPath } = createPaths(tempRoot, senderId, taskId);

  await writeJson(profilePath, {
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    defaultCwd: "/repo/default",
    updatedAt: "2026-04-02T01:00:00.000Z",
    lastTaskId: "task-new",
    lastSessionId: "session-new",
    activeTaskId: "task-new",
  });
  await writeJson(taskPath, {
    taskId,
    senderId,
    conversationId: "conv-1",
    cwd: "/repo/old",
    sessionId: "session-old",
    status: "aborted",
    error: "gateway stop",
    updatedAt: "2026-04-02T01:00:00.000Z",
    finishedAt: "2026-04-02T01:00:00.000Z",
    requiresExplicitContinue: false,
    lastStatusHint: null,
  });

  const result = await reviveTaskLane({
    bridgeStateRoot,
    senderId,
    taskId,
    dryRun: false,
    nowIso,
  });

  assert.equal(result.applied, true);

  const nextProfile = await readJson(profilePath);
  const nextTask = await readJson(taskPath);

  assert.equal(nextProfile.activeTaskId, taskId);
  assert.equal(nextProfile.lastTaskId, taskId);
  assert.equal(nextProfile.lastSessionId, "session-old");
  assert.equal(nextProfile.updatedAt, nowIso);

  assert.equal(nextTask.status, "awaiting_input");
  assert.equal(nextTask.finishedAt, null);
  assert.equal(nextTask.requiresExplicitContinue, true);
  assert.equal(nextTask.lastStatusHint, "run.interrupted");
  assert.equal(nextTask.error, null);
  assert.equal(nextTask.updatedAt, nowIso);

  const profileDirEntries = await fs.readdir(path.dirname(profilePath));
  const taskDirEntries = await fs.readdir(path.dirname(taskPath));
  assert.ok(profileDirEntries.some((entry) => entry.startsWith(`${senderId}.json.bak-`)));
  assert.ok(taskDirEntries.some((entry) => entry.startsWith(`${taskId}.json.bak-`)));
});

test("ops/revive/validation: mismatched sender fails closed without mutating files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-feishu-revive-tool-mismatch-"));
  const senderId = "ou_sender";
  const taskId = "task-old";
  const { bridgeStateRoot, profilePath, taskPath } = createPaths(tempRoot, senderId, taskId);

  const originalProfile = {
    senderId,
    accountId: "default",
    conversationId: "conv-1",
    activeTaskId: "task-new",
  };
  const originalTask = {
    taskId,
    senderId: "ou_other",
    conversationId: "conv-1",
    status: "aborted",
    error: "gateway stop",
  };

  await writeJson(profilePath, originalProfile);
  await writeJson(taskPath, originalTask);

  await assert.rejects(
    reviveTaskLane({
      bridgeStateRoot,
      senderId,
      taskId,
      dryRun: false,
      nowIso: "2026-04-02T02:10:00.000Z",
    }),
    /sender/i,
  );

  assert.deepEqual(await readJson(profilePath), originalProfile);
  assert.deepEqual(await readJson(taskPath), originalTask);
});
